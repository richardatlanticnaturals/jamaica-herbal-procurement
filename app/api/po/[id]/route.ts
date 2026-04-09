import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        vendor: true,
        lineItems: {
          include: {
            inventoryItem: {
              select: { id: true, name: true, sku: true, currentStock: true },
            },
          },
        },
        statusHistory: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!po) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    return NextResponse.json({ po });
  } catch (error) {
    console.error("Failed to fetch PO:", error);
    return NextResponse.json({ error: "Failed to fetch purchase order" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();

    // Fix: Check if PO exists before updating to return proper 404
    const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    const po = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        notes: body.notes,
        locationCode: body.locationCode,
      },
      include: {
        vendor: true,
        lineItems: { include: { inventoryItem: true } },
      },
    });

    return NextResponse.json({ po });
  } catch (error) {
    console.error("Failed to update PO:", error);
    return NextResponse.json({ error: "Failed to update purchase order" }, { status: 500 });
  }
}
