import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET /api/export?type=inventory|vendors|categories|purchase-orders|sales
 * Universal CSV export endpoint.
 * Returns properly formatted CSV with headers and escaped values.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "";
    const today = new Date().toISOString().split("T")[0];

    switch (type) {
      case "inventory":
        return await exportInventory(today);
      case "vendors":
        return await exportVendors(today);
      case "categories":
        return await exportCategories(today);
      case "purchase-orders":
        return await exportPurchaseOrders(today);
      case "sales":
        return await exportSales(today);
      default:
        return NextResponse.json(
          {
            error: `Invalid export type: "${type}". Must be one of: inventory, vendors, categories, purchase-orders, sales`,
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Export failed:", error);
    return NextResponse.json(
      { error: "Export failed" },
      { status: 500 }
    );
  }
}

// --- Inventory Export ---
async function exportInventory(today: string): Promise<NextResponse> {
  const items = await prisma.inventoryItem.findMany({
    orderBy: { name: "asc" },
    include: {
      vendor: { select: { name: true } },
    },
  });

  const headers = [
    "SKU",
    "Name",
    "Category",
    "Vendor",
    "Vendor SKU",
    "Cost Price",
    "Retail Price",
    "Current Stock",
    "Reorder Point",
    "Reorder Qty",
    "Location LL",
    "Location NL",
    "Unit",
    "Active",
    "Last Synced",
    "Created",
  ];

  const rows = items.map((item) => [
    esc(item.sku),
    esc(item.name),
    esc(item.category || ""),
    esc(item.vendor?.name || ""),
    esc(item.vendorSku || ""),
    Number(item.costPrice).toFixed(2),
    Number(item.retailPrice).toFixed(2),
    String(item.currentStock),
    String(item.reorderPoint),
    String(item.reorderQty),
    String(item.locationLL),
    String(item.locationNL),
    esc(item.unitOfMeasure),
    item.isActive ? "Yes" : "No",
    item.lastSyncedAt ? fmtDate(item.lastSyncedAt) : "",
    fmtDate(item.createdAt),
  ]);

  return csvResponse(headers, rows, `inventory-${today}.csv`);
}

// --- Vendors Export ---
async function exportVendors(today: string): Promise<NextResponse> {
  const vendors = await prisma.vendor.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: { items: true, purchaseOrders: true },
      },
    },
  });

  const headers = [
    "Name",
    "Contact Name",
    "Email",
    "Phone",
    "Website",
    "Order Method",
    "Lead Time (days)",
    "Minimum Order",
    "Payment Terms",
    "Active",
    "Item Count",
    "PO Count",
    "Notes",
    "Created",
  ];

  const rows = vendors.map((v) => [
    esc(v.name),
    esc(v.contactName || ""),
    esc(v.email || ""),
    esc(v.phone || ""),
    esc(v.website || ""),
    esc(v.orderMethod),
    String(v.leadTimeDays),
    v.minimumOrder ? Number(v.minimumOrder).toFixed(2) : "",
    esc(v.paymentTerms || ""),
    v.isActive ? "Yes" : "No",
    String(v._count.items),
    String(v._count.purchaseOrders),
    esc(v.notes || ""),
    fmtDate(v.createdAt),
  ]);

  return csvResponse(headers, rows, `vendors-${today}.csv`);
}

// --- Categories Export ---
async function exportCategories(today: string): Promise<NextResponse> {
  // Get category summary with counts and stock totals
  const items = await prisma.inventoryItem.findMany({
    where: { isActive: true },
    select: {
      category: true,
      currentStock: true,
      costPrice: true,
      retailPrice: true,
    },
  });

  // Aggregate by category
  const catMap: Record<
    string,
    { count: number; totalStock: number; totalCost: number; totalRetail: number }
  > = {};

  for (const item of items) {
    const cat = item.category || "Uncategorized";
    if (!catMap[cat]) {
      catMap[cat] = { count: 0, totalStock: 0, totalCost: 0, totalRetail: 0 };
    }
    catMap[cat].count++;
    catMap[cat].totalStock += item.currentStock;
    catMap[cat].totalCost += Number(item.costPrice) * item.currentStock;
    catMap[cat].totalRetail += Number(item.retailPrice) * item.currentStock;
  }

  const headers = [
    "Category",
    "Item Count",
    "Total Stock Units",
    "Inventory Cost Value",
    "Inventory Retail Value",
  ];

  const sortedCats = Object.entries(catMap).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  const rows = sortedCats.map(([cat, data]) => [
    esc(cat),
    String(data.count),
    String(data.totalStock),
    data.totalCost.toFixed(2),
    data.totalRetail.toFixed(2),
  ]);

  return csvResponse(headers, rows, `categories-${today}.csv`);
}

// --- Purchase Orders Export ---
async function exportPurchaseOrders(today: string): Promise<NextResponse> {
  const orders = await prisma.purchaseOrder.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      vendor: { select: { name: true } },
      lineItems: {
        include: {
          inventoryItem: { select: { name: true, sku: true } },
        },
      },
    },
  });

  const headers = [
    "PO Number",
    "Vendor",
    "Status",
    "Item SKU",
    "Item Name",
    "Qty Ordered",
    "Qty Received",
    "Unit Cost",
    "Line Total",
    "PO Subtotal",
    "PO Total",
    "Created Date",
    "Sent Date",
    "Expected Date",
    "Received Date",
  ];

  const rows: string[][] = [];
  for (const po of orders) {
    if (po.lineItems.length === 0) {
      // PO with no line items — single row
      rows.push([
        esc(po.poNumber),
        esc(po.vendor?.name || ""),
        esc(po.status.replace(/_/g, " ")),
        "",
        "",
        "",
        "",
        "",
        "",
        Number(po.subtotal).toFixed(2),
        Number(po.total).toFixed(2),
        fmtDate(po.createdAt),
        po.sentAt ? fmtDate(po.sentAt) : "",
        po.expectedDate ? fmtDate(po.expectedDate) : "",
        po.receivedAt ? fmtDate(po.receivedAt) : "",
      ]);
    } else {
      // One row per line item
      for (const li of po.lineItems) {
        rows.push([
          esc(po.poNumber),
          esc(po.vendor?.name || ""),
          esc(po.status.replace(/_/g, " ")),
          esc(li.inventoryItem?.sku || ""),
          esc(li.inventoryItem?.name || li.description),
          String(li.qtyOrdered),
          String(li.qtyReceived),
          Number(li.unitCost).toFixed(2),
          Number(li.lineTotal).toFixed(2),
          Number(po.subtotal).toFixed(2),
          Number(po.total).toFixed(2),
          fmtDate(po.createdAt),
          po.sentAt ? fmtDate(po.sentAt) : "",
          po.expectedDate ? fmtDate(po.expectedDate) : "",
          po.receivedAt ? fmtDate(po.receivedAt) : "",
        ]);
      }
    }
  }

  return csvResponse(headers, rows, `purchase-orders-${today}.csv`);
}

// --- Sales Export ---
async function exportSales(today: string): Promise<NextResponse> {
  const sales = await prisma.productSales.findMany({
    orderBy: { totalQtySold: "desc" },
    include: {
      inventoryItem: {
        select: { name: true, category: true },
      },
    },
  });

  const headers = [
    "SKU",
    "Product Name",
    "Category",
    "Total Qty Sold",
    "Total Revenue",
    "Sales Count",
    "Last Sold",
    "Period Start",
    "Period End",
  ];

  const rows = sales.map((s) => [
    esc(s.sku),
    esc(s.productName),
    esc(s.inventoryItem?.category || ""),
    String(s.totalQtySold),
    Number(s.totalRevenue).toFixed(2),
    String(s.salesCount),
    s.lastSoldAt ? fmtDate(s.lastSoldAt) : "",
    fmtDate(s.periodStart),
    fmtDate(s.periodEnd),
  ]);

  return csvResponse(headers, rows, `sales-${today}.csv`);
}

// --- Helpers ---

/** Escape a value for CSV (wrap in quotes if it contains commas, quotes, or newlines) */
function esc(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Format date as MM/DD/YYYY */
function fmtDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** Build CSV response with proper headers */
function csvResponse(
  headers: string[],
  rows: string[][],
  filename: string
): NextResponse {
  const csv = [headers.join(","), ...rows.map((row) => row.join(","))].join(
    "\n"
  );

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
