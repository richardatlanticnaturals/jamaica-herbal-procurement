import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { syncAllInventory } from "@/lib/shopify";

/**
 * POST /api/shopify/sync-inventory
 * Read all active InventoryItems from our DB and push current stock levels
 * to Shopify. Requires auth. Returns per-SKU sync results.
 */
export async function POST() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    // Fetch all active inventory items with a SKU
    const items = await prisma.inventoryItem.findMany({
      where: { isActive: true },
      select: { sku: true, currentStock: true },
    });

    if (items.length === 0) {
      return NextResponse.json({
        message: "No active inventory items to sync",
        results: [],
      });
    }

    const syncPayload = items.map((item) => ({
      sku: item.sku,
      qty: item.currentStock,
    }));

    const results = await syncAllInventory(syncPayload);

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return NextResponse.json({
      message: `Synced ${succeeded} items, ${failed} failed`,
      total: results.length,
      succeeded,
      failed,
      results,
    });
  } catch (error) {
    console.error("Shopify inventory sync failed:", error);
    const message =
      error instanceof Error ? error.message : "Inventory sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
