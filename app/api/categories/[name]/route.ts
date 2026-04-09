import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET /api/categories/[name]
 * Returns all inventory items in the specified category.
 * Use "Uncategorized" to get items with null/empty category.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { name } = await params;
    const categoryName = decodeURIComponent(name);
    const isUncategorized =
      categoryName.toLowerCase() === "uncategorized";

    const items = await prisma.inventoryItem.findMany({
      where: isUncategorized
        ? { OR: [{ category: null }, { category: "" }] }
        : { category: categoryName },
      orderBy: { name: "asc" },
      include: {
        vendor: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({
      category: categoryName,
      itemCount: items.length,
      items,
    });
  } catch (error) {
    console.error("Failed to fetch category items:", error);
    return NextResponse.json(
      { error: "Failed to fetch category items" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/categories/[name]
 * Rename a category or merge it with another.
 * Body: { newName: string }
 * Updates all items with the current category name to the new name.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { name } = await params;
    const currentName = decodeURIComponent(name);
    const body = await request.json();
    const { newName } = body;

    if (!newName || typeof newName !== "string" || !newName.trim()) {
      return NextResponse.json(
        { error: "newName is required" },
        { status: 400 }
      );
    }

    const trimmedNew = newName.trim();
    const isUncategorized =
      currentName.toLowerCase() === "uncategorized";

    // Update all items from old category to new category
    const result = await prisma.inventoryItem.updateMany({
      where: isUncategorized
        ? { OR: [{ category: null }, { category: "" }] }
        : { category: currentName },
      data: { category: trimmedNew },
    });

    return NextResponse.json({
      success: true,
      message: `Renamed "${currentName}" to "${trimmedNew}". ${result.count} items updated.`,
      itemsUpdated: result.count,
    });
  } catch (error) {
    console.error("Failed to rename category:", error);
    return NextResponse.json(
      { error: "Failed to rename category" },
      { status: 500 }
    );
  }
}
