import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { fetchProductByBarcode } from "@/lib/comcash";

/**
 * GET /api/inventory/barcode?code=BARCODE_VALUE
 * Looks up a product by barcode/SKU in the local inventory database.
 * Falls back to Comcash product/searchByBarcode if not found locally.
 * Returns product details with vendor info and recent sales data.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code")?.trim();

    if (!code) {
      return NextResponse.json(
        { error: "Missing required parameter: code" },
        { status: 400 }
      );
    }

    // Step 1: Search local inventory by SKU
    let inventoryItem = await prisma.inventoryItem.findFirst({
      where: {
        isActive: true,
        OR: [
          { sku: { equals: code, mode: "insensitive" } },
          { vendorSku: { equals: code, mode: "insensitive" } },
        ],
      },
      include: {
        vendor: { select: { id: true, name: true } },
      },
    });

    // Step 2: If not found locally, try Comcash barcode search
    let comcashProduct = null;
    if (!inventoryItem) {
      try {
        comcashProduct = await fetchProductByBarcode(code);
      } catch (err) {
        // Comcash search failed -- not critical, continue without it
        console.warn("[Barcode] Comcash search failed:", err);
      }
    }

    // If neither found, return 404
    if (!inventoryItem && !comcashProduct) {
      return NextResponse.json(
        { error: "Product not found", code },
        { status: 404 }
      );
    }

    // Step 3: Get sales data for the last 4 months if we have a local item
    let salesData = null;
    const sku = inventoryItem?.sku;
    if (sku) {
      const fourMonthsAgo = new Date();
      fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4);

      const sales = await prisma.productSales.findMany({
        where: {
          sku,
          lastSoldAt: { gte: fourMonthsAgo },
        },
        orderBy: { periodEnd: "desc" },
        take: 4,
      });

      if (sales.length > 0) {
        salesData = {
          totalQtySold: sales.reduce((sum, s) => sum + s.totalQtySold, 0),
          totalRevenue: sales.reduce(
            (sum, s) => sum + Number(s.totalRevenue),
            0
          ),
          periods: sales.map((s) => ({
            start: s.periodStart.toISOString(),
            end: s.periodEnd.toISOString(),
            qtySold: s.totalQtySold,
            revenue: Number(s.totalRevenue),
          })),
        };
      }
    }

    // Build response
    if (inventoryItem) {
      return NextResponse.json({
        source: "local",
        product: {
          id: inventoryItem.id,
          sku: inventoryItem.sku,
          vendorSku: inventoryItem.vendorSku,
          name: inventoryItem.name,
          category: inventoryItem.category,
          currentStock: inventoryItem.currentStock,
          reorderPoint: inventoryItem.reorderPoint,
          reorderQty: inventoryItem.reorderQty,
          costPrice: Number(inventoryItem.costPrice),
          retailPrice: Number(inventoryItem.retailPrice),
          unitOfMeasure: inventoryItem.unitOfMeasure,
          locationLL: inventoryItem.locationLL,
          locationNL: inventoryItem.locationNL,
          vendor: inventoryItem.vendor,
        },
        sales: salesData,
      });
    }

    // Return Comcash-only result
    return NextResponse.json({
      source: "comcash",
      product: {
        id: null,
        comcashId: comcashProduct!.id,
        sku: comcashProduct!.skuCodes?.[0] || code,
        name: comcashProduct!.title,
        category: null,
        currentStock:
          typeof comcashProduct!.onHand === "number"
            ? comcashProduct!.onHand
            : null,
        costPrice: comcashProduct!.lastCost
          ? Number(comcashProduct!.lastCost)
          : null,
        retailPrice: comcashProduct!.price
          ? Number(comcashProduct!.price)
          : null,
        vendor: comcashProduct!.primaryVendorName
          ? { id: null, name: comcashProduct!.primaryVendorName }
          : null,
      },
      sales: null,
    });
  } catch (error) {
    console.error("[Barcode] Lookup failed:", error);
    return NextResponse.json(
      { error: "Barcode lookup failed" },
      { status: 500 }
    );
  }
}
