/**
 * Fast stock-only refresh from Comcash POS.
 *
 * Paginates through /employee/product/list with warehouseIds:[1,2,3],
 * then batch-updates ONLY currentStock on InventoryItem (matched by
 * comcashItemId or SKU). Does NOT touch names, prices, vendors, or categories.
 *
 * Shared logic used by:
 *  - POST /api/comcash/refresh-stock  (manual trigger)
 *  - GET  /api/cron/sync-stock        (Vercel cron every 30 min)
 *  - Chat tool "refresh_stock"        (AI auto-sync before stock queries)
 */

import { prisma } from "@/lib/prisma";
import { fetchProducts, type ComcashProduct } from "@/lib/comcash";

export interface RefreshStockResult {
  success: boolean;
  itemsUpdated: number;
  itemsSkipped: number;
  totalFetched: number;
  durationMs: number;
  error?: string;
}

/**
 * Sum all warehouse onHand quantities for a product.
 */
function sumOnHand(product: ComcashProduct): number {
  if (Array.isArray(product.onHand)) {
    // onHand is [{warehouseId, quantity}] — sum all warehouse quantities
    return Math.round(
      product.onHand.reduce(
        (sum, wh) => sum + parseFloat(wh.quantity || "0"),
        0
      )
    );
  }
  if (typeof product.onHand === "number") {
    return Math.round(product.onHand);
  }
  return 0;
}

/**
 * Execute a fast stock-only refresh from Comcash.
 * Returns statistics about the sync.
 */
export async function refreshStock(): Promise<RefreshStockResult> {
  const start = Date.now();

  try {
    // 1. Paginate through all Comcash products
    const allProducts: ComcashProduct[] = [];
    const limit = 100;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { products, total } = await fetchProducts(offset, limit, true); // includeWarehouse=true for stock data

      if (products.length === 0) {
        hasMore = false;
        break;
      }

      allProducts.push(...products);
      offset += products.length;

      if (products.length < limit) {
        hasMore = false;
      } else if (total > 0 && offset >= total) {
        hasMore = false;
      }
    }

    console.log(`[Stock Refresh] Fetched ${allProducts.length} products from Comcash`);

    // 2. Build a lookup map: comcashItemId -> stock, and sku -> stock
    const stockByComcashId = new Map<string, number>();
    const stockBySku = new Map<string, number>();

    for (const product of allProducts) {
      const stock = sumOnHand(product);
      const comcashId = String(product.id);
      stockByComcashId.set(comcashId, stock);

      const sku = product.skuCodes?.[0];
      if (sku) {
        stockBySku.set(sku, stock);
      }
    }

    // 3. Get all inventory items from DB (every item has a SKU)
    const dbItems = await prisma.inventoryItem.findMany({
      select: {
        id: true,
        comcashItemId: true,
        sku: true,
        currentStock: true,
      },
    });

    // 4. Batch update only items whose stock has changed
    let itemsUpdated = 0;
    let itemsSkipped = 0;
    const batchSize = 100;

    for (let i = 0; i < dbItems.length; i += batchSize) {
      const batch = dbItems.slice(i, i + batchSize);
      const updates: Promise<unknown>[] = [];

      for (const item of batch) {
        // Try matching by comcashItemId first, then by SKU
        let newStock: number | undefined;

        if (item.comcashItemId && stockByComcashId.has(item.comcashItemId)) {
          newStock = stockByComcashId.get(item.comcashItemId);
        } else if (item.sku && stockBySku.has(item.sku)) {
          newStock = stockBySku.get(item.sku);
        }

        if (newStock !== undefined && newStock !== item.currentStock) {
          updates.push(
            prisma.inventoryItem.update({
              where: { id: item.id },
              data: {
                currentStock: newStock,
                lastSyncedAt: new Date(),
              },
            })
          );
          itemsUpdated++;
        } else {
          itemsSkipped++;
        }
      }

      // Execute batch in parallel
      if (updates.length > 0) {
        await Promise.all(updates);
      }
    }

    // 5. Update lastStockSync timestamp in AppSettings
    await prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: { lastStockSync: new Date() },
      create: { id: "singleton", lastStockSync: new Date() },
    });

    const durationMs = Date.now() - start;

    console.log(
      `[Stock Refresh] Complete: ${itemsUpdated} updated, ${itemsSkipped} unchanged, ${durationMs}ms`
    );

    return {
      success: true,
      itemsUpdated,
      itemsSkipped,
      totalFetched: allProducts.length,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - start;
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Stock Refresh] Failed:", message);

    return {
      success: false,
      itemsUpdated: 0,
      itemsSkipped: 0,
      totalFetched: 0,
      durationMs,
      error: message,
    };
  }
}
