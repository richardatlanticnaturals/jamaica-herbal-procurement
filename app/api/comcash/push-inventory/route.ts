import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { updateInventory, fetchProducts, type ComcashProduct } from "@/lib/comcash";

/**
 * POST /api/comcash/push-inventory
 * Pushes stock DELTAS from local InventoryItem records to Comcash POS.
 * IMPORTANT: Comcash warehouse/changeQuantity expects a DELTA (qty to add/subtract), NOT absolute stock.
 * We fetch current Comcash stock, compute the difference (appStock - comcashStock), and only push non-zero deltas.
 */
export async function POST() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    console.log("[Comcash Push Inventory] Starting delta sync...");

    // Get the last inventory push timestamp
    const settings = await prisma.appSettings.findUnique({
      where: { id: "singleton" },
      select: { lastInventorySync: true },
    });

    // Find all inventory items with a comcashItemId that have been updated
    // since last sync (or all if never synced)
    const whereClause: Record<string, unknown> = {
      comcashItemId: { not: null },
      isActive: true,
    };

    if (settings?.lastInventorySync) {
      whereClause.updatedAt = { gt: settings.lastInventorySync };
    }

    const items = await prisma.inventoryItem.findMany({
      where: whereClause,
      select: {
        id: true,
        sku: true,
        comcashItemId: true,
        currentStock: true,
      },
    });

    if (items.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No items to push — all inventory is up to date",
        updated: 0,
        skipped: 0,
        errors: [],
      });
    }

    console.log(
      `[Comcash Push Inventory] Fetching current Comcash stock for ${items.length} items...`
    );

    // Step 1: Fetch current Comcash stock to compute deltas
    const comcashStockMap = new Map<string, number>(); // comcashItemId (string) -> current Comcash stock
    const pageLimit = 100;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { products, total } = await fetchProducts(offset, pageLimit, true);
      if (products.length === 0) break;
      for (const p of products) {
        let stock = 0;
        if (Array.isArray(p.onHand)) {
          stock = Math.round(p.onHand.reduce((sum: number, wh: { quantity?: string }) => sum + parseFloat(wh.quantity || "0"), 0));
        } else if (typeof p.onHand === "number") {
          stock = Math.round(p.onHand);
        }
        comcashStockMap.set(String(p.id), stock);
      }
      offset += products.length;
      if (products.length < pageLimit) hasMore = false;
      else if (total > 0 && offset >= total) hasMore = false;
    }

    // Step 2: Compute deltas and only push non-zero differences
    const deltaPayload: Array<{ productId: number; warehouseId: number; quantity: number }> = [];
    let skipped = 0;

    for (const item of items) {
      if (!item.comcashItemId) continue;
      const comcashStock = comcashStockMap.get(item.comcashItemId) ?? 0;
      const delta = item.currentStock - comcashStock;
      if (delta === 0) {
        skipped++;
        continue;
      }
      deltaPayload.push({
        productId: parseInt(item.comcashItemId, 10),
        warehouseId: 2,
        quantity: delta, // Positive = add stock, Negative = subtract stock
      });
    }

    if (deltaPayload.length === 0) {
      // Update sync timestamp even if nothing needed pushing
      await prisma.appSettings.upsert({
        where: { id: "singleton" },
        update: { lastInventorySync: new Date() },
        create: { id: "singleton", lastInventorySync: new Date() },
      });

      return NextResponse.json({
        success: true,
        message: `All ${items.length} items already match Comcash stock — nothing to push`,
        total: items.length,
        updated: 0,
        skipped: items.length,
        errors: [],
      });
    }

    console.log(
      `[Comcash Push Inventory] Pushing ${deltaPayload.length} items with stock differences (${skipped} already matched)...`
    );

    const result = await updateInventory(deltaPayload);

    // Update last inventory sync timestamp
    await prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: { lastInventorySync: new Date() },
      create: { id: "singleton", lastInventorySync: new Date() },
    });

    const response = {
      success: true,
      message: `Pushed ${result.updated} of ${deltaPayload.length} items with stock differences to Comcash (${skipped} already matched)`,
      total: items.length,
      updated: result.updated,
      skipped,
      errors: result.errors,
    };

    console.log("[Comcash Push Inventory] Complete:", response);

    return NextResponse.json(response);
  } catch (error) {
    console.error("[Comcash Push Inventory] Failed:", error);
    const message =
      error instanceof Error ? error.message : "Failed to push inventory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
