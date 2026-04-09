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

    // Check if PO exists before updating
    const existing = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: { lineItems: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    // Only allow edits on DRAFT and APPROVED POs
    if (!["DRAFT", "APPROVED"].includes(existing.status)) {
      return NextResponse.json(
        { error: `Cannot edit a PO with status ${existing.status}. Only DRAFT and APPROVED POs can be edited.` },
        { status: 400 }
      );
    }

    // If lineItems are provided, do a full line-item update inside a transaction
    if (body.lineItems) {
      const po = await prisma.$transaction(async (tx) => {
        // Delete removed line items: find IDs in existing that are NOT in the update payload
        const incomingIds = new Set(
          body.lineItems
            .filter((li: { id?: string }) => li.id)
            .map((li: { id: string }) => li.id)
        );
        const toDelete = existing.lineItems
          .filter((li) => !incomingIds.has(li.id))
          .map((li) => li.id);

        if (toDelete.length > 0) {
          await tx.pOLineItem.deleteMany({ where: { id: { in: toDelete } } });
        }

        // Upsert existing + create new line items
        for (const li of body.lineItems) {
          const lineTotal = (li.qtyOrdered || 1) * (li.unitCost || 0);
          if (li.id) {
            // Update existing line item
            await tx.pOLineItem.update({
              where: { id: li.id },
              data: {
                qtyOrdered: li.qtyOrdered,
                unitCost: li.unitCost,
                lineTotal,
                vendorSku: li.vendorSku ?? undefined,
                description: li.description ?? undefined,
              },
            });
          } else {
            // Create new line item
            await tx.pOLineItem.create({
              data: {
                purchaseOrderId: id,
                inventoryItemId: li.inventoryItemId,
                vendorSku: li.vendorSku || null,
                description: li.description,
                qtyOrdered: li.qtyOrdered || 1,
                unitCost: li.unitCost || 0,
                lineTotal,
              },
            });
          }
        }

        // Recalculate subtotal and total
        const allLines = await tx.pOLineItem.findMany({
          where: { purchaseOrderId: id },
        });
        const subtotal = allLines.reduce((sum, li) => sum + Number(li.lineTotal), 0);

        // Update PO with new totals and optional fields
        return await tx.purchaseOrder.update({
          where: { id },
          data: {
            subtotal,
            total: subtotal + Number(existing.tax) + Number(existing.shipping),
            notes: body.notes !== undefined ? body.notes : undefined,
          },
          include: {
            vendor: true,
            lineItems: {
              include: {
                inventoryItem: {
                  select: { id: true, name: true, sku: true, currentStock: true },
                },
              },
            },
            statusHistory: { orderBy: { createdAt: "asc" } },
          },
        });
      });

      return NextResponse.json({ po });
    }

    // Simple update (notes/locationCode only)
    const po = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        notes: body.notes,
        locationCode: body.locationCode,
      },
      include: {
        vendor: true,
        lineItems: {
          include: {
            inventoryItem: {
              select: { id: true, name: true, sku: true, currentStock: true },
            },
          },
        },
        statusHistory: { orderBy: { createdAt: "asc" } },
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
