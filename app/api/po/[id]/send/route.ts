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
      include: {
        vendor: true,
        lineItems: { include: { inventoryItem: true } },
      },
    });

    if (!po) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    if (po.status !== "APPROVED") {
      return NextResponse.json(
        { error: `Cannot send a PO with status: ${po.status}. Must be APPROVED first.` },
        { status: 400 }
      );
    }

    if (!po.vendor?.email) {
      return NextResponse.json(
        { error: "Vendor has no email address. Update the vendor before sending." },
        { status: 400 }
      );
    }

    // TODO: Phase 2 complete - integrate Gmail API to actually send the email
    // For now, mark as SENT and log the action

    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        expectedDate: new Date(Date.now() + (po.vendor.leadTimeDays || 3) * 24 * 60 * 60 * 1000),
        statusHistory: {
          create: {
            fromStatus: "APPROVED",
            toStatus: "SENT",
            note: `PO ready to send to ${po.vendor.email}. Gmail integration pending.`,
            triggeredBy: "user",
          },
        },
      },
      include: { vendor: true, lineItems: true },
    });

    return NextResponse.json({
      po: updated,
      message: `PO ${po.poNumber} marked as sent. Gmail email integration coming next.`,
    });
  } catch (error) {
    console.error("Failed to send PO:", error);
    return NextResponse.json({ error: "Failed to send purchase order" }, { status: 500 });
  }
}
