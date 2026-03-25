import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

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
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();
    const { lineItems, locationCode } = body as {
      lineItems: ConfirmLineItem[];
      locationCode?: "LL" | "NL";
    };

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

    // Idempotency check — prevent double-confirm from doubling inventory
    if (receiving.matchStatus !== "PENDING") {
      return NextResponse.json(
        { error: "This receiving has already been confirmed" },
        { status: 409 }
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

          // 3. Update InventoryItem.currentStock and location-specific stock
          const stockUpdateData: Record<string, any> = {
            currentStock: {
              increment: item.qtyReceived,
            },
          };
          if (locationCode === "LL") {
            stockUpdateData.locationLL = { increment: item.qtyReceived };
          } else if (locationCode === "NL") {
            stockUpdateData.locationNL = { increment: item.qtyReceived };
          }
          await tx.inventoryItem.update({
            where: { id: recLine.inventoryItemId },
            data: stockUpdateData,
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

      let newPoStatus: "RECEIVED" | "PARTIALLY_RECEIVED" | null;
      if (allFullyReceived) {
        newPoStatus = "RECEIVED";
      } else if (someReceived) {
        newPoStatus = "PARTIALLY_RECEIVED";
      } else {
        newPoStatus = null; // Don't change status if nothing was received
      }

      const previousStatus = receiving.purchaseOrder.status;

      // Update PO status only if there's something to update
      if (newPoStatus) {
        await tx.purchaseOrder.update({
          where: { id: receiving.purchaseOrderId },
          data: {
            status: newPoStatus,
            receivedAt: allFullyReceived ? new Date() : undefined,
          },
        });

        // Create POStatusLog entry
        await tx.pOStatusLog.create({
          data: {
            purchaseOrderId: receiving.purchaseOrderId,
            fromStatus: previousStatus,
            toStatus: newPoStatus,
            note: `Receiving ${id} confirmed — ${lineItems.length} line items processed`,
            triggeredBy: "receiving",
          },
        });
      }

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
