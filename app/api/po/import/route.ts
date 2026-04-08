import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

/**
 * Import POs from Comcash admin scrape data.
 * Expects JSON array of { poNumber, vendor, location, status, total, created, requiredDate, received }
 */
export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const pos: Array<{
      poNumber: string;
      vendor: string;
      location: string;
      status: string;
      reference?: string;
      invoice?: string;
      total: string;
      created: string;
      requiredDate: string;
      received: string;
    }> = await request.json();

    if (!Array.isArray(pos) || pos.length === 0) {
      return NextResponse.json({ error: "Expected a JSON array of POs" }, { status: 400 });
    }

    let imported = 0;
    let skipped = 0;
    let errors: string[] = [];

    for (const po of pos) {
      try {
        // Build a PO number like "CC-357" to distinguish from app-generated POs
        const poNumber = `CC-${po.poNumber}`;

        // Check if already imported
        const existing = await prisma.purchaseOrder.findUnique({
          where: { poNumber },
        });
        if (existing) {
          skipped++;
          continue;
        }

        // Find or create vendor
        let vendor = await prisma.vendor.findFirst({
          where: { name: { equals: po.vendor, mode: "insensitive" } },
        });
        if (!vendor) {
          vendor = await prisma.vendor.create({
            data: { name: po.vendor, orderMethod: "EMAIL" },
          });
        }

        // Parse dates
        const createdAt = po.created ? new Date(po.created) : new Date();
        const expectedDate = po.requiredDate ? new Date(po.requiredDate) : null;
        const receivedAt = po.received ? new Date(po.received) : null;

        // Map Comcash status to our PO status
        let status: string;
        switch (po.status.toLowerCase()) {
          case "closed":
            status = "CLOSED";
            break;
          case "pending":
            status = "SENT"; // Pending in Comcash = sent to vendor, awaiting delivery
            break;
          case "received":
            status = "RECEIVED";
            break;
          case "cancelled":
          case "canceled":
            status = "CANCELLED";
            break;
          default:
            status = "DRAFT";
        }

        // Parse total (remove commas)
        const total = parseFloat(po.total.replace(/,/g, "")) || 0;

        // Determine location code
        const locationCode = po.location?.toLowerCase().includes("north lauderdale")
          ? "NL"
          : "LL";

        await prisma.purchaseOrder.create({
          data: {
            poNumber,
            vendorId: vendor.id,
            status: status as any,
            subtotal: total,
            total: total,
            orderMethod: "EMAIL",
            locationCode,
            createdBy: "comcash-import",
            createdAt,
            sentAt: status === "SENT" || status === "CLOSED" || status === "RECEIVED" ? createdAt : null,
            expectedDate,
            receivedAt: receivedAt || (status === "CLOSED" ? expectedDate : null),
            notes: po.reference ? `Ref: ${po.reference}` : (po.invoice ? `Invoice: ${po.invoice}` : null),
            statusHistory: {
              create: {
                toStatus: status,
                note: `Imported from Comcash POS (original PO #${po.poNumber})`,
                triggeredBy: "comcash-import",
              },
            },
          },
        });

        imported++;
      } catch (err: any) {
        errors.push(`PO #${po.poNumber}: ${err.message}`);
      }
    }

    // Update PO sequence to avoid conflicts with future auto-generated POs
    const maxComcashNum = Math.max(...pos.map(p => parseInt(p.poNumber) || 0));
    if (maxComcashNum > 0) {
      await prisma.appSettings.upsert({
        where: { id: "singleton" },
        update: {
          nextPoSequence: { increment: 0 }, // Don't change if already higher
        },
        create: { id: "singleton" },
      });
    }

    return NextResponse.json({
      message: `Imported ${imported} POs, skipped ${skipped} duplicates`,
      imported,
      skipped,
      total: pos.length,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    });
  } catch (error) {
    console.error("Failed to import POs:", error);
    return NextResponse.json({ error: "Failed to import purchase orders" }, { status: 500 });
  }
}
