import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseVendorEmail, ParsedEmailResult } from "@/lib/parse-vendor-email";
import { POStatus } from "@/lib/generated/prisma/enums";
import { requireAuth } from "@/lib/api-auth";

/**
 * POST /api/email/parse
 * Accepts a vendor email, uses AI to extract structured data,
 * and updates the matching PO status + creates status log entries.
 */
export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const { subject, body: emailBody, from, messageId } = body;

    if (!subject || !emailBody || !from) {
      return NextResponse.json(
        { error: "Missing required fields: subject, body, from" },
        { status: 400 }
      );
    }

    // Parse the email with Claude
    let parsed: ParsedEmailResult;
    try {
      parsed = await parseVendorEmail({
        subject,
        body: emailBody,
        from,
      });
    } catch (aiError) {
      console.error("AI parsing failed:", aiError);
      return NextResponse.json(
        {
          error: "Failed to parse email with AI",
          details: aiError instanceof Error ? aiError.message : "Unknown error",
        },
        { status: 502 }
      );
    }

    // If not PO-related, return the parsed result without DB updates
    if (!parsed.isPoRelated) {
      return NextResponse.json({
        parsed,
        poUpdated: false,
        message: "Email is not related to a purchase order",
      });
    }

    // Try to find the matching PO
    let matchedPo = null;
    if (parsed.poNumber) {
      matchedPo = await prisma.purchaseOrder.findUnique({
        where: { poNumber: parsed.poNumber },
        include: {
          vendor: true,
          lineItems: { include: { inventoryItem: true } },
        },
      });
    }

    // If no PO found by number, try to match by vendor email
    if (!matchedPo && from) {
      const vendorEmail = extractEmailAddress(from);
      if (vendorEmail) {
        const vendor = await prisma.vendor.findFirst({
          where: { email: { equals: vendorEmail, mode: "insensitive" } },
        });

        if (vendor) {
          // Find the most recent SENT PO for this vendor
          matchedPo = await prisma.purchaseOrder.findFirst({
            where: {
              vendorId: vendor.id,
              status: { in: ["SENT", "CONFIRMED"] },
            },
            orderBy: { sentAt: "desc" },
            include: {
              vendor: true,
              lineItems: { include: { inventoryItem: true } },
            },
          });
        }
      }
    }

    // Update PO if found
    let poUpdated = false;
    if (matchedPo) {
      const newStatus = mapParsedStatusToPOStatus(parsed.status, matchedPo.status);
      const updateData: Record<string, unknown> = {};

      if (newStatus && newStatus !== matchedPo.status) {
        updateData.status = newStatus;
      }

      if (parsed.expectedDate) {
        const parsedDate = new Date(parsed.expectedDate);
        if (!isNaN(parsedDate.getTime())) {
          updateData.expectedDate = parsedDate;
        }
      }

      if (messageId) {
        updateData.confirmationId = messageId;
      }

      // Update PO
      if (Object.keys(updateData).length > 0) {
        await prisma.purchaseOrder.update({
          where: { id: matchedPo.id },
          data: updateData,
        });
        poUpdated = true;
      }

      // Create status log entry only if something changed
      if (poUpdated || parsed.outOfStockItems.length > 0) {
        await prisma.pOStatusLog.create({
          data: {
            purchaseOrderId: matchedPo.id,
            fromStatus: matchedPo.status,
            toStatus: newStatus || matchedPo.status,
            note: buildStatusNote(parsed, from),
            triggeredBy: "email-parser",
          },
        });
      }

      // Mark out-of-stock items on the PO line items
      if (parsed.outOfStockItems.length > 0) {
        await markOutOfStockItems(matchedPo.id, parsed.outOfStockItems);
      }

      // Log out-of-stock alerts
      if (parsed.outOfStockItems.length > 0) {
        console.log(
          `[ALERT] Out-of-stock items on ${matchedPo.poNumber}:`,
          parsed.outOfStockItems
        );
        console.log(
          `[ALERT] Alternatives suggested:`,
          parsed.alternatives
        );
      }
    }

    return NextResponse.json({
      parsed,
      poUpdated,
      matchedPoNumber: matchedPo?.poNumber || null,
      matchedPoId: matchedPo?.id || null,
      message: matchedPo
        ? `Email parsed and PO ${matchedPo.poNumber} updated`
        : parsed.poNumber
          ? `Email parsed but PO ${parsed.poNumber} not found in system`
          : "Email parsed but no PO number detected to match",
    });
  } catch (error) {
    console.error("Email parse endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error processing email" },
      { status: 500 }
    );
  }
}

/**
 * Map the AI-parsed status string to a valid POStatus enum value.
 * Respects the current status to avoid invalid transitions.
 */
function mapParsedStatusToPOStatus(
  parsedStatus: ParsedEmailResult["status"],
  currentStatus: POStatus
): POStatus | null {
  // Don't downgrade from already-received states
  const terminalStatuses: POStatus[] = ["RECEIVED", "CANCELLED", "CLOSED"];
  if (terminalStatuses.includes(currentStatus)) {
    return null;
  }

  switch (parsedStatus) {
    case "confirmed":
      return "CONFIRMED";
    case "partial":
      return "CONFIRMED"; // Partial confirmation, not partial physical receipt
    case "rejected":
      return "CANCELLED";
    case "out_of_stock":
      // If partially in stock, mark as partially received; otherwise keep current
      return currentStatus === "SENT" ? "CONFIRMED" : null;
    case "unknown":
    default:
      return null;
  }
}

/**
 * Build a human-readable note for the status log entry.
 */
function buildStatusNote(parsed: ParsedEmailResult, from: string): string {
  const parts: string[] = [`Email from ${from} parsed by AI.`];

  if (parsed.status !== "unknown") {
    parts.push(`Vendor status: ${parsed.status}.`);
  }

  if (parsed.expectedDate) {
    parts.push(`Expected delivery: ${parsed.expectedDate}.`);
  }

  if (parsed.outOfStockItems.length > 0) {
    parts.push(
      `Out of stock: ${parsed.outOfStockItems.join(", ")}.`
    );
  }

  if (parsed.alternatives.length > 0) {
    const altSummary = parsed.alternatives
      .map((a) => `${a.original} -> ${a.suggested}`)
      .join("; ");
    parts.push(`Alternatives: ${altSummary}.`);
  }

  if (parsed.notes) {
    parts.push(`Notes: ${parsed.notes}`);
  }

  return parts.join(" ");
}

/**
 * Mark PO line items as out of stock based on fuzzy name/SKU matching.
 */
async function markOutOfStockItems(
  purchaseOrderId: string,
  oosItemNames: string[]
): Promise<void> {
  const lineItems = await prisma.pOLineItem.findMany({
    where: { purchaseOrderId },
    include: { inventoryItem: true },
  });

  for (const lineItem of lineItems) {
    const itemName = lineItem.description.toLowerCase();
    const itemSku = lineItem.vendorSku?.toLowerCase() || "";
    // Fix: Guard against null inventoryItem to prevent null reference crash
    const inventoryName = lineItem.inventoryItem?.name?.toLowerCase() || "";
    const inventorySku = lineItem.inventoryItem?.sku?.toLowerCase() || "";

    const isOos = oosItemNames.some((oosName) => {
      const oosLower = oosName.toLowerCase();
      return (
        itemName.includes(oosLower) ||
        oosLower.includes(itemName) ||
        itemSku.includes(oosLower) ||
        oosLower.includes(itemSku) ||
        inventoryName.includes(oosLower) ||
        oosLower.includes(inventoryName) ||
        inventorySku.includes(oosLower) ||
        oosLower.includes(inventorySku)
      );
    });

    if (isOos && !lineItem.isOutOfStock) {
      await prisma.pOLineItem.update({
        where: { id: lineItem.id },
        data: {
          isOutOfStock: true,
          outOfStockNote: `Marked OOS by email parser. Items reported: ${oosItemNames.join(", ")}`,
        },
      });
    }
  }
}

/**
 * Extract a plain email address from a "Name <email>" format string.
 */
function extractEmailAddress(from: string): string | null {
  const match = from.match(/<([^>]+)>/);
  if (match) return match[1].toLowerCase();
  if (from.includes("@")) return from.trim().toLowerCase();
  return null;
}
