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

    const where: any = { isActive: true };

    // Filter by vendor if provided
    if (vendorId) {
      where.vendorId = vendorId;
    }

    // Filter by category
    if (category === "__uncategorized") {
      where.OR = [...(where.OR || []), { category: null }, { category: "" }];
    } else if (category) {
      where.category = { equals: category, mode: "insensitive" };
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
        { category: { contains: search, mode: "insensitive" } },
      ];
    }

    if (filter === "low-stock") {
      where.currentStock = { gt: 0, lte: 5 };
    } else if (filter === "out-of-stock") {
      where.currentStock = { lte: 0 };
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
