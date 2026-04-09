import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

/**
 * POST /api/inventory/auto-tune
 * Calculates optimal reorder points based on sales velocity from ProductSales cache.
 * Formula: reorderPoint = ceil(avgDailySales * leadTimeDays * safetyFactor)
 * - avgDailySales = totalQtySold / days in period (default 90 days = 3 months)
 * - leadTimeDays from the item's vendor (default 7 if unknown)
 * - safetyFactor default 1.25 (lean inventory to maximize capital)
 *
 * Query params:
 *   safetyFactor (default 1.25)
 *   minReorderPoint (default 2)
 *   periodDays (default 90)
 *   apply (default false) - if true, actually updates reorder points
 */
export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const safetyFactor = Number(body.safetyFactor) || 1.25;
    const minReorderPoint = Number(body.minReorderPoint) || 2;
    const periodDays = Number(body.periodDays) || 90;
    const apply = body.apply === true;

    // Calculate the period start date
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - periodDays);

    // Get all active inventory items with their vendor lead times
    const items = await prisma.inventoryItem.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        sku: true,
        reorderPoint: true,
        vendor: {
          select: { leadTimeDays: true, name: true },
        },
      },
    });

    // Get aggregated sales data for the period
    // Sum totalQtySold across all ProductSales records that overlap our period
    const salesData = await prisma.productSales.findMany({
      where: {
        periodStart: { gte: periodStart },
        totalQtySold: { gt: 0 },
      },
      select: {
        sku: true,
        totalQtySold: true,
        inventoryItemId: true,
      },
    });

    // Aggregate sales by SKU (there may be multiple records per SKU for different periods)
    const salesBySku: Record<string, number> = {};
    const salesByItemId: Record<string, number> = {};
    for (const sale of salesData) {
      salesBySku[sale.sku] = (salesBySku[sale.sku] || 0) + sale.totalQtySold;
      if (sale.inventoryItemId) {
        salesByItemId[sale.inventoryItemId] =
          (salesByItemId[sale.inventoryItemId] || 0) + sale.totalQtySold;
      }
    }

    // Calculate suggested reorder points
    const preview: Array<{
      itemId: string;
      name: string;
      sku: string;
      currentReorderPoint: number;
      suggestedReorderPoint: number;
      avgDailySales: number;
      leadTimeDays: number;
      totalQtySold: number;
      vendorName: string | null;
    }> = [];

    for (const item of items) {
      // Get total qty sold from either SKU or item ID match
      const totalQtySold =
        salesBySku[item.sku] || salesByItemId[item.id] || 0;

      const avgDailySales = totalQtySold / periodDays;
      const leadTimeDays = item.vendor?.leadTimeDays || 7;

      // Formula: ceil(avgDailySales * leadTimeDays * safetyFactor)
      let suggested = Math.ceil(avgDailySales * leadTimeDays * safetyFactor);

      // Enforce minimum reorder point
      if (suggested < minReorderPoint) {
        suggested = minReorderPoint;
      }

      // Only include items where the suggestion differs from current
      if (suggested !== item.reorderPoint) {
        preview.push({
          itemId: item.id,
          name: item.name,
          sku: item.sku,
          currentReorderPoint: item.reorderPoint,
          suggestedReorderPoint: suggested,
          avgDailySales: Math.round(avgDailySales * 100) / 100,
          leadTimeDays,
          totalQtySold,
          vendorName: item.vendor?.name || null,
        });
      }
    }

    // Sort by biggest change first
    preview.sort(
      (a, b) =>
        Math.abs(b.suggestedReorderPoint - b.currentReorderPoint) -
        Math.abs(a.suggestedReorderPoint - a.currentReorderPoint)
    );

    // If apply=true, update the reorder points in the database
    let appliedCount = 0;
    if (apply && preview.length > 0) {
      // Use a transaction to update all at once
      const updates = preview.map((p) =>
        prisma.inventoryItem.update({
          where: { id: p.itemId },
          data: { reorderPoint: p.suggestedReorderPoint },
        })
      );
      await prisma.$transaction(updates);
      appliedCount = preview.length;
    }

    return NextResponse.json({
      periodDays,
      safetyFactor,
      minReorderPoint,
      totalItemsAnalyzed: items.length,
      itemsWithChanges: preview.length,
      applied: apply,
      appliedCount,
      preview: preview.slice(0, 100), // Cap preview to 100 items
    });
  } catch (error) {
    console.error("Auto-tune reorder points failed:", error);
    return NextResponse.json(
      { error: "Failed to auto-tune reorder points" },
      { status: 500 }
    );
  }
}
