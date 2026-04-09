import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { fetchCategories } from "@/lib/comcash";

/**
 * GET /api/categories
 * Returns categories from inventory items + any Comcash categories not yet in use.
 */
export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    // Group by category and count items per category
    const grouped = await prisma.inventoryItem.groupBy({
      by: ["category"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    });

    // Format response: separate null/empty categories as "Uncategorized"
    const categories = grouped.map((g) => ({
      name: g.category || "Uncategorized",
      itemCount: g._count.id,
      isUncategorized: !g.category,
    }));

    // Also fetch Comcash categories and include any that don't exist in the app yet
    try {
      const comcashCats = await fetchCategories();
      const existingNames = new Set(categories.map((c) => c.name.toLowerCase()));
      for (const cc of comcashCats) {
        const name = cc.title || "";
        if (name && name !== "NONE" && !existingNames.has(name.toLowerCase())) {
          categories.push({
            name,
            itemCount: 0,
            isUncategorized: false,
          });
        }
      }
    } catch {
      // If Comcash is unreachable, just use DB categories
    }

    return NextResponse.json({ categories });
  } catch (error) {
    console.error("Failed to fetch categories:", error);
    return NextResponse.json(
      { error: "Failed to fetch categories" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/categories
 * Create or rename a category.
 * Body: { oldName?: string, newName: string }
 * - If oldName is provided, renames all items from oldName to newName.
 * - If only newName is provided, this is a no-op (categories are derived from items).
 */
export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const { oldName, newName } = body;

    if (!newName || typeof newName !== "string") {
      return NextResponse.json(
        { error: "newName is required" },
        { status: 400 }
      );
    }

    const trimmedNew = newName.trim();
    if (!trimmedNew) {
      return NextResponse.json(
        { error: "newName cannot be empty" },
        { status: 400 }
      );
    }

    if (oldName && typeof oldName === "string") {
      // Rename: update all items with oldName to newName
      const result = await prisma.inventoryItem.updateMany({
        where: { category: oldName },
        data: { category: trimmedNew },
      });

      return NextResponse.json({
        success: true,
        message: `Renamed "${oldName}" to "${trimmedNew}". ${result.count} items updated.`,
        itemsUpdated: result.count,
      });
    }

    // If no oldName, just acknowledge the category name
    // (Categories are implicit from item data)
    return NextResponse.json({
      success: true,
      message: `Category "${trimmedNew}" noted. Assign items to this category to populate it.`,
    });
  } catch (error) {
    console.error("Failed to update category:", error);
    return NextResponse.json(
      { error: "Failed to update category" },
      { status: 500 }
    );
  }
}
