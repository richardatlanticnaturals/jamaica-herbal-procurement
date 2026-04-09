import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

/**
 * POST /api/inventory/sales-check
 * Accepts { skus: string[] } and returns { soldSkus: string[] }
 * Only returns SKUs that have sales records in the last 4 months.
 * Used by the New PO page's auto-fill to exclude slow movers.
 */
export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const skus: string[] = body.skus;

    if (!Array.isArray(skus) || skus.length === 0) {
      return NextResponse.json({ soldSkus: [] });
    }

    // Calculate 4 months ago from today
    const fourMonthsAgo = new Date();
    fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4);

    // Query ProductSales for SKUs that have sales in the last 4 months
    const salesRecords = await prisma.productSales.findMany({
      where: {
        sku: { in: skus },
        lastSoldAt: { gte: fourMonthsAgo },
        totalQtySold: { gt: 0 },
      },
      select: {
        sku: true,
      },
      distinct: ["sku"],
    });

    const soldSkus = salesRecords.map((r) => r.sku);

    return NextResponse.json({ soldSkus });
  } catch (error) {
    console.error("Sales check failed:", error);
    return NextResponse.json(
      { error: "Failed to check sales data" },
      { status: 500 }
    );
  }
}
