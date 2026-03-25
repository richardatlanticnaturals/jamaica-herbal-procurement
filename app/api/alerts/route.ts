import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export interface AlertItem {
  id: string;
  type: "oos" | "confirmed" | "partial" | "rejected" | "status_change" | "delivery";
  message: string;
  severity: "red" | "green" | "yellow" | "blue";
  poId: string;
  poNumber: string;
  vendorName: string | null;
  createdAt: string;
  details: string | null;
}

/**
 * GET /api/alerts
 * Returns recent alerts derived from POStatusLog entries and PO state.
 * Covers the last 7 days by default (configurable via ?days= query param).
 */
export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "7", 10);
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    // Fetch recent status log entries with PO and vendor info
    const statusLogs = await prisma.pOStatusLog.findMany({
      where: {
        createdAt: { gte: sinceDate },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        purchaseOrder: {
          include: {
            vendor: { select: { name: true } },
          },
        },
      },
    });

    // Fetch POs with out-of-stock line items (recent)
    const oosOrders = await prisma.purchaseOrder.findMany({
      where: {
        updatedAt: { gte: sinceDate },
        lineItems: {
          some: { isOutOfStock: true },
        },
      },
      include: {
        vendor: { select: { name: true } },
        lineItems: {
          where: { isOutOfStock: true },
          select: {
            description: true,
            vendorSku: true,
            outOfStockNote: true,
          },
        },
      },
    });

    const alerts: AlertItem[] = [];

    // Convert status logs to alerts
    for (const log of statusLogs) {
      const po = log.purchaseOrder;
      const alert = statusLogToAlert(log, po);
      if (alert) {
        alerts.push(alert);
      }
    }

    // Add OOS alerts for POs with out-of-stock items
    for (const po of oosOrders) {
      const oosItems = po.lineItems.map((li) => li.description).join(", ");
      const existingOosAlert = alerts.find(
        (a) => a.poId === po.id && a.type === "oos"
      );
      if (!existingOosAlert) {
        alerts.push({
          id: `oos-${po.id}`,
          type: "oos",
          message: `Out-of-stock items on ${po.poNumber}: ${oosItems}`,
          severity: "red",
          poId: po.id,
          poNumber: po.poNumber,
          vendorName: po.vendor?.name || null,
          createdAt: po.updatedAt.toISOString(),
          details: po.lineItems
            .map(
              (li) =>
                `${li.description}${li.vendorSku ? ` (${li.vendorSku})` : ""}`
            )
            .join("; "),
        });
      }
    }

    // Sort all alerts by date descending
    alerts.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return NextResponse.json({ alerts, total: alerts.length });
  } catch (error) {
    console.error("Failed to fetch alerts:", error);
    return NextResponse.json(
      { error: "Failed to fetch alerts" },
      { status: 500 }
    );
  }
}

function statusLogToAlert(
  log: {
    id: string;
    fromStatus: string | null;
    toStatus: string;
    note: string | null;
    triggeredBy: string;
    createdAt: Date;
  },
  po: {
    id: string;
    poNumber: string;
    vendor: { name: string } | null;
  }
): AlertItem | null {
  const base = {
    poId: po.id,
    poNumber: po.poNumber,
    vendorName: po.vendor?.name || null,
    createdAt: log.createdAt.toISOString(),
    details: log.note,
  };

  switch (log.toStatus) {
    case "CONFIRMED":
      return {
        ...base,
        id: log.id,
        type: "confirmed",
        message: `${po.poNumber} confirmed by ${po.vendor?.name || "vendor"}`,
        severity: "green",
      };

    case "PARTIALLY_RECEIVED":
      return {
        ...base,
        id: log.id,
        type: "partial",
        message: `${po.poNumber} partially confirmed - some items may be out of stock`,
        severity: "yellow",
      };

    case "CANCELLED":
      return {
        ...base,
        id: log.id,
        type: "rejected",
        message: `${po.poNumber} rejected/cancelled by ${po.vendor?.name || "vendor"}`,
        severity: "red",
      };

    case "RECEIVED":
      return {
        ...base,
        id: log.id,
        type: "delivery",
        message: `${po.poNumber} fully received`,
        severity: "green",
      };

    case "SENT":
      return {
        ...base,
        id: log.id,
        type: "status_change",
        message: `${po.poNumber} sent to ${po.vendor?.name || "vendor"}`,
        severity: "blue",
      };

    default:
      // Only show email-parser triggered logs for other statuses
      if (log.triggeredBy === "email-parser") {
        return {
          ...base,
          id: log.id,
          type: "status_change",
          message: `${po.poNumber} status update: ${log.fromStatus || "N/A"} -> ${log.toStatus}`,
          severity: "blue",
        };
      }
      return null;
  }
}
