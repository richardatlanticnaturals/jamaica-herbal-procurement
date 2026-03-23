import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Papa from "papaparse";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const text = await file.text();
    const { data, errors } = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header: string) => header.trim(),
    });

    if (errors.length > 0) {
      return NextResponse.json(
        { error: "CSV parse errors", details: errors },
        { status: 400 }
      );
    }

    const rows = data as Record<string, string>[];
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      // Map common CSV column names to our fields
      const sku =
        row["SKU"] || row["sku"] || row["Item Number"] || row["ItemNumber"] || row["Code"];
      const name =
        row["Name"] || row["name"] || row["Description"] || row["Item Name"] || row["ItemName"];

      if (!sku || !name) {
        skipped++;
        continue;
      }

      const costPrice = parseFloat(
        row["Cost"] || row["cost"] || row["Cost Price"] || row["CostPrice"] || "0"
      );
      const retailPrice = parseFloat(
        row["Price"] || row["price"] || row["Retail"] || row["RetailPrice"] || "0"
      );
      const currentStock = parseInt(
        row["Qty"] || row["qty"] || row["Stock"] || row["Quantity"] || row["On Hand"] || "0",
        10
      );
      const reorderPoint = parseInt(
        row["Reorder Point"] || row["ReorderPoint"] || row["Min"] || "5",
        10
      );
      const category =
        row["Category"] || row["category"] || row["Department"] || null;
      const vendorName =
        row["Vendor"] || row["vendor"] || row["Supplier"] || null;

      // Find or create vendor if specified
      let vendorId: string | null = null;
      if (vendorName) {
        let vendor = await prisma.vendor.findFirst({
          where: { name: vendorName },
        });
        if (!vendor) {
          vendor = await prisma.vendor.create({ data: { name: vendorName } });
        }
        vendorId = vendor.id;
      }

      // Upsert inventory item by SKU
      const existing = await prisma.inventoryItem.findUnique({
        where: { sku },
      });

      if (existing) {
        await prisma.inventoryItem.update({
          where: { sku },
          data: {
            name,
            costPrice,
            retailPrice,
            currentStock,
            reorderPoint,
            category,
            vendorId: vendorId || existing.vendorId,
            lastSyncedAt: new Date(),
          },
        });
        updated++;
      } else {
        await prisma.inventoryItem.create({
          data: {
            sku,
            name,
            costPrice,
            retailPrice,
            currentStock,
            reorderPoint,
            category,
            vendorId,
            lastSyncedAt: new Date(),
          },
        });
        imported++;
      }
    }

    // Fetch all items to return
    const items = await prisma.inventoryItem.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: {
        vendor: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({
      message: `Imported ${imported} new items, updated ${updated}, skipped ${skipped}`,
      imported,
      updated,
      skipped,
      items,
    });
  } catch (error) {
    console.error("CSV import failed:", error);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
