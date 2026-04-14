import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET /api/receiving/[id]
 * Fetch a single Receiving record with all related data:
 * - lineItems with inventoryItem (name, sku, currentStock)
 * - purchaseOrder with poNumber, vendor name
 * - All receiving fields
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;

    const receiving = await prisma.receiving.findUnique({
      where: { id },
      include: {
        lineItems: {
          include: {
            inventoryItem: {
              select: {
                id: true,
                name: true,
                sku: true,
                currentStock: true,
              },
            },
          },
        },
        purchaseOrder: {
          select: {
            id: true,
            poNumber: true,
            status: true,
            vendor: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!receiving) {
      return NextResponse.json(
        { error: "Receiving record not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ receiving });
  } catch (error) {
    console.error("Failed to fetch receiving:", error);
    return NextResponse.json(
      { error: "Failed to fetch receiving" },
      { status: 500 }
    );
  }
}
