import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    // Find all items at or below reorder point
    const lowStockItems = await prisma.inventoryItem.findMany({
      where: {
        isActive: true,
        vendorId: { not: null },
        currentStock: { lte: 5 }, // Will compare against reorderPoint per item
      },
      include: {
        vendor: true,
      },
    });

    // Filter items actually below their reorder point
    const itemsNeedingReorder = lowStockItems.filter(
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

    // Get settings for PO numbering
    const settings = await prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton" },
    });

    let nextSeq = settings.nextPoSequence;
    const year = new Date().getFullYear();
    const createdPOs: string[] = [];

    // Create a PO for each vendor
    for (const [vendorId, items] of byVendor) {
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

      await prisma.purchaseOrder.create({
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

      createdPOs.push(poNumber);
    }

    // Update sequence counter
    await prisma.appSettings.update({
      where: { id: "singleton" },
      data: { nextPoSequence: nextSeq },
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
