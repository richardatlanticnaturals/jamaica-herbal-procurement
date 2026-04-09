import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

// GET /api/vendors/[id] — fetch single vendor with counts
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const vendor = await prisma.vendor.findUnique({
      where: { id },
      include: {
        _count: {
          select: { items: true, purchaseOrders: true },
        },
      },
    });

    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    }

    // Get total spent from completed POs
    const totalSpent = await prisma.purchaseOrder.aggregate({
      where: {
        vendorId: id,
        status: { in: ["RECEIVED", "CLOSED"] },
      },
      _sum: { total: true },
    });

    return NextResponse.json({
      vendor,
      stats: {
        totalPOs: vendor._count.purchaseOrders,
        totalItems: vendor._count.items,
        totalSpent: Number(totalSpent._sum.total || 0),
      },
    });
  } catch (error) {
    console.error("Failed to fetch vendor:", error);
    return NextResponse.json(
      { error: "Failed to fetch vendor" },
      { status: 500 }
    );
  }
}

// PATCH /api/vendors/[id] — inline single-field update
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();
    const { field, value } = body;

    if (!field) {
      return NextResponse.json({ error: "field is required" }, { status: 400 });
    }

    const allowedFields = [
      "name", "contactName", "email", "phone", "website",
      "orderMethod", "leadTimeDays", "minimumOrder", "paymentTerms", "notes",
    ];

    if (!allowedFields.includes(field)) {
      return NextResponse.json(
        { error: `Field '${field}' is not editable` },
        { status: 400 }
      );
    }

    let coercedValue: unknown = value;
    if (field === "leadTimeDays") coercedValue = Number(value) || 0;
    if (field === "minimumOrder") coercedValue = value ? Number(value) : null;
    if (value === "" || value === null) {
      if (field !== "name") coercedValue = null;
    }

    const vendor = await prisma.vendor.update({
      where: { id },
      data: { [field]: coercedValue },
      include: {
        _count: {
          select: { items: true, purchaseOrders: true },
        },
      },
    });

    return NextResponse.json({ vendor });
  } catch (error) {
    console.error("Failed to patch vendor:", error);
    return NextResponse.json(
      { error: "Failed to update vendor" },
      { status: 500 }
    );
  }
}

// PUT /api/vendors/[id] — update vendor details
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.contactName !== undefined) data.contactName = body.contactName || null;
    if (body.email !== undefined) data.email = body.email || null;
    if (body.phone !== undefined) data.phone = body.phone || null;
    if (body.website !== undefined) data.website = body.website || null;
    if (body.orderMethod !== undefined) data.orderMethod = body.orderMethod;
    if (body.leadTimeDays !== undefined) data.leadTimeDays = Number(body.leadTimeDays);
    if (body.paymentTerms !== undefined) data.paymentTerms = body.paymentTerms || null;
    if (body.minimumOrder !== undefined) data.minimumOrder = body.minimumOrder ? Number(body.minimumOrder) : null;
    if (body.notes !== undefined) data.notes = body.notes || null;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const vendor = await prisma.vendor.update({
      where: { id },
      data,
      include: {
        _count: {
          select: { items: true, purchaseOrders: true },
        },
      },
    });

    return NextResponse.json({ vendor });
  } catch (error) {
    console.error("Failed to update vendor:", error);
    return NextResponse.json(
      { error: "Failed to update vendor" },
      { status: 500 }
    );
  }
}
