import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
    });

    if (!po) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    if (po.status !== "DRAFT" && po.status !== "PENDING_APPROVAL") {
      return NextResponse.json(
        { error: `Cannot approve a PO with status: ${po.status}` },
        { status: 400 }
      );
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: "APPROVED",
        statusHistory: {
          create: {
            fromStatus: po.status,
            toStatus: "APPROVED",
            note: "Purchase order approved",
            triggeredBy: "user",
          },
        },
      },
      include: { vendor: true, lineItems: true },
    });

    return NextResponse.json({ po: updated });
  } catch (error) {
    console.error("Failed to approve PO:", error);
    return NextResponse.json({ error: "Failed to approve purchase order" }, { status: 500 });
  }
}
