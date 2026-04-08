import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { sendEmail } from "@/lib/gmail";

/** Escape HTML special characters to prevent XSS */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Build the PO email HTML body */
function buildPoEmailHtml(po: {
  poNumber: string;
  createdAt: Date;
  expectedDate: Date | null;
  total: unknown;
  notes: string | null;
  vendor: { name: string; contactName: string | null; email: string | null };
  lineItems: Array<{
    description: string;
    vendorSku: string | null;
    qtyOrdered: number;
    unitCost: unknown;
    lineTotal: unknown;
    inventoryItem: { sku: string; name: string } | null;
  }>;
}): string {
  const itemRows = po.lineItems
    .map(
      (item, i) =>
        `<tr style="border-bottom:1px solid #eee;">
          <td style="padding:8px;">${i + 1}</td>
          <td style="padding:8px;">${escapeHtml(item.inventoryItem?.sku || item.vendorSku || "—")}</td>
          <td style="padding:8px;">${escapeHtml(item.description)}</td>
          <td style="padding:8px;text-align:center;">${item.qtyOrdered}</td>
          <td style="padding:8px;text-align:right;">$${Number(item.unitCost).toFixed(2)}</td>
          <td style="padding:8px;text-align:right;">$${Number(item.lineTotal).toFixed(2)}</td>
        </tr>`
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">
      <div style="background:#009B3A;padding:20px;border-radius:8px 8px 0 0;">
        <h1 style="color:#FFB81C;margin:0;font-size:22px;">Jamaica Herbal</h1>
        <p style="color:white;margin:4px 0 0;font-size:13px;">Purchase Order</p>
      </div>

      <div style="padding:24px;border:1px solid #eee;border-top:none;">
        <p>Dear ${escapeHtml(po.vendor.contactName || po.vendor.name)},</p>

        <p>Please find our purchase order <strong>${escapeHtml(po.poNumber)}</strong> below. We would appreciate confirmation of receipt and expected delivery date.</p>

        <div style="background:#f8f8f8;padding:12px;border-radius:6px;margin:16px 0;">
          <strong>PO Number:</strong> ${escapeHtml(po.poNumber)}<br>
          <strong>Date:</strong> ${new Date(po.createdAt).toLocaleDateString()}<br>
          ${po.expectedDate ? `<strong>Requested Delivery:</strong> ${new Date(po.expectedDate).toLocaleDateString()}<br>` : ""}
        </div>

        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <thead>
            <tr style="background:#009B3A;color:white;">
              <th style="padding:8px;text-align:left;">#</th>
              <th style="padding:8px;text-align:left;">SKU</th>
              <th style="padding:8px;text-align:left;">Description</th>
              <th style="padding:8px;text-align:center;">Qty</th>
              <th style="padding:8px;text-align:right;">Unit</th>
              <th style="padding:8px;text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
        </table>

        <div style="text-align:right;margin-top:12px;padding-top:12px;border-top:2px solid #009B3A;">
          <span style="font-size:18px;font-weight:bold;color:#009B3A;">
            Total: $${Number(po.total).toFixed(2)}
          </span>
        </div>

        ${po.notes ? `<div style="margin-top:16px;padding:12px;background:#fff9e6;border-radius:6px;border-left:4px solid #FFB81C;"><strong>Notes:</strong> ${escapeHtml(po.notes)}</div>` : ""}

        <p style="margin-top:24px;">Please reply to this email with your confirmation and estimated delivery date. If any items are unavailable, please let us know as soon as possible so we can arrange alternatives.</p>

        <p>Thank you for your continued partnership.</p>

        <p>
          Best regards,<br>
          <strong>Jamaica Herbal</strong><br>
          Lauderdale Lakes &amp; North Lauderdale, FL<br>
          (954) 854-2195
        </p>
      </div>

      <div style="background:#f5f5f5;padding:12px;text-align:center;font-size:11px;color:#999;border-radius:0 0 8px 8px;">
        This is an automated purchase order from Jamaica Herbal Procurement System
      </div>
    </div>
  `;
}

export async function POST(
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
            inventoryItem: { select: { sku: true, name: true } },
          },
        },
      },
    });

    if (!po) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    // Allow sending APPROVED POs and resending already-SENT POs
    if (po.status !== "APPROVED" && po.status !== "SENT") {
      return NextResponse.json(
        { error: `Cannot send a PO with status: ${po.status}. Must be APPROVED or SENT.` },
        { status: 400 }
      );
    }

    if (!po.vendor?.email) {
      return NextResponse.json(
        { error: "Vendor has no email address. Update the vendor before sending." },
        { status: 400 }
      );
    }

    // Build email content
    const emailHtml = buildPoEmailHtml(po);
    const subject = `Purchase Order ${po.poNumber} - Jamaica Herbal`;

    // Send email via Gmail SMTP
    const result = await sendEmail({
      to: po.vendor.email,
      subject,
      html: emailHtml,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: `Failed to send email: ${result.error}` },
        { status: 502 }
      );
    }

    // Email sent successfully — update PO status
    const isResend = po.status === "SENT";
    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        // Only set expectedDate on first send, not on resend
        expectedDate: isResend
          ? undefined
          : new Date(Date.now() + (po.vendor.leadTimeDays || 3) * 24 * 60 * 60 * 1000),
        statusHistory: {
          create: {
            fromStatus: po.status,
            toStatus: "SENT",
            note: isResend
              ? `PO re-sent to ${po.vendor.email} (Message ID: ${result.messageId})`
              : `PO emailed to ${po.vendor.email} (Message ID: ${result.messageId})`,
            triggeredBy: "user",
          },
        },
      },
      include: { vendor: true, lineItems: true },
    });

    return NextResponse.json({
      po: updated,
      message: `PO ${po.poNumber} sent to ${po.vendor.email}`,
      messageId: result.messageId,
    });
  } catch (error) {
    console.error("Failed to send PO:", error);
    return NextResponse.json({ error: "Failed to send purchase order" }, { status: 500 });
  }
}
