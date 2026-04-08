import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET /api/settings
 * Returns the current app settings along with env-based API key statuses.
 */
export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const settings = await prisma.appSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton" },
      update: {},
    });

    return NextResponse.json({
      ...settings,
      // Employee API uses OPENAPI_KEY + PIN + PASSWORD
      comcashApiKeySet: !!process.env.COMCASH_OPENAPI_KEY,
      anthropicApiKeySet: !!process.env.ANTHROPIC_API_KEY,
      comcashApiUrl: process.env.COMCASH_OPENAPI_URL || null,
    });
  } catch (error) {
    console.error("Failed to fetch settings:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/settings
 * Updates writable app settings fields.
 */
export async function PATCH(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();

    const allowedFields = [
      "poNumberPrefix",
      "defaultLeadTimeDays",
      "defaultReorderPoint",
      "defaultReorderQty",
      "autoGeneratePOs",
      "autoSendPOs",
      "poApprovalRequired",
      "syncIntervalMinutes",
    ];

    const updateData: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const updated = await prisma.appSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...updateData },
      update: updateData,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update settings:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
