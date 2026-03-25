import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export async function POST() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    // Fix #6: Remove hardcoded stock threshold — fetch all active items with a vendor
    // and let the in-memory filter compare currentStock to each item's reorderPoint.
    const allItems = await prisma.inventoryItem.findMany({
      where: {
        isActive: true,
        vendorId: { not: null },
      },
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

        const lineItems = items.map((item) => ({
          inventoryItemId: item.id,
          vendorSku: item.vendorSku || null,
          description: item.name,
          qtyOrdered: item.reorderQty,
          unitCost: Number(item.costPrice),
          lineTotal: item.reorderQty * Number(item.costPrice),
        }));

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
