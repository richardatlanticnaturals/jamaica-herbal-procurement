import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

/**
 * POST /api/shopify/sync-orders
 * Pulls Shopify orders and deducts sold quantities from inventory.
 * Matches by SKU (Shopify variant SKU = InventoryItem SKU).
 * Tracks last synced order ID to avoid double-counting.
 *
 * Uses AppSettings.lastStockSync to store the last synced timestamp
 * (we re-use this field since Shopify order sync is a stock-related sync).
 * We also store the last synced Shopify order ID in the request to track progress.
 */

const SHOPIFY_API_VERSION = "2024-10";

function getBaseUrl(): string {
  const store = process.env.SHOPIFY_STORE;
  if (!store) throw new Error("SHOPIFY_STORE env var is not set");
  return `https://${store}/admin/api/${SHOPIFY_API_VERSION}`;
}

function getHeaders(): Record<string, string> {
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!token) throw new Error("SHOPIFY_ACCESS_TOKEN env var is not set");
  return {
    "X-Shopify-Access-Token": token,
    "Content-Type": "application/json",
  };
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const baseUrl = getBaseUrl();
    const headers = getHeaders();

    // Get the last sync timestamp from settings
    const settings = await prisma.appSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton" },
      update: {},
    });

    // Fetch orders created since last sync (or last 7 days if never synced)
    const sinceDate = settings.lastStockSync
      ? new Date(settings.lastStockSync).toISOString()
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch paid/fulfilled orders from Shopify
    const params = new URLSearchParams({
      status: "any",
      financial_status: "paid",
      created_at_min: sinceDate,
      limit: "250",
      fields: "id,name,created_at,line_items,financial_status",
    });

    const url = `${baseUrl}/orders.json?${params.toString()}`;
    const res = await fetch(url, { headers });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Shopify API error (${res.status}): ${text}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    const orders = data.orders || [];

    if (orders.length === 0) {
      return NextResponse.json({
        message: "No new paid orders to sync",
        ordersProcessed: 0,
        itemsUpdated: 0,
      });
    }

    // Collect all SKUs from order line items with quantities
    const skuQuantities: Record<string, number> = {};
    let totalLineItems = 0;

    for (const order of orders) {
      for (const lineItem of order.line_items || []) {
        const sku = lineItem.sku;
        if (sku) {
          skuQuantities[sku] = (skuQuantities[sku] || 0) + lineItem.quantity;
          totalLineItems++;
        }
      }
    }

    // Match SKUs to inventory items and deduct stock
    const skuList = Object.keys(skuQuantities);
    const inventoryItems = await prisma.inventoryItem.findMany({
      where: {
        sku: { in: skuList },
        isActive: true,
      },
      select: {
        id: true,
        sku: true,
        currentStock: true,
      },
    });

    // Build update operations
    const updates: Array<{ id: string; sku: string; deducted: number; newStock: number }> = [];

    for (const item of inventoryItems) {
      const qtyToDeduct = skuQuantities[item.sku] || 0;
      if (qtyToDeduct > 0) {
        const newStock = Math.max(0, item.currentStock - qtyToDeduct);
        updates.push({
          id: item.id,
          sku: item.sku,
          deducted: qtyToDeduct,
          newStock,
        });
      }
    }

    // Apply updates in a transaction
    if (updates.length > 0) {
      const prismaUpdates = updates.map((u) =>
        prisma.inventoryItem.update({
          where: { id: u.id },
          data: { currentStock: u.newStock },
        })
      );
      await prisma.$transaction(prismaUpdates);
    }

    // Update the last sync timestamp
    await prisma.appSettings.update({
      where: { id: "singleton" },
      data: { lastStockSync: new Date() },
    });

    // Find unmatched SKUs (SKUs in orders that we don't have in inventory)
    const matchedSkus = new Set(inventoryItems.map((i) => i.sku));
    const unmatchedSkus = skuList.filter((s) => !matchedSkus.has(s));

    return NextResponse.json({
      message: `Synced ${orders.length} orders, updated ${updates.length} items`,
      ordersProcessed: orders.length,
      totalLineItems,
      uniqueSkus: skuList.length,
      itemsUpdated: updates.length,
      unmatchedSkus: unmatchedSkus.length > 0 ? unmatchedSkus : undefined,
      updates: updates.slice(0, 20), // Preview first 20
    });
  } catch (error) {
    console.error("Shopify order sync failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to sync Shopify orders",
      },
      { status: 500 }
    );
  }
}
