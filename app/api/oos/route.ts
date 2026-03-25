import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/oos
 * Returns all out-of-stock PO line items grouped by vendor,
 * including any existing AI-suggested alternatives.
 */
export async function GET() {
  try {
    // Find all PO line items marked as out of stock
    const oosItems = await prisma.pOLineItem.findMany({
      where: { isOutOfStock: true },
      include: {
        inventoryItem: {
          include: {
            vendor: { select: { id: true, name: true } },
            alternatives: {
              include: {
                altVendor: { select: { id: true, name: true } },
              },
              orderBy: { createdAt: "desc" },
            },
          },
        },
        purchaseOrder: {
          select: {
            id: true,
            poNumber: true,
            vendorId: true,
            vendor: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    // Group by vendor
    const vendorMap: Record<
      string,
      {
        vendorId: string;
        vendorName: string;
        items: typeof oosItems;
      }
    > = {};

    for (const item of oosItems) {
      const vendorId = item.purchaseOrder.vendorId;
      const vendorName = item.purchaseOrder.vendor?.name || "Unknown Vendor";

      if (!vendorMap[vendorId]) {
        vendorMap[vendorId] = {
          vendorId,
          vendorName,
          items: [],
        };
      }
      vendorMap[vendorId].items.push(item);
    }

    const grouped = Object.values(vendorMap);

    return NextResponse.json({
      vendors: grouped,
      totalOosItems: oosItems.length,
      totalVendors: grouped.length,
    });
  } catch (error) {
    console.error("Failed to fetch OOS items:", error);
    return NextResponse.json(
      { error: "Failed to fetch out-of-stock items" },
      { status: 500 }
    );
  }
}
