import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const search = searchParams.get("search") || "";
    const filter = searchParams.get("filter") || "all"; // all, low-stock, out-of-stock

    const vendorId = searchParams.get("vendorId") || "";
    const category = searchParams.get("category") || "";

    // Fix: Use AND array to combine category OR and search OR without overwriting
    const where: any = { isActive: true };
    const andConditions: any[] = [];

    // Filter by vendor if provided
    if (vendorId) {
      where.vendorId = vendorId;
    }

    // Filter by category — pushed into AND to avoid OR conflict with search
    if (category === "__uncategorized") {
      andConditions.push({ OR: [{ category: null }, { category: "" }] });
    } else if (category) {
      where.category = { equals: category, mode: "insensitive" };
    }

    // Search — pushed into AND to avoid OR conflict with category filter
    if (search) {
      andConditions.push({
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { sku: { contains: search, mode: "insensitive" } },
          { category: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    // For low-stock, we need field-to-field comparison (currentStock <= reorderPoint)
    // which Prisma doesn't support. We fetch stock > 0 and post-filter.
    const isLowStockFilter = filter === "low-stock";

    if (isLowStockFilter) {
      where.currentStock = { gt: 0 };
    } else if (filter === "out-of-stock") {
      where.currentStock = { lte: 0 };
    }

    // Combine AND conditions if any exist
    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    if (isLowStockFilter) {
      // Fetch all matching items with stock > 0, then post-filter by reorderPoint
      const allItems = await prisma.inventoryItem.findMany({
        where,
        orderBy: { name: "asc" },
        include: {
          vendor: { select: { id: true, name: true } },
        },
      });

      // Application-level filter: stock > 0 AND stock <= reorderPoint
      const lowStockItems = allItems.filter(
        (item) => item.currentStock > 0 && item.currentStock <= item.reorderPoint
      );

      const total = lowStockItems.length;
      const paginatedItems = lowStockItems.slice((page - 1) * limit, page * limit);

      return NextResponse.json({
        items: paginatedItems,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
    }

    const [items, total] = await Promise.all([
      prisma.inventoryItem.findMany({
        where,
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          vendor: { select: { id: true, name: true } },
        },
      }),
      prisma.inventoryItem.count({ where }),
    ]);

    return NextResponse.json({
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Failed to fetch inventory:", error);
    return NextResponse.json({ error: "Failed to fetch inventory" }, { status: 500 });
  }
}
