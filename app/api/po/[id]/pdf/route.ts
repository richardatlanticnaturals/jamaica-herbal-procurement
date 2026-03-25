import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generatePOPdf } from "@/lib/generate-po-pdf";
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
              select: { sku: true },
            },
          },
        },
      },
    });

    if (!po) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    const pdfBuffer = generatePOPdf({
      ...po,
      createdAt: po.createdAt.toISOString(),
      expectedDate: po.expectedDate?.toISOString() || null,
      subtotal: Number(po.subtotal),
      total: Number(po.total),
      lineItems: po.lineItems.map((li) => ({
        ...li,
        unitCost: Number(li.unitCost),
        lineTotal: Number(li.lineTotal),
      })),
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${po.poNumber}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Failed to generate PDF:", error);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
