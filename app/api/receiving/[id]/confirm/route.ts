import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { syncAllInventory } from "@/lib/shopify";
import { updateInventory } from "@/lib/comcash";

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

    // Guard: this endpoint is for PO-based receives only
    if (!receiving.purchaseOrder) {
      return NextResponse.json(
        { error: "This receiving has no associated PO. Use /api/receiving/quick/confirm instead." },
        { status: 400 }
      );
    }

    // Idempotency check — prevent double-confirm from doubling inventory
    if (receiving.matchStatus !== "PENDING") {
      return NextResponse.json(
        { error: "This receiving has already been confirmed" },
        { status: 409 }
      );
    }

    // Validate quantities before processing
    for (const item of lineItems) {
      if (item.qtyReceived < 0) {
        return NextResponse.json(
          { error: `Quantity received cannot be negative` },
          { status: 400 }
        );
      }
    }

    // Step 0: Pull latest stock from Comcash BEFORE adding received qty
    // This ensures we have current POS stock levels (accounts for in-store sales since last sync)
    try {
      const { refreshStock } = await import("@/lib/refresh-stock");
      await refreshStock();
      console.log("[Receiving] Stock refreshed from Comcash before confirming");
    } catch (refreshErr) {
      // Don't block receiving if refresh fails — just log and continue with app stock
      console.warn("[Receiving] Failed to refresh stock from Comcash before confirming:", refreshErr);
    }

    // Re-load the receiving with fresh stock data
    const freshReceiving = await prisma.receiving.findUnique({
      where: { id },
      include: {
        lineItems: true,
        purchaseOrder: { include: { lineItems: true } },
      },
    });
    if (!freshReceiving) {
      return NextResponse.json({ error: "Receiving not found after refresh" }, { status: 404 });
    }

    // Process everything in a transaction (using fresh stock levels)
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
          const poLine = receiving.purchaseOrder!.lineItems.find(
            (pl) => pl.inventoryItemId === recLine.inventoryItemId
          );

          if (poLine) {
            // Over-receiving guard: warn but still allow (some vendors ship extra)
            const newTotalReceived = poLine.qtyReceived + item.qtyReceived;
            if (newTotalReceived > poLine.qtyOrdered * 2) {
              // Hard cap at 2x ordered quantity to catch data entry mistakes
              throw new Error(
                `Receiving ${item.qtyReceived} of "${poLine.description}" would exceed 2x the ordered quantity (${poLine.qtyOrdered}). Please verify the quantity.`
              );
            }

            await tx.pOLineItem.update({
              where: { id: poLine.id },
              data: {
                qtyReceived: {
                  increment: item.qtyReceived,
                },
              },
            });
          }

          // 3. Update InventoryItem.currentStock, location-specific stock, and cost price
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
          // Update cost price from invoice/packing slip OCR data if available
          if (recLine.ocrUnitCost && Number(recLine.ocrUnitCost) > 0) {
            stockUpdateData.costPrice = Number(recLine.ocrUnitCost);
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
        where: { purchaseOrderId: receiving.purchaseOrderId! },
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

      const previousStatus = receiving.purchaseOrder!.status;

      // Update PO status only if there's something to update
      if (newPoStatus) {
        await tx.purchaseOrder.update({
          where: { id: receiving.purchaseOrderId! },
          data: {
            status: newPoStatus,
            receivedAt: allFullyReceived ? new Date() : undefined,
          },
        });

        // Create POStatusLog entry
        await tx.pOStatusLog.create({
          data: {
            purchaseOrderId: receiving.purchaseOrderId!,
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

    // Push updated stock levels to Shopify (non-blocking — log errors but don't fail the receiving)
    try {
      // Collect SKUs and their new stock levels from the confirmed items
      const inventoryItemIds = lineItems
        .map((li) => {
          const recLine = receiving.lineItems.find(
            (rl) => rl.id === li.receivingLineItemId
          );
          return recLine?.inventoryItemId;
        })
        .filter((id): id is string => !!id);

      if (inventoryItemIds.length > 0) {
        // Fetch the current stock for each updated inventory item
        const updatedItems = await prisma.inventoryItem.findMany({
          where: { id: { in: inventoryItemIds } },
          select: { sku: true, currentStock: true },
        });

        const syncPayload = updatedItems.map((item) => ({
          sku: item.sku,
          qty: item.currentStock,
        }));

        // Fire and forget — don't await so we don't block the response
        syncAllInventory(syncPayload)
          .then((results) => {
            const failed = results.filter((r) => !r.success);
            if (failed.length > 0) {
              console.warn(
                "Shopify sync: some items failed:",
                failed.map((f) => `${f.sku}: ${f.error}`)
              );
            } else {
              console.log(
                `Shopify sync: ${results.length} items synced successfully`
              );
            }
          })
          .catch((err) => {
            console.error("Shopify inventory sync error:", err);
          });
      }
    } catch (shopifyErr) {
      // Never fail the receiving because of a Shopify sync issue
      console.error("Shopify sync setup error:", shopifyErr);
    }

    // Push received quantities (deltas) to Comcash POS (non-blocking — log errors but don't fail the receiving)
    // IMPORTANT: Comcash warehouse/changeQuantity expects a DELTA (qty to add/subtract), NOT absolute stock.
    // For receiving, the delta is simply the qtyReceived for each item.
    try {
      // Build a map of inventoryItemId -> qtyReceived (the delta to push)
      const deltaMap = new Map<string, number>();
      for (const li of lineItems) {
        if (li.qtyReceived <= 0) continue;
        const recLine = receiving.lineItems.find(
          (rl) => rl.id === li.receivingLineItemId
        );
        if (recLine?.inventoryItemId) {
          deltaMap.set(recLine.inventoryItemId, li.qtyReceived);
        }
      }

      const comcashItemIds = Array.from(deltaMap.keys());

      if (comcashItemIds.length > 0) {
        // Fetch items that have a comcashItemId (linked to Comcash POS)
        const comcashItems = await prisma.inventoryItem.findMany({
          where: {
            id: { in: comcashItemIds },
            comcashItemId: { not: null },
          },
          select: { id: true, comcashItemId: true, comcashMeasureUnitId: true },
        });

        if (comcashItems.length > 0) {
          const comcashPayload = comcashItems.map((item) => ({
            productId: parseInt(item.comcashItemId!, 10),
            warehouseId: 2,
            measureUnitId: item.comcashMeasureUnitId || 1, // Use product-specific measureUnitId from DB
            quantity: deltaMap.get(item.id) || 0, // Delta: qty received (positive = add stock)
          }));

          // MUST await — fire-and-forget gets killed on Vercel serverless before completing
          try {
            const comcashResult = await updateInventory(comcashPayload);
            if (comcashResult.errors.length > 0) {
              console.warn("Comcash sync: some items failed:", comcashResult.errors);
            } else {
              console.log(`Comcash sync: ${comcashResult.updated} items pushed successfully (deltas)`);
            }
          } catch (err) {
            console.error("Comcash inventory push error:", err);
          }
        }
      }
    } catch (comcashErr) {
      // Never fail the receiving because of a Comcash sync issue
      console.error("Comcash sync setup error:", comcashErr);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to confirm receiving:", error);
    const message =
      error instanceof Error ? error.message : "Failed to confirm receiving";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
