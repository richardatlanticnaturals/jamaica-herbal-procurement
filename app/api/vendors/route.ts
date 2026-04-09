import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const vendors = await prisma.vendor.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { items: true, purchaseOrders: true },
        },
      },
    });
    return NextResponse.json({ vendors });
  } catch (error) {
    console.error("Failed to fetch vendors:", error);
    return NextResponse.json({ error: "Failed to fetch vendors" }, { status: 500 });
  }
}

// PATCH /api/vendors — inline single-field update (requires id in body)
export async function PATCH(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const { id, field, value } = body;

    if (!id || !field) {
      return NextResponse.json(
        { error: "id and field are required" },
        { status: 400 }
      );
    }

    // Whitelist of editable fields for inline editing
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

    // Coerce types as needed
    let coercedValue: unknown = value;
    if (field === "leadTimeDays") coercedValue = Number(value) || 0;
    if (field === "minimumOrder") coercedValue = value ? Number(value) : null;
    if (value === "" || value === null) {
      if (field !== "name") coercedValue = null; // name is required
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

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const vendor = await prisma.vendor.create({
      data: {
        name: body.name,
        contactName: body.contactName || null,
        email: body.email || null,
        phone: body.phone || null,
        website: body.website || null,
        orderMethod: body.orderMethod || "EMAIL",
        paymentTerms: body.paymentTerms || null,
        leadTimeDays: body.leadTimeDays || 3,
        notes: body.notes || null,
      },
    });
    return NextResponse.json({ vendor }, { status: 201 });
  } catch (error) {
    console.error("Failed to create vendor:", error);
    return NextResponse.json({ error: "Failed to create vendor" }, { status: 500 });
  }
}
