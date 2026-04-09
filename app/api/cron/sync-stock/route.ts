import { NextRequest, NextResponse } from "next/server";
import { refreshStock } from "@/lib/refresh-stock";

export const maxDuration = 300; // Allow up to 5 minutes

/**
 * GET /api/cron/sync-stock
 *
 * Vercel Cron Job — runs every 30 minutes.
 * Performs a fast stock-only refresh from Comcash POS.
 * Validates the CRON_SECRET to prevent unauthorized calls.
 */
export async function GET(request: NextRequest) {
  // Validate cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn("[Cron Sync Stock] Unauthorized request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[Cron Sync Stock] Starting scheduled stock refresh...");

  const result = await refreshStock();

  if (!result.success) {
    console.error("[Cron Sync Stock] Failed:", result.error);
    return NextResponse.json(
      { error: result.error || "Stock refresh failed" },
      { status: 500 }
    );
  }

  console.log(
    `[Cron Sync Stock] Complete: ${result.itemsUpdated} updated, ${result.itemsSkipped} unchanged, ${result.durationMs}ms`
  );

  return NextResponse.json({
    ...result,
    message: `Cron stock refresh: ${result.itemsUpdated} items updated (${result.durationMs}ms)`,
  });
}
