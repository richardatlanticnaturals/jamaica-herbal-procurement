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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;

    const po = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    // Only allow deleting DRAFT, APPROVED, or CANCELLED POs
    const deletableStatuses = ["DRAFT", "APPROVED", "CANCELLED"];
    if (!deletableStatuses.includes(po.status)) {
      return NextResponse.json(
        { error: `Cannot delete a PO with status: ${po.status}. Only DRAFT, APPROVED, or CANCELLED POs can be deleted.` },
        { status: 400 }
      );
    }

    // Delete in order: status logs, line items, receivings, then PO
    await prisma.$transaction(async (tx) => {
      await tx.pOStatusLog.deleteMany({ where: { purchaseOrderId: id } });
      await tx.pOLineItem.deleteMany({ where: { purchaseOrderId: id } });
      // Delete any receivings and their line items
      const receivings = await tx.receiving.findMany({ where: { purchaseOrderId: id }, select: { id: true } });
      for (const r of receivings) {
        await tx.receivingLineItem.deleteMany({ where: { receivingId: r.id } });
      }
      await tx.receiving.deleteMany({ where: { purchaseOrderId: id } });
      await tx.purchaseOrder.delete({ where: { id } });
    });

    return NextResponse.json({ success: true, message: `PO ${po.poNumber} deleted` });
  } catch (error) {
    console.error("Failed to delete PO:", error);
    return NextResponse.json({ error: "Failed to delete purchase order" }, { status: 500 });
  }
}
