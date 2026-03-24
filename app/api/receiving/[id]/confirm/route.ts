import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface ConfirmLineItem {
  receivingLineItemId: string;
  qtyReceived: number;
  matchStatus: "EXACT" | "FUZZY" | "UNMATCHED" | "MANUAL";
}

/**
 * POST /api/receiving/[id]/confirm
 * Confirm a receiving — update line items, PO quantities, and inventory.
 * Body: { lineItems: ConfirmLineItem[] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { lineItems } = body as { lineItems: ConfirmLineItem[] };

    if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
      return NextResponse.json(
        { error: "lineItems array is required" },
        { status: 400 }
      );
    }

    // Load the receiving with its PO
    const receiving = await prisma.receiving.findUnique({
      where: { id },
      include: {
        lineItems: true,
        purchaseOrder: {
          include: {
            lineItems: true,
          },
        },
      },
    });

    if (!receiving) {
      return NextResponse.json(
        { error: "Receiving not found" },
        { status: 404 }
      );
    }

    // Process everything in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Update each ReceivingLineItem
      for (const item of lineItems) {
        const recLine = receiving.lineItems.find(
          (rl) => rl.id === item.receivingLineItemId
        );
        if (!recLine) continue;

        await tx.receivingLineItem.update({
          where: { id: item.receivingLineItemId },
          data: {
            qtyAccepted: item.qtyReceived,
            matchedToPoLine: item.matchStatus !== "UNMATCHED",
            matchConfidence:
              item.matchStatus === "EXACT"
                ? 1.0
                : item.matchStatus === "FUZZY"
                  ? 0.75
                  : item.matchStatus === "MANUAL"
                    ? 1.0
                    : 0,
          },
        });

        // 2. Update the corresponding PO line item's qtyReceived
        if (recLine.inventoryItemId && item.qtyReceived > 0) {
          // Find the PO line item that matches this inventory item
          const poLine = receiving.purchaseOrder.lineItems.find(
            (pl) => pl.inventoryItemId === recLine.inventoryItemId
          );

          if (poLine) {
            await tx.pOLineItem.update({
              where: { id: poLine.id },
              data: {
                qtyReceived: {
                  increment: item.qtyReceived,
                },
              },
            });
          }

          // 3. Update InventoryItem.currentStock
          await tx.inventoryItem.update({
            where: { id: recLine.inventoryItemId },
            data: {
              currentStock: {
                increment: item.qtyReceived,
              },
            },
          });
        }
      }

      // 4. Determine new PO status
      // Reload the PO line items to get updated qtyReceived
      const updatedPoLines = await tx.pOLineItem.findMany({
        where: { purchaseOrderId: receiving.purchaseOrderId },
      });

      const allFullyReceived = updatedPoLines.every(
        (pl) => pl.qtyReceived >= pl.qtyOrdered
      );
      const someReceived = updatedPoLines.some((pl) => pl.qtyReceived > 0);

      let newPoStatus: "RECEIVED" | "PARTIALLY_RECEIVED";
      if (allFullyReceived) {
        newPoStatus = "RECEIVED";
      } else if (someReceived) {
        newPoStatus = "PARTIALLY_RECEIVED";
      } else {
        newPoStatus = "PARTIALLY_RECEIVED";
      }

      const previousStatus = receiving.purchaseOrder.status;

      // Update PO status
      await tx.purchaseOrder.update({
        where: { id: receiving.purchaseOrderId },
        data: {
          status: newPoStatus,
          receivedAt: allFullyReceived ? new Date() : undefined,
        },
      });

      // 5. Create POStatusLog entry
      await tx.pOStatusLog.create({
        data: {
          purchaseOrderId: receiving.purchaseOrderId,
          fromStatus: previousStatus,
          toStatus: newPoStatus,
          note: `Receiving ${id} confirmed — ${lineItems.length} line items processed`,
          triggeredBy: "receiving",
        },
      });

      // 6. Update Receiving match status
      const hasUnmatched = lineItems.some(
        (li) => li.matchStatus === "UNMATCHED"
      );
      const hasFuzzy = lineItems.some((li) => li.matchStatus === "FUZZY");

      let receivingMatchStatus: "MATCHED" | "PARTIAL_MATCH" | "MANUAL_REVIEW";
      if (hasUnmatched) {
        receivingMatchStatus = "MANUAL_REVIEW";
      } else if (hasFuzzy) {
        receivingMatchStatus = "PARTIAL_MATCH";
      } else {
        receivingMatchStatus = "MATCHED";
      }

      const updatedReceiving = await tx.receiving.update({
        where: { id },
        data: { matchStatus: receivingMatchStatus },
        include: {
          lineItems: {
            include: {
              inventoryItem: {
                select: { id: true, name: true, sku: true, currentStock: true },
              },
            },
          },
          purchaseOrder: {
            select: {
              id: true,
              poNumber: true,
              status: true,
              vendor: { select: { name: true } },
            },
          },
        },
      });

      return { receiving: updatedReceiving, newPoStatus };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to confirm receiving:", error);
    const message =
      error instanceof Error ? error.message : "Failed to confirm receiving";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
