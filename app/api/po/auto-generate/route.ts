import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    // Parse optional vendorIds from request body
    let vendorIds: string[] | null = null;
    try {
      const body = await request.json();
      if (body.vendorIds && Array.isArray(body.vendorIds) && body.vendorIds.length > 0) {
        vendorIds = body.vendorIds;
      }
    } catch {
      // No body or invalid JSON -- generate for all vendors
    }

    // Fetch active items with a vendor, optionally filtered by vendorIds
    const itemWhere: any = {
      isActive: true,
      vendorId: { not: null },
    };
    if (vendorIds) {
      itemWhere.vendorId = { in: vendorIds };
    }

    const allItems = await prisma.inventoryItem.findMany({
      where: itemWhere,
      include: {
        vendor: true,
      },
    });

    // Filter items actually below their reorder point
    const itemsNeedingReorder = allItems.filter(
      (item) => item.currentStock <= item.reorderPoint
    );

    if (itemsNeedingReorder.length === 0) {
      return NextResponse.json({
        message: "No items below reorder point",
        created: 0,
      });
    }

    // Fetch sales data for all items needing reorder to calculate qty from sales velocity
    const reorderSkus = itemsNeedingReorder.map((i) => i.sku).filter(Boolean);
    const fourMonthsAgo = new Date();
    fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4);
    const salesRecords = await prisma.productSales.findMany({
      where: { sku: { in: reorderSkus }, lastSoldAt: { gte: fourMonthsAgo } },
      select: { sku: true, totalQtySold: true },
    });
    // Build salesMap: sku -> totalQtySold (last 4 months)
    const salesMap = new Map<string, number>(salesRecords.map((s) => [s.sku, s.totalQtySold]));

    // Group by vendor
    const byVendor = new Map<string, typeof itemsNeedingReorder>();
    for (const item of itemsNeedingReorder) {
      if (!item.vendorId) continue;
      const existing = byVendor.get(item.vendorId) || [];
      existing.push(item);
      byVendor.set(item.vendorId, existing);
    }

    // Fix #3: Wrap the entire PO creation loop in a transaction
    const createdPOs = await prisma.$transaction(async (tx) => {
      // Get settings for PO numbering
      const settings = await tx.appSettings.upsert({
        where: { id: "singleton" },
        update: {},
        create: { id: "singleton" },
      });

      let nextSeq = settings.nextPoSequence;
      const year = new Date().getFullYear();
      const poNumbers: string[] = [];

      // Fix #8: Check for existing DRAFT POs per vendor to prevent duplicates
      const existingDraftVendorIds = new Set(
        (
          await tx.purchaseOrder.findMany({
            where: {
              status: "DRAFT",
              vendorId: { in: Array.from(byVendor.keys()) },
            },
            select: { vendorId: true },
          })
        ).map((po) => po.vendorId)
      );

      // Create a PO for each vendor (skip vendors with existing DRAFT POs)
      for (const [vendorId, items] of byVendor) {
        if (existingDraftVendorIds.has(vendorId)) {
          continue; // Skip — vendor already has a DRAFT PO
        }

        const poNumber = `${settings.poNumberPrefix}-${year}-${String(nextSeq).padStart(4, "0")}`;
        nextSeq++;

        // Exclude slow movers (0 sales in last 4 months) — never auto-add them to POs
        const activeItems = items.filter((item) => (salesMap.get(item.sku) || 0) > 0);
        if (activeItems.length === 0) continue; // Skip vendor if all items are slow movers

        // Order qty based on sales velocity: qtySoldLast4Months + 2, minimum 2
        const lineItems = activeItems.map((item) => {
          const qtyOrdered = Math.max(1, salesMap.get(item.sku) || 0);
          return {
            inventoryItemId: item.id,
            vendorSku: item.vendorSku || null,
            description: item.name,
            qtyOrdered,
            unitCost: Number(item.costPrice),
            lineTotal: qtyOrdered * Number(item.costPrice),
          };
        });

        const subtotal = lineItems.reduce((sum, li) => sum + li.lineTotal, 0);

        await tx.purchaseOrder.create({
          data: {
            poNumber,
            vendorId,
            status: "DRAFT",
            subtotal,
            total: subtotal,
            orderMethod: items[0].vendor?.orderMethod || "EMAIL",
            createdBy: "system",
            lineItems: {
              create: lineItems,
            },
            statusHistory: {
              create: {
                toStatus: "DRAFT",
                note: `Auto-generated: ${items.length} items below reorder point`,
                triggeredBy: "system",
              },
            },
          },
        });

        poNumbers.push(poNumber);
      }

      // Update sequence counter
      await tx.appSettings.update({
        where: { id: "singleton" },
        data: { nextPoSequence: nextSeq },
      });

      return poNumbers;
    });

    return NextResponse.json({
      message: `Created ${createdPOs.length} purchase orders for ${itemsNeedingReorder.length} low-stock items`,
      created: createdPOs.length,
      poNumbers: createdPOs,
      itemCount: itemsNeedingReorder.length,
    });
  } catch (error) {
    console.error("Auto-generate POs failed:", error);
    return NextResponse.json({ error: "Failed to auto-generate POs" }, { status: 500 });
  }
}

/**
 * GET /api/po/auto-generate
 * Returns a list of vendors that have low-stock items, with counts.
 * Used by the vendor selection dialog before auto-generating.
 */
export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const allItems = await prisma.inventoryItem.findMany({
      where: { isActive: true, vendorId: { not: null } },
      include: { vendor: { select: { id: true, name: true } } },
    });

    const lowStockItems = allItems.filter(
      (item) => item.currentStock <= item.reorderPoint
    );

    // Group by vendor and count
    const vendorMap = new Map<string, { id: string; name: string; lowStockCount: number }>();
    for (const item of lowStockItems) {
      if (!item.vendorId || !item.vendor) continue;
      const existing = vendorMap.get(item.vendorId);
      if (existing) {
        existing.lowStockCount++;
      } else {
        vendorMap.set(item.vendorId, {
          id: item.vendor.id,
          name: item.vendor.name,
          lowStockCount: 1,
        });
      }
    }

    // Check which vendors already have DRAFT POs
    const existingDraftVendorIds = new Set(
      (
        await prisma.purchaseOrder.findMany({
          where: { status: "DRAFT", vendorId: { in: Array.from(vendorMap.keys()) } },
          select: { vendorId: true },
        })
      ).map((po) => po.vendorId)
    );

    const vendors = Array.from(vendorMap.values()).map((v) => ({
      ...v,
      hasDraftPO: existingDraftVendorIds.has(v.id),
    }));

    // Sort by name
    vendors.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      vendors,
      totalLowStockItems: lowStockItems.length,
    });
  } catch (error) {
    console.error("Failed to fetch low-stock vendor data:", error);
    return NextResponse.json({ error: "Failed to fetch vendor data" }, { status: 500 });
  }
}
