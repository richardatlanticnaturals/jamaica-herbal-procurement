import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET /api/reports?type=<report-type>
 * Unified reports endpoint for procurement analytics.
 * All report types require authentication.
 *
 * Report types:
 *   profit-margins  — Items with cost, retail, margin %, sorted by margin
 *   dead-stock      — Items with stock > 0 but no sales in 6+ months
 *   top-sellers     — Top items by qty sold from ProductSales
 *   category-summary— Revenue, qty sold, item count per category
 *   vendor-summary  — PO count, total spend, avg lead time per vendor
 *   spending-trends — Monthly PO spend for last 12 months
 *   inventory-value — Total inventory value (stock x cost) by category
 */
export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    switch (type) {
      case "profit-margins":
        return handleProfitMargins(searchParams);
      case "dead-stock":
        return handleDeadStock();
      case "top-sellers":
        return handleTopSellers(searchParams);
      case "category-summary":
        return handleCategorySummary();
      case "vendor-summary":
        return handleVendorSummary();
      case "spending-trends":
        return handleSpendingTrends();
      case "inventory-value":
        return handleInventoryValue();
      default:
        return NextResponse.json(
          { error: "Invalid report type. Use: profit-margins, dead-stock, top-sellers, category-summary, vendor-summary, spending-trends, inventory-value" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("[Reports API] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate report" },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────
// profit-margins: cost vs retail with margin %
// ─────────────────────────────────────────────
async function handleProfitMargins(params: URLSearchParams) {
  const category = params.get("category") || undefined;
  const vendorId = params.get("vendorId") || undefined;
  const limit = parseInt(params.get("limit") || "100", 10);

  const items = await prisma.inventoryItem.findMany({
    where: {
      isActive: true,
      ...(category ? { category } : {}),
      ...(vendorId ? { vendorId } : {}),
    },
    include: {
      vendor: { select: { name: true } },
    },
    take: limit,
  });

  const data = items
    .map((item) => {
      const cost = Number(item.costPrice);
      const retail = Number(item.retailPrice);
      const margin = retail > 0 ? ((retail - cost) / retail) * 100 : 0;
      return {
        id: item.id,
        sku: item.sku,
        name: item.name,
        category: item.category || "Uncategorized",
        vendorName: item.vendor?.name || "No Vendor",
        costPrice: cost,
        retailPrice: retail,
        marginPercent: Math.round(margin * 100) / 100,
        currentStock: item.currentStock,
      };
    })
    .sort((a, b) => a.marginPercent - b.marginPercent);

  return NextResponse.json({ data });
}

// ─────────────────────────────────────────────
// dead-stock: items with stock > 0 but no sales in 6+ months
// ─────────────────────────────────────────────
async function handleDeadStock() {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  // Get items with stock
  const itemsWithStock = await prisma.inventoryItem.findMany({
    where: {
      isActive: true,
      currentStock: { gt: 0 },
    },
    include: {
      vendor: { select: { name: true } },
      productSales: {
        orderBy: { lastSoldAt: "desc" },
        take: 1,
      },
    },
  });

  // Filter to those with no recent sales
  const deadStock = itemsWithStock
    .filter((item) => {
      if (item.productSales.length === 0) return true;
      const lastSold = item.productSales[0].lastSoldAt;
      return !lastSold || lastSold < sixMonthsAgo;
    })
    .map((item) => {
      const cost = Number(item.costPrice);
      return {
        id: item.id,
        sku: item.sku,
        name: item.name,
        category: item.category || "Uncategorized",
        vendorName: item.vendor?.name || "No Vendor",
        currentStock: item.currentStock,
        costPrice: cost,
        stockValue: Math.round(item.currentStock * cost * 100) / 100,
        lastSoldAt: item.productSales[0]?.lastSoldAt || null,
      };
    })
    .sort((a, b) => b.stockValue - a.stockValue);

  const totalValueTiedUp = deadStock.reduce((sum, i) => sum + i.stockValue, 0);

  return NextResponse.json({ data: deadStock, totalValueTiedUp });
}

// ─────────────────────────────────────────────
// top-sellers: top items by qty sold
// ─────────────────────────────────────────────
async function handleTopSellers(params: URLSearchParams) {
  const days = parseInt(params.get("days") || "30", 10);
  const limit = parseInt(params.get("limit") || "20", 10);
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - days);

  const sales = await prisma.productSales.findMany({
    where: {
      periodStart: { gte: sinceDate },
    },
    include: {
      inventoryItem: {
        select: { category: true, retailPrice: true, costPrice: true },
      },
    },
    orderBy: { totalQtySold: "desc" },
    take: limit,
  });

  const data = sales.map((s) => ({
    id: s.id,
    sku: s.sku,
    name: s.productName,
    category: s.inventoryItem?.category || "Uncategorized",
    totalQtySold: s.totalQtySold,
    totalRevenue: Number(s.totalRevenue),
    salesCount: s.salesCount,
    lastSoldAt: s.lastSoldAt,
  }));

  return NextResponse.json({ data, days });
}

// ─────────────────────────────────────────────
// category-summary: revenue, qty, item count per category
// ─────────────────────────────────────────────
async function handleCategorySummary() {
  // Get item counts per category
  const items = await prisma.inventoryItem.groupBy({
    by: ["category"],
    where: { isActive: true },
    _count: { id: true },
  });

  // Get sales data grouped by category via inventory items
  const allSales = await prisma.productSales.findMany({
    include: {
      inventoryItem: { select: { category: true } },
    },
  });

  const categoryMap: Record<string, { revenue: number; qtySold: number }> = {};
  for (const sale of allSales) {
    const cat = sale.inventoryItem?.category || "Uncategorized";
    if (!categoryMap[cat]) categoryMap[cat] = { revenue: 0, qtySold: 0 };
    categoryMap[cat].revenue += Number(sale.totalRevenue);
    categoryMap[cat].qtySold += sale.totalQtySold;
  }

  const data = items.map((group) => {
    const cat = group.category || "Uncategorized";
    return {
      category: cat,
      itemCount: group._count.id,
      totalRevenue: Math.round((categoryMap[cat]?.revenue || 0) * 100) / 100,
      totalQtySold: categoryMap[cat]?.qtySold || 0,
    };
  }).sort((a, b) => b.totalRevenue - a.totalRevenue);

  return NextResponse.json({ data });
}

// ─────────────────────────────────────────────
// vendor-summary: PO count, total spend, avg lead time
// ─────────────────────────────────────────────
async function handleVendorSummary() {
  const vendors = await prisma.vendor.findMany({
    where: { isActive: true },
    include: {
      purchaseOrders: {
        select: {
          id: true,
          total: true,
          status: true,
          createdAt: true,
          receivedAt: true,
          lineItems: { select: { id: true } },
        },
      },
    },
  });

  const data = vendors.map((v) => {
    const poCount = v.purchaseOrders.length;
    const totalSpend = v.purchaseOrders.reduce(
      (sum, po) => sum + Number(po.total),
      0
    );
    const totalItems = v.purchaseOrders.reduce(
      (sum, po) => sum + po.lineItems.length,
      0
    );

    // Calculate avg lead time from POs that have been received
    const receivedPOs = v.purchaseOrders.filter((po) => po.receivedAt);
    let avgLeadTimeDays = v.leadTimeDays;
    if (receivedPOs.length > 0) {
      const totalDays = receivedPOs.reduce((sum, po) => {
        const diff = po.receivedAt!.getTime() - po.createdAt.getTime();
        return sum + diff / (1000 * 60 * 60 * 24);
      }, 0);
      avgLeadTimeDays = Math.round(totalDays / receivedPOs.length);
    }

    return {
      id: v.id,
      name: v.name,
      poCount,
      totalSpend: Math.round(totalSpend * 100) / 100,
      avgItemsPerPO: poCount > 0 ? Math.round(totalItems / poCount) : 0,
      avgLeadTimeDays,
    };
  }).sort((a, b) => b.totalSpend - a.totalSpend);

  return NextResponse.json({ data });
}

// ─────────────────────────────────────────────
// spending-trends: monthly PO spend for last 12 months
// ─────────────────────────────────────────────
async function handleSpendingTrends() {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  twelveMonthsAgo.setDate(1);
  twelveMonthsAgo.setHours(0, 0, 0, 0);

  const pos = await prisma.purchaseOrder.findMany({
    where: {
      createdAt: { gte: twelveMonthsAgo },
      status: { notIn: ["DRAFT", "CANCELLED"] },
    },
    select: {
      total: true,
      createdAt: true,
    },
  });

  // Aggregate by month
  const monthlyMap: Record<string, { spend: number; count: number }> = {};

  // Initialize all 12 months
  for (let i = 0; i < 12; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - (11 - i));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthlyMap[key] = { spend: 0, count: 0 };
  }

  for (const po of pos) {
    const key = `${po.createdAt.getFullYear()}-${String(po.createdAt.getMonth() + 1).padStart(2, "0")}`;
    if (monthlyMap[key]) {
      monthlyMap[key].spend += Number(po.total);
      monthlyMap[key].count += 1;
    }
  }

  const data = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, vals]) => ({
      month,
      label: formatMonthLabel(month),
      spend: Math.round(vals.spend * 100) / 100,
      poCount: vals.count,
    }));

  return NextResponse.json({ data });
}

function formatMonthLabel(ym: string): string {
  const [year, month] = ym.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(month, 10) - 1]} ${year}`;
}

// ─────────────────────────────────────────────
// inventory-value: total inventory value by category
// ─────────────────────────────────────────────
async function handleInventoryValue() {
  const items = await prisma.inventoryItem.findMany({
    where: { isActive: true, currentStock: { gt: 0 } },
    select: {
      category: true,
      currentStock: true,
      costPrice: true,
      retailPrice: true,
    },
  });

  const categoryMap: Record<string, { costValue: number; retailValue: number; itemCount: number; totalUnits: number }> = {};

  for (const item of items) {
    const cat = item.category || "Uncategorized";
    if (!categoryMap[cat]) {
      categoryMap[cat] = { costValue: 0, retailValue: 0, itemCount: 0, totalUnits: 0 };
    }
    categoryMap[cat].costValue += item.currentStock * Number(item.costPrice);
    categoryMap[cat].retailValue += item.currentStock * Number(item.retailPrice);
    categoryMap[cat].itemCount += 1;
    categoryMap[cat].totalUnits += item.currentStock;
  }

  const data = Object.entries(categoryMap)
    .map(([category, vals]) => ({
      category,
      costValue: Math.round(vals.costValue * 100) / 100,
      retailValue: Math.round(vals.retailValue * 100) / 100,
      itemCount: vals.itemCount,
      totalUnits: vals.totalUnits,
    }))
    .sort((a, b) => b.costValue - a.costValue);

  const totalCostValue = data.reduce((sum, d) => sum + d.costValue, 0);
  const totalRetailValue = data.reduce((sum, d) => sum + d.retailValue, 0);

  return NextResponse.json({ data, totalCostValue: Math.round(totalCostValue * 100) / 100, totalRetailValue: Math.round(totalRetailValue * 100) / 100 });
}
