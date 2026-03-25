import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchVendors } from "@/lib/comcash";

/**
 * POST /api/comcash/sync-vendors
 * Syncs vendors from Comcash POS into the local Vendor table.
 * Matches by comcashVendorId (or name fallback), skips vendors named "NONE".
 */
export async function POST() {
  try {
    const comcashVendors = await fetchVendors();

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const cv of comcashVendors) {
      const vendorName = (cv.vendor_name || "").trim();

      // Skip vendors with name "NONE" or empty
      if (!vendorName || vendorName.toUpperCase() === "NONE") {
        skipped++;
        continue;
      }

      const comcashId = String(cv.vendor_id);

      // Try to find existing vendor by comcashVendorId first
      let existing = await prisma.vendor.findUnique({
        where: { comcashVendorId: comcashId },
      });

      // Fallback: match by name if no comcashVendorId match
      if (!existing) {
        existing = await prisma.vendor.findFirst({
          where: {
            name: { equals: vendorName, mode: "insensitive" },
          },
        });
      }

      if (existing) {
        // Update existing vendor
        await prisma.vendor.update({
          where: { id: existing.id },
          data: {
            comcashVendorId: comcashId,
            name: vendorName,
            phone: cv.phone || existing.phone,
            email: cv.email || existing.email,
            contactName: cv.contact_name || existing.contactName,
          },
        });
        updated++;
      } else {
        // Create new vendor
        await prisma.vendor.create({
          data: {
            comcashVendorId: comcashId,
            name: vendorName,
            phone: cv.phone || null,
            email: cv.email || null,
            contactName: cv.contact_name || null,
            isActive: cv.is_active !== false,
          },
        });
        created++;
      }
    }

    // Update last sync timestamp in AppSettings
    await prisma.appSettings.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        lastVendorSync: new Date(),
      },
      update: {
        lastVendorSync: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      synced: created + updated,
      created,
      updated,
      skipped,
      total: comcashVendors.length,
    });
  } catch (error) {
    console.error("Comcash vendor sync failed:", error);
    return NextResponse.json(
      {
        error: "Vendor sync failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
