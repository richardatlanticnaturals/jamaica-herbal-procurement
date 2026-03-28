import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { fetchAllProducts, type ComcashProduct } from "@/lib/comcash";

export const maxDuration = 300; // Allow up to 5 minutes for full sync

export async function POST() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    console.log("[Comcash Product Sync] Starting...");

    // Fetch all products from Comcash OpenAPI
    let lastLog = 0;
    const products = await fetchAllProducts((fetched) => {
      if (fetched - lastLog >= 100) {
        console.log(`[Comcash Product Sync] Fetched ${fetched} products...`);
        lastLog = fetched;
      }
    });

    console.log(`[Comcash Product Sync] Fetched ${products.length} products from Comcash`);

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
          const price = product.price ? parseFloat(product.price) : 0;

          // Find vendor by Comcash vendor ID
          let vendorId: string | null = null;
          if (product.primaryVendorId && product.primaryVendorName !== "NONE") {
            const vendor = await tx.vendor.findFirst({
              where: {
                OR: [
                  { comcashVendorId: String(product.primaryVendorId) },
                  { name: { contains: product.primaryVendorName || "", mode: "insensitive" } },
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
            // Update price and vendor if changed
            await tx.inventoryItem.update({
              where: { sku },
              data: {
                name,
                retailPrice: price,
                vendorId: vendorId || existing.vendorId,
                isActive: product.statusId === 1,
                // Don't overwrite costPrice or stock from Comcash — those come from CSV/receiving
              },
            });
            updated++;
          } else {
            await tx.inventoryItem.create({
              data: {
                sku,
                name,
                retailPrice: price,
                costPrice: 0,
                currentStock: 0,
                reorderPoint: 5,
                reorderQty: 10,
                vendorId,
                isActive: product.statusId === 1,
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
    return NextResponse.json(
      { error: "Failed to sync products from Comcash" },
      { status: 500 }
    );
  }
}
