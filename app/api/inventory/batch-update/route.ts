import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

// POST /api/inventory/batch-update — batch field updates for inline editing
// Accepts { updates: [{ id, field, value }] }
export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const { updates } = body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json(
        { error: "updates array is required and must not be empty" },
        { status: 400 }
      );
    }

    // Whitelist of fields that can be edited inline
    const allowedFields = [
      "currentStock",
      "reorderPoint",
      "reorderQty",
      "costPrice",
      "retailPrice",
      "category",
      "vendorId",
      "isActive",
    ];

    // Validate all updates before applying
    for (const update of updates) {
      if (!update.id || !update.field) {
        return NextResponse.json(
          { error: "Each update must have id and field" },
          { status: 400 }
        );
      }
      if (!allowedFields.includes(update.field)) {
        return NextResponse.json(
          { error: `Field '${update.field}' is not editable` },
          { status: 400 }
        );
      }
    }

    // Apply updates in a transaction for atomicity
    const results = await prisma.$transaction(
      updates.map((update: { id: string; field: string; value: unknown }) => {
        let coercedValue: unknown = update.value;

        // Coerce types based on field
        if (update.field === "currentStock" || update.field === "reorderPoint" || update.field === "reorderQty") {
          coercedValue = Number(update.value) || 0;
        }
        if (update.field === "costPrice" || update.field === "retailPrice") {
          coercedValue = Number(update.value) || 0;
        }
        if (update.field === "isActive") {
          coercedValue = Boolean(update.value);
        }
        if (update.field === "vendorId") {
          coercedValue = update.value || null;
        }
        if (update.field === "category") {
          coercedValue = update.value || null;
        }

        return prisma.inventoryItem.update({
          where: { id: update.id },
          data: { [update.field]: coercedValue },
        });
      })
    );

    return NextResponse.json({
      updated: results.length,
      items: results.map((item) => ({ id: item.id, [updates.find((u: any) => u.id === item.id)?.field || ""]: (item as any)[updates.find((u: any) => u.id === item.id)?.field || ""] })),
    });
  } catch (error) {
    console.error("Failed to batch update inventory:", error);
    return NextResponse.json(
      { error: "Failed to batch update inventory" },
      { status: 500 }
    );
  }
}
