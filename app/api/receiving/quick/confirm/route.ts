import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { syncAllInventory } from "@/lib/shopify";
import { updateInventory } from "@/lib/comcash";

/**
 * POST /api/receiving/quick/confirm
 * Confirm a Quick Receive -- update stock for each accepted item,
 * create a Receiving audit record (purchaseOrderId = null), and
 * push updated stock to Comcash + Shopify (non-blocking).
 *
 * Body: {
 *   items: [{ inventoryItemId, qtyReceived, matchStatus }],
 *   locationCode?: "LL" | "NL",
 *   invoiceNumber?: string
 * }
 */

interface QuickConfirmItem {
  inventoryItemId: string;
  qtyReceived: number;
  matchStatus: "EXACT" | "FUZZY" | "MANUAL";
  ocrDescription?: string;
  ocrUnitCost?: number | null;
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const { items, locationCode, invoiceNumber } = body as {
      items: QuickConfirmItem[];
      locationCode?: "LL" | "NL";
      invoiceNumber?: string;
    };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "items array is required" },
        { status: 400 }
      );
    }

    // Validate quantities
    for (const item of items) {
      if (!item.inventoryItemId) {
        return NextResponse.json(
          { error: "Each item must have an inventoryItemId" },
          { status: 400 }
        );
      }
      if (item.qtyReceived < 0) {
        return NextResponse.json(
          { error: "Quantity received cannot be negative" },
          { status: 400 }
        );
      }
    }

    // Step 0: Refresh stock from Comcash before confirming
    try {
      const { refreshStock } = await import("@/lib/refresh-stock");
      await refreshStock();
      console.log("[Quick Receive] Stock refreshed from Comcash before confirming");
    } catch (refreshErr) {
      // Don't block receiving if refresh fails
      console.warn("[Quick Receive] Failed to refresh stock:", refreshErr);
    }

    // Process in a transaction: create Receiving record + update stock
    const result = await prisma.$transaction(async (tx) => {
      // Create the Receiving audit record (no PO)
      const receiving = await tx.receiving.create({
        data: {
          purchaseOrderId: null, // Quick Receive -- no PO
          receivedBy: "system",
          invoiceNumber: invoiceNumber || null,
          locationCode: locationCode || null,
          matchStatus: "MATCHED",
          notes: "Quick Receive (no PO)",
          lineItems: {
            create: items.map((item) => ({
              inventoryItemId: item.inventoryItemId,
              ocrDescription: item.ocrDescription || "Quick Receive item",
              ocrQty: item.qtyReceived,
              ocrUnitCost: item.ocrUnitCost ?? null,
              matchedToPoLine: false,
              matchConfidence:
                item.matchStatus === "EXACT"
                  ? 1.0
                  : item.matchStatus === "FUZZY"
                    ? 0.75
                    : 1.0, // MANUAL = user confirmed
              qtyAccepted: item.qtyReceived,
            })),
          },
        },
        include: {
          lineItems: {
            include: {
              inventoryItem: {
                select: { id: true, name: true, sku: true, currentStock: true },
              },
            },
          },
        },
      });

      // Update stock for each item
      for (const item of items) {
        if (item.qtyReceived <= 0) continue;

        const stockUpdate: Record<string, unknown> = {
          currentStock: { increment: item.qtyReceived },
        };
        if (locationCode === "LL") {
          stockUpdate.locationLL = { increment: item.qtyReceived };
        } else if (locationCode === "NL") {
          stockUpdate.locationNL = { increment: item.qtyReceived };
        }
        // Update cost price from OCR if available
        if (item.ocrUnitCost && Number(item.ocrUnitCost) > 0) {
          stockUpdate.costPrice = Number(item.ocrUnitCost);
        }

        await tx.inventoryItem.update({
          where: { id: item.inventoryItemId },
          data: stockUpdate,
        });
      }

      return receiving;
    });

    // Collect inventory item IDs that were updated
    const updatedItemIds = items
      .filter((i) => i.qtyReceived > 0)
      .map((i) => i.inventoryItemId);

    // Push to Shopify (non-blocking)
    if (updatedItemIds.length > 0) {
      prisma.inventoryItem
        .findMany({
          where: { id: { in: updatedItemIds } },
          select: { sku: true, currentStock: true },
        })
        .then((updatedItems) => {
          const syncPayload = updatedItems.map((item) => ({
            sku: item.sku,
            qty: item.currentStock,
          }));
          return syncAllInventory(syncPayload);
        })
        .then((results) => {
          const failed = results.filter((r) => !r.success);
          if (failed.length > 0) {
            console.warn("[Quick Receive] Shopify sync partial failures:", failed.map((f) => `${f.sku}: ${f.error}`));
          } else {
            console.log(`[Quick Receive] Shopify sync: ${results.length} items synced`);
          }
        })
        .catch((err) => {
          console.error("[Quick Receive] Shopify sync error:", err);
        });
    }

    // Push to Comcash (non-blocking)
    if (updatedItemIds.length > 0) {
      prisma.inventoryItem
        .findMany({
          where: {
            id: { in: updatedItemIds },
            comcashItemId: { not: null },
          },
          select: { comcashItemId: true, currentStock: true },
        })
        .then((comcashItems) => {
          if (comcashItems.length === 0) return;
          const payload = comcashItems.map((item) => ({
            productId: parseInt(item.comcashItemId!, 10),
            warehouseId: 1,
            quantity: item.currentStock,
          }));
          return updateInventory(payload);
        })
        .then((comcashResult) => {
          if (comcashResult && comcashResult.errors.length > 0) {
            console.warn("[Quick Receive] Comcash sync errors:", comcashResult.errors);
          } else if (comcashResult) {
            console.log(`[Quick Receive] Comcash sync: ${comcashResult.updated} items pushed`);
          }
        })
        .catch((err) => {
          console.error("[Quick Receive] Comcash sync error:", err);
        });
    }

    return NextResponse.json({
      receiving: result,
      itemsReceived: items.filter((i) => i.qtyReceived > 0).length,
      totalQtyReceived: items.reduce((sum, i) => sum + i.qtyReceived, 0),
    });
  } catch (error) {
    console.error("Quick receive confirm failed:", error);
    const message =
      error instanceof Error ? error.message : "Failed to confirm quick receive";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
