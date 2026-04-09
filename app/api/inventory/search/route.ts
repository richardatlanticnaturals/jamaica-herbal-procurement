import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET /api/inventory/search?q=term&vendorId=optional
 * Search inventory items by name or SKU for PO line item selection.
 * Returns id, sku, name, currentStock, costPrice, vendorId. Limit 20 results.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") || "";
    const vendorId = searchParams.get("vendorId") || "";

    const where: any = { isActive: true };

    // Filter by search term (name or SKU)
    if (q.trim()) {
      where.OR = [
        { name: { contains: q.trim(), mode: "insensitive" } },
        { sku: { contains: q.trim(), mode: "insensitive" } },
      ];
    }

    // Optionally filter by vendor
    if (vendorId) {
      where.vendorId = vendorId;
    }

    const items = await prisma.inventoryItem.findMany({
      where,
      take: 20,
      orderBy: { name: "asc" },
      select: {
        id: true,
        sku: true,
        name: true,
        currentStock: true,
        reorderPoint: true,
        reorderQty: true,
        costPrice: true,
        vendorId: true,
        vendorSku: true,
        unitOfMeasure: true,
      },
    });

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Failed to search inventory:", error);
    return NextResponse.json(
      { error: "Failed to search inventory items" },
      { status: 500 }
    );
  }
}
