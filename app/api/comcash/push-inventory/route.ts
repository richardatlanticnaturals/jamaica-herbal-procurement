import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { updateInventory } from "@/lib/comcash";

/**
 * POST /api/comcash/push-inventory
 * Pushes current stock levels from local InventoryItem records back to Comcash POS.
 * Only pushes items that have a comcashItemId and have been updated since last sync.
 */
export async function POST() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    console.log("[Comcash Push Inventory] Starting...");

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
        errors: [],
      });
    }

    console.log(
      `[Comcash Push Inventory] Pushing ${items.length} items to Comcash...`
    );

    // Build the payload for Comcash warehouse/changeQuantity
    const payload = items
      .filter((item) => item.comcashItemId)
      .map((item) => ({
        productId: parseInt(item.comcashItemId!, 10),
        warehouseId: 1, // Default warehouse
        quantity: item.currentStock,
      }));

    const result = await updateInventory(payload);

    // Update last inventory sync timestamp
    await prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: { lastInventorySync: new Date() },
      create: { id: "singleton", lastInventorySync: new Date() },
    });

    const response = {
      success: true,
      message: `Pushed ${result.updated} of ${items.length} items to Comcash`,
      total: items.length,
      updated: result.updated,
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
