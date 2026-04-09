import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

// GET /api/inventory/[id] — fetch single inventory item with vendor info
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const item = await prisma.inventoryItem.findUnique({
      where: { id },
      include: {
        vendor: { select: { id: true, name: true, email: true, phone: true } },
      },
    });

    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json({ item });
  } catch (error) {
    console.error("Failed to fetch inventory item:", error);
    return NextResponse.json(
      { error: "Failed to fetch inventory item" },
      { status: 500 }
    );
  }
}

// PATCH /api/inventory/[id] — partial update (e.g. category reassignment)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();

    const data: Record<string, unknown> = {};
    if (body.category !== undefined) data.category = body.category || null;
    if (body.reorderPoint !== undefined) data.reorderPoint = Number(body.reorderPoint);
    if (body.reorderQty !== undefined) data.reorderQty = Number(body.reorderQty);
    if (body.vendorId !== undefined) data.vendorId = body.vendorId || null;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const item = await prisma.inventoryItem.update({
      where: { id },
      data,
      include: {
        vendor: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ item });
  } catch (error) {
    console.error("Failed to patch inventory item:", error);
    return NextResponse.json(
      { error: "Failed to update inventory item" },
      { status: 500 }
    );
  }
}

// PUT /api/inventory/[id] — update inventory item settings
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();

    // Only allow updating specific fields
    const data: Record<string, unknown> = {};
    if (body.reorderPoint !== undefined) data.reorderPoint = Number(body.reorderPoint);
    if (body.reorderQty !== undefined) data.reorderQty = Number(body.reorderQty);
    if (body.costPrice !== undefined) data.costPrice = Number(body.costPrice);
    if (body.retailPrice !== undefined) data.retailPrice = Number(body.retailPrice);
    if (body.vendorId !== undefined) data.vendorId = body.vendorId || null;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (body.category !== undefined) data.category = body.category || null;

    const item = await prisma.inventoryItem.update({
      where: { id },
      data,
      include: {
        vendor: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ item });
  } catch (error) {
    console.error("Failed to update inventory item:", error);
    return NextResponse.json(
      { error: "Failed to update inventory item" },
      { status: 500 }
    );
  }
}
