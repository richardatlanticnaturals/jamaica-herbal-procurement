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

    if (!po.vendor?.email) {
      return NextResponse.json(
        { error: "Vendor has no email address" },
        { status: 400 }
      );
    }

    // Build the HTML email body
    const itemRows = po.lineItems
      .map(
        (item, i) =>
          `<tr style="border-bottom:1px solid #eee;">
            <td style="padding:8px;">${i + 1}</td>
            <td style="padding:8px;">${item.inventoryItem?.sku || item.vendorSku || "—"}</td>
            <td style="padding:8px;">${item.description}</td>
            <td style="padding:8px;text-align:center;">${item.qtyOrdered}</td>
            <td style="padding:8px;text-align:right;">$${Number(item.unitCost).toFixed(2)}</td>
            <td style="padding:8px;text-align:right;">$${Number(item.lineTotal).toFixed(2)}</td>
          </tr>`
      )
      .join("");

    const emailBody = `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">
        <div style="background:#009B3A;padding:20px;border-radius:8px 8px 0 0;">
          <h1 style="color:#FFB81C;margin:0;font-size:22px;">Jamaica Herbal</h1>
          <p style="color:white;margin:4px 0 0;font-size:13px;">Purchase Order</p>
        </div>

        <div style="padding:24px;border:1px solid #eee;border-top:none;">
          <p>Dear ${po.vendor.contactName || po.vendor.name},</p>

          <p>Please find our purchase order <strong>${po.poNumber}</strong> below. We would appreciate confirmation of receipt and expected delivery date.</p>

          <div style="background:#f8f8f8;padding:12px;border-radius:6px;margin:16px 0;">
            <strong>PO Number:</strong> ${po.poNumber}<br>
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

          ${po.notes ? `<div style="margin-top:16px;padding:12px;background:#fff9e6;border-radius:6px;border-left:4px solid #FFB81C;"><strong>Notes:</strong> ${po.notes}</div>` : ""}

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

    // Return the email data for the frontend to use with Gmail MCP
    // or for a future direct Gmail API integration
    return NextResponse.json({
      emailData: {
        to: po.vendor.email,
        subject: `Purchase Order ${po.poNumber} - Jamaica Herbal`,
        body: emailBody,
        bodyType: "html",
        poNumber: po.poNumber,
        vendorName: po.vendor.name,
      },
    });
  } catch (error) {
    console.error("Failed to generate email:", error);
    return NextResponse.json({ error: "Failed to generate email" }, { status: 500 });
  }
}
