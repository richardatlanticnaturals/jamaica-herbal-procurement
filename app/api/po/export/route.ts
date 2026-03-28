import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

// CSV export endpoint for purchase orders
// Accepts the same filters as the list endpoint: status, search, dateFrom, dateTo
export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "";
    const search = searchParams.get("search") || "";
    const dateFrom = searchParams.get("dateFrom") || "";
    const dateTo = searchParams.get("dateTo") || "";

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { poNumber: { contains: search, mode: "insensitive" } },
        { vendor: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        where.createdAt.lte = endDate;
      }
    }

    const orders = await prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        vendor: { select: { name: true } },
        _count: { select: { lineItems: true } },
      },
    });

    // Build CSV content
    const headers = [
      "PO Number",
      "Vendor",
      "Status",
      "Items Count",
      "Subtotal",
      "Total",
      "Created Date",
      "Sent Date",
      "Expected Date",
    ];

    const rows = orders.map((po) => [
      escapeCsv(po.poNumber),
      escapeCsv(po.vendor?.name || ""),
      escapeCsv(po.status.replace(/_/g, " ")),
      String(po._count?.lineItems || 0),
      Number(po.subtotal).toFixed(2),
      Number(po.total).toFixed(2),
      po.createdAt ? formatDate(po.createdAt) : "",
      po.sentAt ? formatDate(po.sentAt) : "",
      po.expectedDate ? formatDate(po.expectedDate) : "",
    ]);

    const csv = [
      headers.join(","),
      ...rows.map((row) => row.join(",")),
    ].join("\n");

    const today = new Date().toISOString().split("T")[0];

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="purchase-orders-${today}.csv"`,
      },
    });
  } catch (error) {
    console.error("Failed to export POs:", error);
    return NextResponse.json(
      { error: "Failed to export purchase orders" },
      { status: 500 }
    );
  }
}

// Escape a value for CSV (wrap in quotes if it contains commas, quotes, or newlines)
function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
