import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

/**
 * POST /api/reports/custom
 * Custom report builder endpoint — builds dynamic Prisma queries
 * based on the selected report type, filters, columns, and sort.
 */

interface CustomReportRequest {
  reportType: string;
  dateFrom?: string;
  dateTo?: string;
  filters?: {
    categories?: string[];
    vendors?: string[];
    stockStatus?: string;
    minPrice?: number;
    maxPrice?: number;
    minMargin?: number;
    maxMargin?: number;
    minQty?: number;
    maxQty?: number;
  };
  columns?: string[];
  sortBy?: string;
  sortDir?: "asc" | "desc";
  limit?: number;
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body: CustomReportRequest = await request.json();
    const {
      reportType,
      dateFrom,
      dateTo,
      filters = {},
      columns = [],
      sortBy,
      sortDir = "desc",
      limit = 500,
    } = body;

    if (!reportType) {
      return NextResponse.json(
        { error: "reportType is required" },
        { status: 400 }
      );
    }

    let rows: Record<string, unknown>[] = [];
    let total = 0;

    switch (reportType) {
      case "sales-by-product":
        ({ rows, total } = await salesByProduct(dateFrom, dateTo, filters, sortBy, sortDir, limit));
        break;
      case "sales-by-category":
        ({ rows, total } = await salesByCategory(dateFrom, dateTo, filters, sortBy, sortDir, limit));
        break;
      case "sales-by-vendor":
        ({ rows, total } = await salesByVendor(dateFrom, dateTo, filters, sortBy, sortDir, limit));
        break;
      case "inventory-by-category":
        ({ rows, total } = await inventoryByCategory(filters, sortBy, sortDir, limit));
        break;
      case "inventory-by-vendor":
        ({ rows, total } = await inventoryByVendor(filters, sortBy, sortDir, limit));
        break;
      case "po-spend-by-vendor":
        ({ rows, total } = await poSpendByVendor(dateFrom, dateTo, filters, sortBy, sortDir, limit));
        break;
      case "po-spend-by-month":
        ({ rows, total } = await poSpendByMonth(dateFrom, dateTo, filters, sortBy, sortDir, limit));
        break;
      case "profit-analysis":
        ({ rows, total } = await profitAnalysis(dateFrom, dateTo, filters, sortBy, sortDir, limit));
        break;
      default:
        return NextResponse.json(
          { error: `Unknown report type: ${reportType}` },
          { status: 400 }
        );
    }

    // Filter columns if specified
    const finalRows =
      columns.length > 0
        ? rows.map((row) => {
            const filtered: Record<string, unknown> = {};
            for (const col of columns) {
              if (col in row) filtered[col] = row[col];
            }
            return filtered;
          })
        : rows;

    return NextResponse.json({ rows: finalRows, columns: columns.length > 0 ? columns : Object.keys(rows[0] || {}), total });
  } catch (error) {
    console.error("[Custom Reports API] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate custom report" },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────
// Helper: build date filter for ProductSales
// ─────────────────────────────────────────────
function buildDateFilter(dateFrom?: string, dateTo?: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (dateFrom) where.periodStart = { ...(where.periodStart || {}), gte: new Date(dateFrom) };
  if (dateTo) where.periodEnd = { ...(where.periodEnd || {}), lte: new Date(dateTo) };
  return where;
}

function buildPODateFilter(dateFrom?: string, dateTo?: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (dateFrom) where.createdAt = { ...(where.createdAt || {}), gte: new Date(dateFrom) };
  if (dateTo) where.createdAt = { ...(where.createdAt || {}), lte: new Date(dateTo) };
  return where;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildInventoryFilter(filters: CustomReportRequest["filters"] = {}): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { isActive: true };
  if (filters.categories?.length) where.category = { in: filters.categories };
  if (filters.vendors?.length) where.vendorId = { in: filters.vendors };
  if (filters.stockStatus === "in-stock") where.currentStock = { gt: 0 };
  if (filters.stockStatus === "low-stock") {
    where.AND = [
      { currentStock: { gt: 0 } },
      // low stock = stock <= reorderPoint; we approximate with a raw check below
    ];
  }
  if (filters.stockStatus === "out-of-stock") where.currentStock = { lte: 0 };
  if (filters.minPrice !== undefined) where.retailPrice = { ...(where.retailPrice || {}), gte: filters.minPrice };
  if (filters.maxPrice !== undefined) where.retailPrice = { ...(where.retailPrice || {}), lte: filters.maxPrice };
  return where;
}

function sortRows(
  rows: Record<string, unknown>[],
  sortBy?: string,
  sortDir: "asc" | "desc" = "desc"
) {
  if (!sortBy) return rows;
  return [...rows].sort((a, b) => {
    const va = a[sortBy];
    const vb = b[sortBy];
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    if (typeof va === "number" && typeof vb === "number") {
      return sortDir === "asc" ? va - vb : vb - va;
    }
    const sa = String(va).toLowerCase();
    const sb = String(vb).toLowerCase();
    return sortDir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
  });
}

// ─────────────────────────────────────────────
// Sales by Product
// ─────────────────────────────────────────────
async function salesByProduct(
  dateFrom?: string,
  dateTo?: string,
  filters: CustomReportRequest["filters"] = {},
  sortBy?: string,
  sortDir: "asc" | "desc" = "desc",
  limit = 500
) {
  const dateWhere = buildDateFilter(dateFrom, dateTo);

  const sales = await prisma.productSales.findMany({
    where: {
      ...dateWhere,
      ...(filters.categories?.length || filters.vendors?.length
        ? {
            inventoryItem: {
              ...(filters.categories?.length ? { category: { in: filters.categories } } : {}),
              ...(filters.vendors?.length ? { vendorId: { in: filters.vendors } } : {}),
            },
          }
        : {}),
    },
    include: {
      inventoryItem: {
        select: {
          name: true,
          sku: true,
          category: true,
          vendorId: true,
          costPrice: true,
          retailPrice: true,
          currentStock: true,
          reorderPoint: true,
          vendor: { select: { name: true } },
        },
      },
    },
  });

  // Aggregate by product (sku)
  const productMap: Record<string, Record<string, unknown>> = {};
  for (const sale of sales) {
    const key = sale.sku;
    if (!productMap[key]) {
      const item = sale.inventoryItem;
      const cost = item ? Number(item.costPrice) : 0;
      const retail = item ? Number(item.retailPrice) : 0;
      productMap[key] = {
        productName: item?.name || sale.productName,
        sku: sale.sku,
        category: item?.category || "Uncategorized",
        vendor: item?.vendor?.name || "Unknown",
        currentStock: item?.currentStock || 0,
        costPrice: cost,
        retailPrice: retail,
        marginPercent: retail > 0 ? Math.round(((retail - cost) / retail) * 10000) / 100 : 0,
        qtySold: 0,
        revenue: 0,
        reorderPoint: item?.reorderPoint || 0,
      };
    }
    productMap[key].qtySold = (productMap[key].qtySold as number) + sale.totalQtySold;
    productMap[key].revenue =
      Math.round(((productMap[key].revenue as number) + Number(sale.totalRevenue)) * 100) / 100;
  }

  let rows = Object.values(productMap);
  rows = sortRows(rows, sortBy || "revenue", sortDir);
  const total = rows.length;
  rows = rows.slice(0, limit);

  return { rows, total };
}

// ─────────────────────────────────────────────
// Sales by Category
// ─────────────────────────────────────────────
async function salesByCategory(
  dateFrom?: string,
  dateTo?: string,
  filters: CustomReportRequest["filters"] = {},
  sortBy?: string,
  sortDir: "asc" | "desc" = "desc",
  limit = 500
) {
  const dateWhere = buildDateFilter(dateFrom, dateTo);

  const sales = await prisma.productSales.findMany({
    where: {
      ...dateWhere,
      ...(filters.categories?.length
        ? { inventoryItem: { category: { in: filters.categories } } }
        : {}),
    },
    include: {
      inventoryItem: {
        select: { category: true },
      },
    },
  });

  const catMap: Record<string, { category: string; qtySold: number; revenue: number; productCount: number }> = {};
  const skuSet: Record<string, Set<string>> = {};

  for (const sale of sales) {
    const cat = sale.inventoryItem?.category || "Uncategorized";
    if (!catMap[cat]) {
      catMap[cat] = { category: cat, qtySold: 0, revenue: 0, productCount: 0 };
      skuSet[cat] = new Set();
    }
    catMap[cat].qtySold += sale.totalQtySold;
    catMap[cat].revenue = Math.round((catMap[cat].revenue + Number(sale.totalRevenue)) * 100) / 100;
    skuSet[cat].add(sale.sku);
  }

  for (const cat of Object.keys(catMap)) {
    catMap[cat].productCount = skuSet[cat].size;
  }

  let rows: Record<string, unknown>[] = Object.values(catMap);
  rows = sortRows(rows, sortBy || "revenue", sortDir);
  const total = rows.length;
  rows = rows.slice(0, limit);

  return { rows, total };
}

// ─────────────────────────────────────────────
// Sales by Vendor
// ─────────────────────────────────────────────
async function salesByVendor(
  dateFrom?: string,
  dateTo?: string,
  filters: CustomReportRequest["filters"] = {},
  sortBy?: string,
  sortDir: "asc" | "desc" = "desc",
  limit = 500
) {
  const dateWhere = buildDateFilter(dateFrom, dateTo);

  const sales = await prisma.productSales.findMany({
    where: {
      ...dateWhere,
      ...(filters.vendors?.length
        ? { inventoryItem: { vendorId: { in: filters.vendors } } }
        : {}),
    },
    include: {
      inventoryItem: {
        select: {
          vendorId: true,
          vendor: { select: { name: true } },
        },
      },
    },
  });

  const vendorMap: Record<string, { vendor: string; qtySold: number; revenue: number; productCount: number }> = {};
  const skuSet: Record<string, Set<string>> = {};

  for (const sale of sales) {
    const vendorName = sale.inventoryItem?.vendor?.name || "Unknown";
    const vendorKey = sale.inventoryItem?.vendorId || "unknown";
    if (!vendorMap[vendorKey]) {
      vendorMap[vendorKey] = { vendor: vendorName, qtySold: 0, revenue: 0, productCount: 0 };
      skuSet[vendorKey] = new Set();
    }
    vendorMap[vendorKey].qtySold += sale.totalQtySold;
    vendorMap[vendorKey].revenue = Math.round((vendorMap[vendorKey].revenue + Number(sale.totalRevenue)) * 100) / 100;
    skuSet[vendorKey].add(sale.sku);
  }

  for (const key of Object.keys(vendorMap)) {
    vendorMap[key].productCount = skuSet[key].size;
  }

  let rows: Record<string, unknown>[] = Object.values(vendorMap);
  rows = sortRows(rows, sortBy || "revenue", sortDir);
  const total = rows.length;
  rows = rows.slice(0, limit);

  return { rows, total };
}

// ─────────────────────────────────────────────
// Inventory by Category
// ─────────────────────────────────────────────
async function inventoryByCategory(
  filters: CustomReportRequest["filters"] = {},
  sortBy?: string,
  sortDir: "asc" | "desc" = "desc",
  limit = 500
) {
  const invWhere = buildInventoryFilter(filters);

  const items = await prisma.inventoryItem.findMany({
    where: invWhere,
    select: {
      category: true,
      currentStock: true,
      costPrice: true,
      retailPrice: true,
      reorderPoint: true,
    },
  });

  const catMap: Record<
    string,
    {
      category: string;
      productCount: number;
      totalStock: number;
      costValue: number;
      retailValue: number;
      lowStockCount: number;
      outOfStockCount: number;
    }
  > = {};

  for (const item of items) {
    const cat = item.category || "Uncategorized";
    if (!catMap[cat]) {
      catMap[cat] = {
        category: cat,
        productCount: 0,
        totalStock: 0,
        costValue: 0,
        retailValue: 0,
        lowStockCount: 0,
        outOfStockCount: 0,
      };
    }
    catMap[cat].productCount += 1;
    catMap[cat].totalStock += item.currentStock;
    catMap[cat].costValue += item.currentStock * Number(item.costPrice);
    catMap[cat].retailValue += item.currentStock * Number(item.retailPrice);
    if (item.currentStock <= 0) catMap[cat].outOfStockCount += 1;
    else if (item.currentStock <= item.reorderPoint) catMap[cat].lowStockCount += 1;
  }

  // Round values
  for (const cat of Object.values(catMap)) {
    cat.costValue = Math.round(cat.costValue * 100) / 100;
    cat.retailValue = Math.round(cat.retailValue * 100) / 100;
  }

  let rows: Record<string, unknown>[] = Object.values(catMap);
  rows = sortRows(rows, sortBy || "costValue", sortDir);
  const total = rows.length;
  rows = rows.slice(0, limit);

  return { rows, total };
}

// ─────────────────────────────────────────────
// Inventory by Vendor
// ─────────────────────────────────────────────
async function inventoryByVendor(
  filters: CustomReportRequest["filters"] = {},
  sortBy?: string,
  sortDir: "asc" | "desc" = "desc",
  limit = 500
) {
  const invWhere = buildInventoryFilter(filters);

  const items = await prisma.inventoryItem.findMany({
    where: invWhere,
    include: {
      vendor: { select: { name: true } },
    },
  });

  const vendorMap: Record<
    string,
    {
      vendor: string;
      productCount: number;
      totalStock: number;
      costValue: number;
      retailValue: number;
      lowStockCount: number;
      outOfStockCount: number;
    }
  > = {};

  for (const item of items) {
    const vendorKey = item.vendorId || "none";
    const vendorName = item.vendor?.name || "No Vendor";
    if (!vendorMap[vendorKey]) {
      vendorMap[vendorKey] = {
        vendor: vendorName,
        productCount: 0,
        totalStock: 0,
        costValue: 0,
        retailValue: 0,
        lowStockCount: 0,
        outOfStockCount: 0,
      };
    }
    vendorMap[vendorKey].productCount += 1;
    vendorMap[vendorKey].totalStock += item.currentStock;
    vendorMap[vendorKey].costValue += item.currentStock * Number(item.costPrice);
    vendorMap[vendorKey].retailValue += item.currentStock * Number(item.retailPrice);
    if (item.currentStock <= 0) vendorMap[vendorKey].outOfStockCount += 1;
    else if (item.currentStock <= item.reorderPoint) vendorMap[vendorKey].lowStockCount += 1;
  }

  for (const v of Object.values(vendorMap)) {
    v.costValue = Math.round(v.costValue * 100) / 100;
    v.retailValue = Math.round(v.retailValue * 100) / 100;
  }

  let rows: Record<string, unknown>[] = Object.values(vendorMap);
  rows = sortRows(rows, sortBy || "costValue", sortDir);
  const total = rows.length;
  rows = rows.slice(0, limit);

  return { rows, total };
}

// ─────────────────────────────────────────────
// PO Spend by Vendor
// ─────────────────────────────────────────────
async function poSpendByVendor(
  dateFrom?: string,
  dateTo?: string,
  filters: CustomReportRequest["filters"] = {},
  sortBy?: string,
  sortDir: "asc" | "desc" = "desc",
  limit = 500
) {
  const dateWhere = buildPODateFilter(dateFrom, dateTo);

  const pos = await prisma.purchaseOrder.findMany({
    where: {
      ...dateWhere,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      ...(filters.vendors?.length ? { vendorId: { in: filters.vendors } } : {}),
    },
    include: {
      vendor: { select: { name: true } },
      lineItems: { select: { id: true } },
    },
  });

  const vendorMap: Record<
    string,
    {
      vendor: string;
      poCount: number;
      totalSpend: number;
      totalItems: number;
      avgPoValue: number;
    }
  > = {};

  for (const po of pos) {
    const key = po.vendorId;
    if (!vendorMap[key]) {
      vendorMap[key] = {
        vendor: po.vendor.name,
        poCount: 0,
        totalSpend: 0,
        totalItems: 0,
        avgPoValue: 0,
      };
    }
    vendorMap[key].poCount += 1;
    vendorMap[key].totalSpend += Number(po.total);
    vendorMap[key].totalItems += po.lineItems.length;
  }

  for (const v of Object.values(vendorMap)) {
    v.totalSpend = Math.round(v.totalSpend * 100) / 100;
    v.avgPoValue = v.poCount > 0 ? Math.round((v.totalSpend / v.poCount) * 100) / 100 : 0;
  }

  let rows: Record<string, unknown>[] = Object.values(vendorMap);
  rows = sortRows(rows, sortBy || "totalSpend", sortDir);
  const total = rows.length;
  rows = rows.slice(0, limit);

  return { rows, total };
}

// ─────────────────────────────────────────────
// PO Spend by Month
// ─────────────────────────────────────────────
async function poSpendByMonth(
  dateFrom?: string,
  dateTo?: string,
  filters: CustomReportRequest["filters"] = {},
  sortBy?: string,
  sortDir: "asc" | "desc" = "desc",
  limit = 500
) {
  const dateWhere = buildPODateFilter(dateFrom, dateTo);

  const pos = await prisma.purchaseOrder.findMany({
    where: {
      ...dateWhere,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      ...(filters.vendors?.length ? { vendorId: { in: filters.vendors } } : {}),
    },
    select: {
      total: true,
      createdAt: true,
    },
  });

  const monthMap: Record<string, { month: string; poCount: number; totalSpend: number }> = {};
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  for (const po of pos) {
    const d = po.createdAt;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = `${months[d.getMonth()]} ${d.getFullYear()}`;
    if (!monthMap[key]) {
      monthMap[key] = { month: label, poCount: 0, totalSpend: 0 };
    }
    monthMap[key].poCount += 1;
    monthMap[key].totalSpend += Number(po.total);
  }

  for (const m of Object.values(monthMap)) {
    m.totalSpend = Math.round(m.totalSpend * 100) / 100;
  }

  let rows: Record<string, unknown>[] = Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);

  if (sortBy) rows = sortRows(rows, sortBy, sortDir);
  const total = rows.length;
  rows = rows.slice(0, limit);

  return { rows, total };
}

// ─────────────────────────────────────────────
// Profit Analysis
// ─────────────────────────────────────────────
async function profitAnalysis(
  dateFrom?: string,
  dateTo?: string,
  filters: CustomReportRequest["filters"] = {},
  sortBy?: string,
  sortDir: "asc" | "desc" = "desc",
  limit = 500
) {
  const dateWhere = buildDateFilter(dateFrom, dateTo);

  const sales = await prisma.productSales.findMany({
    where: {
      ...dateWhere,
      ...(filters.categories?.length || filters.vendors?.length
        ? {
            inventoryItem: {
              ...(filters.categories?.length ? { category: { in: filters.categories } } : {}),
              ...(filters.vendors?.length ? { vendorId: { in: filters.vendors } } : {}),
            },
          }
        : {}),
    },
    include: {
      inventoryItem: {
        select: {
          name: true,
          sku: true,
          category: true,
          costPrice: true,
          retailPrice: true,
          currentStock: true,
          reorderPoint: true,
          vendor: { select: { name: true } },
        },
      },
    },
  });

  // Aggregate by product
  const productMap: Record<string, Record<string, unknown>> = {};
  for (const sale of sales) {
    const key = sale.sku;
    if (!productMap[key]) {
      const item = sale.inventoryItem;
      const cost = item ? Number(item.costPrice) : 0;
      const retail = item ? Number(item.retailPrice) : 0;
      const marginPct = retail > 0 ? ((retail - cost) / retail) * 100 : 0;
      productMap[key] = {
        productName: item?.name || sale.productName,
        sku: sale.sku,
        category: item?.category || "Uncategorized",
        vendor: item?.vendor?.name || "Unknown",
        costPrice: cost,
        retailPrice: retail,
        marginPercent: Math.round(marginPct * 100) / 100,
        qtySold: 0,
        revenue: 0,
        totalCost: 0,
        profit: 0,
        currentStock: item?.currentStock || 0,
        reorderPoint: item?.reorderPoint || 0,
      };
    }
    productMap[key].qtySold = (productMap[key].qtySold as number) + sale.totalQtySold;
    productMap[key].revenue =
      Math.round(((productMap[key].revenue as number) + Number(sale.totalRevenue)) * 100) / 100;
  }

  // Calculate profit = revenue - (cost * qtySold)
  for (const row of Object.values(productMap)) {
    const cost = row.costPrice as number;
    const qty = row.qtySold as number;
    const revenue = row.revenue as number;
    row.totalCost = Math.round(cost * qty * 100) / 100;
    row.profit = Math.round((revenue - cost * qty) * 100) / 100;
  }

  // Apply margin filters
  let rows: Record<string, unknown>[] = Object.values(productMap);

  if (filters.minMargin !== undefined) {
    rows = rows.filter((r) => (r.marginPercent as number) >= filters.minMargin!);
  }
  if (filters.maxMargin !== undefined) {
    rows = rows.filter((r) => (r.marginPercent as number) <= filters.maxMargin!);
  }

  rows = sortRows(rows, sortBy || "profit", sortDir);
  const total = rows.length;
  rows = rows.slice(0, limit);

  return { rows, total };
}
