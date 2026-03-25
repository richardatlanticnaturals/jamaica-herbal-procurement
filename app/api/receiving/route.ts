import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ocrDeliverySlip } from "@/lib/ocr-delivery";
import { matchDeliveryToPO, type POLineItemForMatch } from "@/lib/fuzzy-match";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET /api/receiving
 * List all receiving records with associated PO info.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const [receivings, total] = await Promise.all([
      prisma.receiving.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          purchaseOrder: {
            select: {
              id: true,
              poNumber: true,
              status: true,
              vendor: { select: { id: true, name: true } },
            },
          },
          lineItems: true,
          _count: { select: { lineItems: true } },
        },
      }),
      prisma.receiving.count(),
    ]);

    return NextResponse.json({
      receivings,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Failed to fetch receivings:", error);
    return NextResponse.json(
      { error: "Failed to fetch receivings" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/receiving
 * Create a new receiving from a delivery photo.
 * Body: { purchaseOrderId: string, image: string (base64) }
 */
export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const { purchaseOrderId, image } = body;

    if (!purchaseOrderId || !image) {
      return NextResponse.json(
        { error: "purchaseOrderId and image are required" },
        { status: 400 }
      );
    }

    // Load the PO with line items
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: {
        lineItems: {
          include: { inventoryItem: true },
        },
        vendor: true,
      },
    });

    if (!po) {
      return NextResponse.json(
        { error: "Purchase order not found" },
        { status: 404 }
      );
    }

    // Step 1: Run OCR on the delivery slip image
    const ocrResult = await ocrDeliverySlip(image);

    // Step 2: Fuzzy match OCR items to PO line items
    const poLineItemsForMatch: POLineItemForMatch[] = po.lineItems.map(
      (li) => ({
        id: li.id,
        description: li.description,
        qtyOrdered: li.qtyOrdered,
        qtyReceived: li.qtyReceived,
        vendorSku: li.vendorSku,
        inventoryItemId: li.inventoryItemId,
      })
    );

    const matchResult = matchDeliveryToPO(ocrResult.items, poLineItemsForMatch);

    // Step 3: Create Receiving record with line items in a transaction
    const receiving = await prisma.$transaction(async (tx) => {
      const rec = await tx.receiving.create({
        data: {
          purchaseOrderId: po.id,
          receivedBy: "system",
          invoiceNumber: ocrResult.invoiceNumber,
          ocrRawText: JSON.stringify(ocrResult),
          ocrParsedData: ocrResult as any,
          matchStatus: "PENDING",
          lineItems: {
            create: matchResult.matches.map((match) => ({
              inventoryItemId: match.poLineItem?.inventoryItemId ?? null,
              ocrDescription: match.ocrItem.name,
              ocrQty: match.ocrItem.qty,
              ocrUnitCost: match.ocrItem.unitPrice,
              matchedToPoLine: match.status !== "UNMATCHED",
              matchConfidence: match.confidence,
              qtyAccepted: 0, // Not confirmed yet
            })),
          },
        },
        include: {
          lineItems: {
            include: {
              inventoryItem: {
                select: { id: true, name: true, sku: true },
              },
            },
          },
          purchaseOrder: {
            select: {
              id: true,
              poNumber: true,
              status: true,
              vendor: { select: { id: true, name: true } },
              lineItems: {
                include: {
                  inventoryItem: {
                    select: { id: true, name: true, sku: true },
                  },
                },
              },
            },
          },
        },
      });

      return rec;
    });

    // Enrich the response with match details for the UI
    // Match by ocrDescription instead of array index (Prisma order not guaranteed)
    const enrichedLineItems = receiving.lineItems.map((li) => {
      const match = matchResult.matches.find(
        (m) => m.ocrItem.name === li.ocrDescription
      );
      return {
        ...li,
        matchStatus: match?.status ?? "UNMATCHED",
        matchedPoLineItem: match?.poLineItem ?? null,
      };
    });

    return NextResponse.json(
      {
        receiving: {
          ...receiving,
          lineItems: enrichedLineItems,
        },
        ocrResult,
        matchResult,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create receiving:", error);
    const message =
      error instanceof Error ? error.message : "Failed to create receiving";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
