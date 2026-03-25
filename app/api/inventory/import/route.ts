import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Papa from "papaparse";
import { requireAuth } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Fix #10: File size limit (10MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB." },
        { status: 400 }
      );
    }

    const text = await file.text();
    const { data, errors } = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header: string) => header.trim(),
    });

    if (errors.length > 0) {
      return NextResponse.json(
        { error: "CSV parse errors", details: errors.slice(0, 5) },
        { status: 400 }
      );
    }

    const rows = data as Record<string, string>[];
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    // Cache vendors to avoid repeated DB lookups
    const vendorCache = new Map<string, string>();

    for (const row of rows) {
      // Comcash column mapping (also supports generic column names)
      const name =
        row["productTitle"] || row["Name"] || row["name"] || row["Description"] || row["Item Name"];
      const sku =
        row["sku"] || row["SKU"] || row["Item Number"] || row["Code"];
      const upc =
        row["upc"] || row["UPC"] || "";
      const comcashItemId =
        row["productId"] || "";

      // Use SKU first, fall back to UPC, then comcash product ID
      const itemKey = sku || upc || (comcashItemId ? `CC-${comcashItemId}` : "");

      if (!itemKey || !name) {
        skipped++;
        continue;
      }

      // Skip deleted/inactive products
      const status = row["status"] || "1";
      if (status === "0" || status === "deleted") {
        skipped++;
        continue;
      }

      const costPrice = parseFloat(row["lastCost"] || row["Cost"] || row["cost"] || "0") || 0;
      const retailPrice = parseFloat(row["price"] || row["Price"] || row["Retail"] || "0") || 0;
      const currentStock = Math.floor(
        parseFloat(row["warehouseQuantity"] || row["Qty"] || row["Stock"] || row["Quantity"] || "0") || 0
      );
      const minStock = parseInt(row["minStockLevel"] || row["Reorder Point"] || row["Min"] || "0", 10) || 0;
      const maxStock = parseInt(row["maxStockLevel"] || "0", 10) || 0;
      const reorderPoint = minStock || 5;
      const reorderQty = maxStock > minStock ? maxStock - minStock : 12;
      const category =
        row["categoryTitle"] || row["Category"] || row["category"] || null;
      const vendorIdComcash =
        row["primaryVendorId"] || "";
      const vendorSku =
        row["vendorProductId"] || "";
      const unitOfMeasure =
        row["sellUOMTitle"] || row["UOMGroupTitle"] || "each";
      const warehouseTitle =
        row["warehouseTitle"] || "";

      // Determine location stock from warehouse title
      let locationLL = 0;
      let locationNL = 0;
      if (warehouseTitle.includes("Lauderdale Lakes")) {
        locationLL = currentStock;
      } else if (warehouseTitle.includes("North Lauderdale")) {
        locationNL = currentStock;
      }

      // Find or create vendor by comcash vendor ID
      let vendorId: string | null = null;
      if (vendorIdComcash) {
        const cacheKey = vendorIdComcash;
        if (vendorCache.has(cacheKey)) {
          vendorId = vendorCache.get(cacheKey)!;
        } else {
          // For now, create vendor with comcash ID as name (we'll update names later)
          let vendor = await prisma.vendor.findFirst({
            where: { name: `Vendor-${vendorIdComcash}` },
          });
          if (!vendor) {
            vendor = await prisma.vendor.create({
              data: { name: `Vendor-${vendorIdComcash}` },
            });
          }
          vendorId = vendor.id;
          vendorCache.set(cacheKey, vendorId);
        }
      }

      // Upsert inventory item by SKU
      const existing = await prisma.inventoryItem.findUnique({
        where: { sku: itemKey },
      });

      const itemData = {
        name,
        costPrice,
        retailPrice,
        currentStock,
        reorderPoint,
        reorderQty,
        category: category === "NONE" ? null : category,
        vendorId: vendorId,
        vendorSku: vendorSku || null,
        comcashItemId: comcashItemId || null,
        unitOfMeasure,
        locationLL,
        locationNL,
        lastSyncedAt: new Date(),
      };

      if (existing) {
        await prisma.inventoryItem.update({
          where: { sku: itemKey },
          data: {
            ...itemData,
            vendorId: vendorId || existing.vendorId,
          },
        });
        updated++;
      } else {
        await prisma.inventoryItem.create({
          data: {
            sku: itemKey,
            ...itemData,
          },
        });
        imported++;
      }
    }

    // Return summary (don't fetch all 4000+ items at once)
    const totalItems = await prisma.inventoryItem.count({ where: { isActive: true } });

    return NextResponse.json({
      message: `Imported ${imported} new items, updated ${updated}, skipped ${skipped}`,
      imported,
      updated,
      skipped,
      totalItems,
    });
  } catch (error) {
    console.error("CSV import failed:", error);
    return NextResponse.json(
      { error: "Import failed. Please check the CSV format and try again." },
      { status: 500 }
    );
  }
}
