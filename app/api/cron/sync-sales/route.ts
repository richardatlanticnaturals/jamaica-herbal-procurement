import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateEmployee } from "@/lib/comcash";

export const maxDuration = 300;

const COMCASH_OPENAPI_URL = process.env.COMCASH_OPENAPI_URL || "https://ssl-openapi-jamaicanherbal.comcash.com";
const COMCASH_OPENAPI_KEY = process.env.COMCASH_OPENAPI_KEY || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

/**
 * GET /api/cron/sync-sales
 * Daily cron job to sync 4 months of sales data from Comcash into ProductSales cache.
 */
export async function GET(request: NextRequest) {
  // Validate cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const months = 4;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffTs = Math.floor(cutoff.getTime() / 1000);

    // Authenticate
    const token = await authenticateEmployee();

    // Paginate through sales (V2 endpoint, NOT /employee/sale/list)
    const productMap = new Map<string, {
      name: string;
      productId: number;
      qty: number;
      revenue: number;
      lastSold: Date;
      count: number;
    }>();

    let offset = 0;
    let totalSales = 0;
    let reachedCutoff = false;

    while (!reachedCutoff) {
      const res = await fetch(`${COMCASH_OPENAPI_URL}/sale/list`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          OPEN_API_KEY: COMCASH_OPENAPI_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ limit: 100, offset, order: "desc" }),
      });

      if (!res.ok) break;
      const sales = await res.json();
      if (!Array.isArray(sales) || sales.length === 0) break;

      for (const sale of sales) {
        const ts = sale.timeCreated || 0;
        if (ts < cutoffTs) { reachedCutoff = true; break; }
        totalSales++;

        for (const p of sale.products || []) {
          const pid = String(p.productId);
          const qty = parseFloat(p.quantity || "0");
          const revenue = parseFloat(p.totalForProduct || "0");
          const soldAt = new Date(ts * 1000);

          if (!productMap.has(pid)) {
            productMap.set(pid, { name: p.title || "Unknown", productId: p.productId, qty: 0, revenue: 0, lastSold: soldAt, count: 0 });
          }
          const agg = productMap.get(pid)!;
          agg.qty += qty;
          agg.revenue += revenue;
          agg.count++;
          if (soldAt > agg.lastSold) agg.lastSold = soldAt;
        }
      }

      offset += 100;
      if (offset > 60000) break;
    }

    // Upsert into ProductSales
    const periodStart = cutoff;
    const periodEnd = new Date();
    let upserted = 0;

    for (const [pid, agg] of productMap) {
      // Find inventory item by comcashItemId
      const inv = await prisma.inventoryItem.findFirst({
        where: { comcashItemId: pid },
        select: { id: true, sku: true },
      });

      const sku = inv?.sku || `COMCASH-${pid}`;
      const revenue = Math.round(agg.revenue * 100) / 100;

      await prisma.productSales.upsert({
        where: { sku_periodStart: { sku, periodStart } },
        update: {
          totalQtySold: Math.round(agg.qty),
          totalRevenue: revenue,
          lastSoldAt: agg.lastSold,
          salesCount: agg.count,
          periodEnd,
          inventoryItemId: inv?.id || null,
        },
        create: {
          sku,
          comcashProductId: agg.productId,
          productName: agg.name,
          totalQtySold: Math.round(agg.qty),
          totalRevenue: revenue,
          lastSoldAt: agg.lastSold,
          salesCount: agg.count,
          periodStart,
          periodEnd,
          inventoryItemId: inv?.id || null,
        },
      });
      upserted++;
    }

    // Update timestamp
    await prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: { lastSalesSync: new Date() },
      create: { id: "singleton", lastSalesSync: new Date() },
    });

    console.log(`[Cron] Sales sync: ${totalSales} sales, ${upserted} products cached`);

    return NextResponse.json({
      success: true,
      totalSales,
      uniqueProducts: upserted,
      periodStart: cutoff.toISOString(),
      periodEnd: periodEnd.toISOString(),
    });
  } catch (error) {
    console.error("[Cron] Sales sync failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sales sync failed" },
      { status: 500 }
    );
  }
}
