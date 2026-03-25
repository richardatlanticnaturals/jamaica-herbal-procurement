import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const [
      totalItems,
      outOfStockItems,
      activePOs,
      totalVendors,
      pendingReceivings,
      recentPOs,
      recentAlerts,
      lowStockRaw,
    ] = await Promise.all([
      // Total active inventory items
      prisma.inventoryItem.count({ where: { isActive: true } }),

      // Out of stock: currentStock <= 0
      prisma.inventoryItem.count({
        where: { isActive: true, currentStock: { lte: 0 } },
      }),

      // Active POs (open statuses)
      prisma.purchaseOrder.count({
        where: {
          status: {
            in: [
              "DRAFT",
              "APPROVED",
              "SENT",
              "CONFIRMED",
              "PARTIALLY_RECEIVED",
            ],
          },
        },
      }),

      // Total vendors
      prisma.vendor.count(),

      // Pending receivings: POs that have been sent or confirmed but not yet received
      prisma.purchaseOrder.count({
        where: { status: { in: ["SENT", "CONFIRMED"] } },
      }),

      // Recent 5 POs with vendor name
      prisma.purchaseOrder.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          poNumber: true,
          status: true,
          total: true,
          createdAt: true,
          vendor: { select: { name: true } },
        },
      }),

      // Recent 5 status log entries with PO + vendor info
      prisma.pOStatusLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          note: true,
          triggeredBy: true,
          createdAt: true,
          purchaseOrder: {
            select: {
              poNumber: true,
              vendor: { select: { name: true } },
            },
          },
        },
      }),

      // Low stock: currentStock > 0 AND currentStock <= reorderPoint
      // Must use $queryRaw because Prisma can't compare two columns
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint as count
        FROM "InventoryItem"
        WHERE "isActive" = true
          AND "currentStock" > 0
          AND "currentStock" <= "reorderPoint"
      `,
    ]);

    const lowStockItems = Number(lowStockRaw[0]?.count ?? 0);

    return NextResponse.json({
      totalItems,
      lowStockItems,
      outOfStockItems,
      activePOs,
      totalVendors,
      pendingReceivings,
      recentPOs: recentPOs.map((po) => ({
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
        total: Number(po.total),
        createdAt: po.createdAt.toISOString(),
        vendorName: po.vendor?.name ?? "Unknown",
      })),
      recentAlerts: recentAlerts.map((log) => ({
        id: log.id,
        fromStatus: log.fromStatus,
        toStatus: log.toStatus,
        note: log.note,
        triggeredBy: log.triggeredBy,
        createdAt: log.createdAt.toISOString(),
        poNumber: log.purchaseOrder.poNumber,
        vendorName: log.purchaseOrder.vendor?.name ?? "Unknown",
      })),
    });
  } catch (error) {
    console.error("Failed to fetch dashboard data:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard data" },
      { status: 500 }
    );
  }
}
