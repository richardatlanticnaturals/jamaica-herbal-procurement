import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { fetchAllProducts, type ComcashProduct } from "@/lib/comcash";

export const maxDuration = 300; // Allow up to 5 minutes for full sync

/**
 * POST /api/comcash/sync-products
 * Fetches all products from Comcash Employee API and upserts into InventoryItem.
 * Matches by SKU from skuCodes array.
 * Updates: costPrice (lastCost), retailPrice (price), currentStock (onHand),
 *          vendorId (primaryVendorId), comcashItemId.
 */
export async function POST() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    console.log("[Comcash Product Sync] Starting via Employee API...");

    // Fetch all products from Comcash Employee API
    let lastLog = 0;
    const products = await fetchAllProducts((fetched) => {
      if (fetched - lastLog >= 100) {
        console.log(`[Comcash Product Sync] Fetched ${fetched} products...`);
        lastLog = fetched;
      }
    });

    console.log(
      `[Comcash Product Sync] Fetched ${products.length} products from Comcash`
    );

    let created = 0;
    let updated = 0;
    let skipped = 0;

    // Process in batches of 50 to avoid overwhelming the DB
    const batchSize = 50;
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);

      await prisma.$transaction(async (tx) => {
        for (const product of batch) {
          const sku = product.skuCodes?.[0] || `COMCASH-${product.id}`;
          const name = product.title || "Unknown";
          const retailPrice = product.price ? parseFloat(product.price) : 0;
          const costPrice = product.lastCost
            ? parseFloat(product.lastCost)
            : 0;
          const onHand =
            typeof product.onHand === "number" ? product.onHand : 0;

          // Skip products with no title
          if (!name || name === "Unknown") {
            skipped++;
            continue;
          }

          // Find vendor by Comcash vendor ID
          let vendorId: string | null = null;
          const comcashVendorId =
            product.primaryVendorId || product.vendorId;
          if (
            comcashVendorId &&
            product.primaryVendorName !== "NONE"
          ) {
            const vendor = await tx.vendor.findFirst({
              where: {
                OR: [
                  { comcashVendorId: String(comcashVendorId) },
                  ...(product.primaryVendorName
                    ? [
                        {
                          name: {
                            contains: product.primaryVendorName,
                            mode: "insensitive" as const,
                          },
                        },
                      ]
                    : []),
                ],
              },
              select: { id: true },
            });
            vendorId = vendor?.id || null;
          }

          // Upsert product by SKU
          const existing = await tx.inventoryItem.findUnique({
            where: { sku },
          });

          if (existing) {
            // Update fields from Comcash — stock, prices, vendor, comcashItemId
            await tx.inventoryItem.update({
              where: { sku },
              data: {
                name,
                comcashItemId: String(product.id),
                retailPrice: retailPrice,
                costPrice: costPrice > 0 ? costPrice : existing.costPrice,
                currentStock: onHand,
                vendorId: vendorId || existing.vendorId,
                isActive: product.statusId === 1,
                lastSyncedAt: new Date(),
              },
            });
            updated++;
          } else {
            await tx.inventoryItem.create({
              data: {
                sku,
                name,
                comcashItemId: String(product.id),
                retailPrice: retailPrice,
                costPrice: costPrice,
                currentStock: onHand,
                reorderPoint: 5,
                reorderQty: 10,
                vendorId,
                isActive: product.statusId === 1,
                lastSyncedAt: new Date(),
              },
            });
            created++;
          }
        }
      });
    }

    // Update last sync timestamp
    await prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: { lastProductSync: new Date() },
      create: { id: "singleton", lastProductSync: new Date() },
    });

    const result = {
      success: true,
      message: `Synced ${products.length} products from Comcash (${created} new, ${updated} updated, ${skipped} skipped)`,
      total: products.length,
      created,
      updated,
      skipped,
    };

    console.log(`[Comcash Product Sync] Complete:`, result);

    return NextResponse.json(result);
  } catch (error) {
    console.error("[Comcash Product Sync] Failed:", error);
    const message =
      error instanceof Error ? error.message : "Failed to sync products";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
