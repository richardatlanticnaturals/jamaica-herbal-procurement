import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { fetchVendors } from "@/lib/comcash";

/**
 * POST /api/comcash/sync-vendors
 * Syncs vendors from Comcash POS into the local Vendor table.
 * Matches by comcashVendorId (or name fallback), skips vendors named "NONE".
 */
export async function POST() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const comcashVendors = await fetchVendors();

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const cv of comcashVendors) {
      // V2 API uses 'name', legacy uses 'vendor_name' — handle both
      const vendorName = ((cv as any).name || (cv as any).vendor_name || "").trim();

      // Skip vendors with name "NONE" or empty
      if (!vendorName || vendorName.toUpperCase() === "NONE") {
        skipped++;
        continue;
      }

      const comcashId = String((cv as any).id || (cv as any).vendor_id);

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

      const phone = cv.phone || "";
      const email = cv.email || "";

      if (existing) {
        await prisma.vendor.update({
          where: { id: existing.id },
          data: {
            comcashVendorId: comcashId,
            name: vendorName,
            phone: phone || existing.phone,
            email: email || existing.email,
          },
        });
        updated++;
      } else {
        await prisma.vendor.create({
          data: {
            comcashVendorId: comcashId,
            name: vendorName,
            phone: phone || null,
            email: email || null,
            isActive: true,
          },
        });
        created++;
      }
    }

    // Update last sync timestamp
    await prisma.appSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", lastVendorSync: new Date() },
      update: { lastVendorSync: new Date() },
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
      { error: "Vendor sync failed" },
      { status: 500 }
    );
  }
}
