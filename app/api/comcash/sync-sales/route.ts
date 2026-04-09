/**
 * POST /api/comcash/sync-sales
 *
 * Paginates through the Comcash sale/list API, aggregates product-level sales data,
 * and upserts into the ProductSales cache table. This avoids hammering the API every
 * time the chat needs sales/slow-mover data.
 *
 * Body: { months?: number } — how many months back to sync (default 4)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { authenticateEmployee } from "@/lib/comcash";

// Allow up to 5 minutes on Vercel
export const maxDuration = 300;

const COMCASH_OPENAPI_URL =
  process.env.COMCASH_OPENAPI_URL ||
  "https://ssl-openapi-jamaicanherbal.comcash.com";
const COMCASH_OPENAPI_KEY = process.env.COMCASH_OPENAPI_KEY || "";

// --- Types for the sale/list response ---
interface SaleProduct {
  productId: number;
  title: string;
  quantity: string;
  totalForProduct: string;
}

interface Sale {
  id: number;
  timeCreated: number; // Unix timestamp in seconds
  products: SaleProduct[];
}

// --- Aggregation map ---
interface ProductAgg {
  comcashProductId: number;
  productName: string;
  totalQtySold: number;
  totalRevenue: number;
  lastSoldAt: Date | null;
  salesCount: number;
  skus: Set<string>; // track all SKU codes seen
}

export async function POST(req: NextRequest) {
  // Auth check
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await req.json().catch(() => ({}));
    const months = (body.months as number) || 4;

    // Calculate the cutoff date
    const periodEnd = new Date();
    const periodStart = new Date();
    periodStart.setMonth(periodStart.getMonth() - months);

    const cutoffTimestamp = Math.floor(periodStart.getTime() / 1000);

    console.log(
      `[SyncSales] Starting sync for ${months} months back (since ${periodStart.toISOString().split("T")[0]})`
    );

    // Authenticate with Comcash
    const jwt = await authenticateEmployee();

    // Paginate through sale/list
    const productMap = new Map<number, ProductAgg>();
    let offset = 0;
    const pageSize = 100;
    let totalSalesProcessed = 0;
    let pagesProcessed = 0;
    let reachedEnd = false;

    while (!reachedEnd) {
      // Use V2 /sale/list (NOT /employee/sale/list — employee endpoint returns empty)
      const res = await fetch(`${COMCASH_OPENAPI_URL}/sale/list`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          OPEN_API_KEY: COMCASH_OPENAPI_KEY,
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          limit: pageSize,
          offset,
          order: "desc",
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(
          `[SyncSales] API error at offset ${offset}: ${res.status} - ${text.slice(0, 200)}`
        );
        // If we already have data, stop gracefully rather than failing
        if (totalSalesProcessed > 0) {
          console.warn(
            `[SyncSales] Stopping pagination after ${totalSalesProcessed} sales due to API error`
          );
          break;
        }
        return NextResponse.json(
          { error: `Comcash sale/list error: ${res.status}` },
          { status: 502 }
        );
      }

      const rawData = await res.json();
      const sales: Sale[] = Array.isArray(rawData)
        ? rawData
        : rawData.data || [];

      if (sales.length === 0) {
        // No more sales
        reachedEnd = true;
        break;
      }

      pagesProcessed++;

      for (const sale of sales) {
        // Check if we've gone past our time window
        if (sale.timeCreated && sale.timeCreated < cutoffTimestamp) {
          reachedEnd = true;
          break;
        }

        totalSalesProcessed++;
        const saleDate = sale.timeCreated
          ? new Date(sale.timeCreated * 1000)
          : null;

        // Process each product in this sale
        if (sale.products && Array.isArray(sale.products)) {
          for (const p of sale.products) {
            const pid = p.productId;
            if (!pid) continue;

            const qty = parseFloat(p.quantity || "0");
            const revenue = parseFloat(p.totalForProduct || "0");

            const existing = productMap.get(pid);
            if (existing) {
              existing.totalQtySold += qty;
              existing.totalRevenue += revenue;
              existing.salesCount += 1;
              // Track the most recent sale date
              if (
                saleDate &&
                (!existing.lastSoldAt || saleDate > existing.lastSoldAt)
              ) {
                existing.lastSoldAt = saleDate;
              }
            } else {
              productMap.set(pid, {
                comcashProductId: pid,
                productName: p.title || `Product #${pid}`,
                totalQtySold: qty,
                totalRevenue: revenue,
                lastSoldAt: saleDate,
                salesCount: 1,
                skus: new Set(),
              });
            }
          }
        }
      }

      // Move to next page
      offset += pageSize;

      // Log progress every 10 pages
      if (pagesProcessed % 10 === 0) {
        console.log(
          `[SyncSales] Processed ${pagesProcessed} pages, ${totalSalesProcessed} sales, ${productMap.size} products`
        );
      }

      // Safety cap: don't paginate forever (50,000 sales = 500 pages)
      if (pagesProcessed >= 600) {
        console.warn("[SyncSales] Hit 600-page safety cap, stopping pagination");
        break;
      }
    }

    console.log(
      `[SyncSales] Pagination complete: ${pagesProcessed} pages, ${totalSalesProcessed} sales, ${productMap.size} unique products`
    );

    // --- Now upsert into ProductSales ---
    // First, load the SKU map from InventoryItem so we can link records
    const inventoryItems = await prisma.inventoryItem.findMany({
      where: { comcashItemId: { not: null } },
      select: {
        id: true,
        sku: true,
        comcashItemId: true,
      },
    });

    // Build lookup: comcashItemId -> { id, sku }
    const comcashToInventory = new Map<
      string,
      { id: string; sku: string }
    >();
    for (const item of inventoryItems) {
      if (item.comcashItemId) {
        comcashToInventory.set(item.comcashItemId, {
          id: item.id,
          sku: item.sku,
        });
      }
    }

    let upserted = 0;
    let linked = 0;
    const errors: string[] = [];

    // Process in batches of 50 to avoid overwhelming the DB
    const productEntries = Array.from(productMap.entries());
    const batchSize = 50;

    for (let i = 0; i < productEntries.length; i += batchSize) {
      const batch = productEntries.slice(i, i + batchSize);

      const promises = batch.map(async ([pid, agg]) => {
        try {
          // Try to find matching inventory item by comcash ID
          const inv = comcashToInventory.get(String(pid));
          const sku = inv?.sku || `COMCASH-${pid}`;
          const inventoryItemId = inv?.id || null;

          // Fix: Round totalRevenue to 2 decimal places to avoid Decimal(10,2) precision errors
          const roundedRevenue = Math.round(agg.totalRevenue * 100) / 100;

          await prisma.productSales.upsert({
            where: {
              sku_periodStart: {
                sku,
                periodStart: periodStart,
              },
            },
            update: {
              comcashProductId: pid,
              productName: agg.productName,
              totalQtySold: Math.round(agg.totalQtySold),
              totalRevenue: roundedRevenue,
              lastSoldAt: agg.lastSoldAt,
              salesCount: agg.salesCount,
              periodEnd,
              inventoryItemId,
            },
            create: {
              sku,
              comcashProductId: pid,
              productName: agg.productName,
              totalQtySold: Math.round(agg.totalQtySold),
              totalRevenue: roundedRevenue,
              lastSoldAt: agg.lastSoldAt,
              salesCount: agg.salesCount,
              periodStart,
              periodEnd,
              inventoryItemId,
            },
          });

          upserted++;
          if (inventoryItemId) linked++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          errors.push(`Product ${pid}: ${msg}`);
        }
      });

      await Promise.all(promises);
    }

    // Fix: Update lastSalesSync (not lastInventorySync) to track sales sync separately
    await prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: { lastSalesSync: new Date() },
      create: { id: "singleton" },
    });

    const summary = {
      success: true,
      message: `Synced ${upserted} products from ${totalSalesProcessed} sales (${pagesProcessed} pages)`,
      totalSalesProcessed,
      pagesProcessed,
      uniqueProducts: productMap.size,
      upserted,
      linkedToInventory: linked,
      periodStart: periodStart.toISOString().split("T")[0],
      periodEnd: periodEnd.toISOString().split("T")[0],
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    };

    console.log("[SyncSales] Complete:", JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[SyncSales] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
