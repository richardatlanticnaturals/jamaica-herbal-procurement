import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { refreshStock } from "@/lib/refresh-stock";

export const maxDuration = 300; // Allow up to 5 minutes

/**
 * POST /api/comcash/refresh-stock
 *
 * Fast stock-only sync from Comcash POS.
 * Updates ONLY currentStock on InventoryItem — does NOT touch
 * names, prices, vendors, or categories. Much faster than full sync.
 */
export async function POST() {
  const authError = await requireAuth();
  if (authError) return authError;

  const result = await refreshStock();

  if (!result.success) {
    return NextResponse.json(
      { error: result.error || "Stock refresh failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ...result,
    message: `Stock refreshed: ${result.itemsUpdated} items updated, ${result.itemsSkipped} unchanged (${result.durationMs}ms)`,
  });
}
