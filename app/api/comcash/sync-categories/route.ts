import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { fetchCategories, fetchAllProducts } from "@/lib/comcash";

export const maxDuration = 300; // Allow up to 5 minutes for full sync

/**
 * POST /api/comcash/sync-categories
 * Fetches categories and products from Comcash, then updates InventoryItem.category
 * by mapping each product's categoryId to the category title.
 */
export async function POST() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    console.log("[Category Sync] Starting category sync from Comcash...");

    // Step 1: Fetch all categories from Comcash
    const categories = await fetchCategories();
    console.log(`[Category Sync] Fetched ${categories.length} categories from Comcash`);

    // Build a lookup map: categoryId -> category title
    const categoryMap = new Map<number, string>();
    for (const cat of categories) {
      categoryMap.set(cat.id, cat.title);
    }

    // Step 2: Fetch all products from Comcash
    let lastLog = 0;
    const products = await fetchAllProducts((fetched) => {
      if (fetched - lastLog >= 500) {
        console.log(`[Category Sync] Fetched ${fetched} products...`);
        lastLog = fetched;
      }
    });
    console.log(`[Category Sync] Fetched ${products.length} products from Comcash`);

    // Step 3: Build a map of SKU/comcashItemId -> category name
    // We'll match inventory items by SKU (first skuCode) or comcashItemId
    const skuToCategoryName = new Map<string, string>();
    const comcashIdToCategoryName = new Map<string, string>();

    for (const product of products) {
      if (product.categoryId == null) continue;
      const categoryName = categoryMap.get(product.categoryId);
      if (!categoryName) continue;

      // Map by SKU
      const sku = product.skuCodes?.[0];
      if (sku) {
        skuToCategoryName.set(sku, categoryName);
      }

      // Map by Comcash product ID
      comcashIdToCategoryName.set(String(product.id), categoryName);
    }

    // Step 4: Fetch all inventory items and update categories in batches
    const allItems = await prisma.inventoryItem.findMany({
      select: { id: true, sku: true, comcashItemId: true, category: true },
    });

    console.log(`[Category Sync] Processing ${allItems.length} inventory items...`);

    let updatedCount = 0;
    let skippedCount = 0;
    const batchSize = 100;

    for (let i = 0; i < allItems.length; i += batchSize) {
      const batch = allItems.slice(i, i + batchSize);
      const updates: Array<{ id: string; category: string }> = [];

      for (const item of batch) {
        // Try to find category by SKU first, then by comcashItemId
        let categoryName = skuToCategoryName.get(item.sku);
        if (!categoryName && item.comcashItemId) {
          categoryName = comcashIdToCategoryName.get(item.comcashItemId);
        }

        if (categoryName && categoryName !== item.category) {
          updates.push({ id: item.id, category: categoryName });
        } else {
          skippedCount++;
        }
      }

      // Batch update via transaction
      if (updates.length > 0) {
        await prisma.$transaction(
          updates.map((u) =>
            prisma.inventoryItem.update({
              where: { id: u.id },
              data: { category: u.category },
            })
          )
        );
        updatedCount += updates.length;
      }
    }

    const result = {
      success: true,
      message: `Category sync complete. ${updatedCount} items updated, ${skippedCount} unchanged/unmatched.`,
      categoriesFound: categories.length,
      productsProcessed: products.length,
      itemsUpdated: updatedCount,
      itemsSkipped: skippedCount,
      categories: categories.map((c) => ({ id: c.id, title: c.title })),
    };

    console.log("[Category Sync] Complete:", result.message);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[Category Sync] Failed:", error);
    const message =
      error instanceof Error ? error.message : "Failed to sync categories";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
