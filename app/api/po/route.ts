import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const status = searchParams.get("status") || "";
    // Search by PO number or vendor name
    const search = searchParams.get("search") || "";
    // Date range filters on createdAt
    const dateFrom = searchParams.get("dateFrom") || "";
    const dateTo = searchParams.get("dateTo") || "";

    const vendorId = searchParams.get("vendorId") || "";

    const where: any = {};

    if (status) {
      where.status = status;
    }
    // Filter by vendor if provided
    if (vendorId) {
      where.vendorId = vendorId;
    }

    // Search: match poNumber (contains) OR vendor name (contains)
    if (search) {
      where.OR = [
        { poNumber: { contains: search, mode: "insensitive" } },
        { vendor: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    // Date range filter on createdAt
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        // Include the entire "dateTo" day by setting to end of day
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        where.createdAt.lte = endDate;
      }
    }

    const [orders, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          vendor: { select: { id: true, name: true, email: true } },
          _count: { select: { lineItems: true } },
        },
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    return NextResponse.json({
      orders,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Failed to fetch POs:", error);
    return NextResponse.json({ error: "Failed to fetch purchase orders" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();

    // Fix #4: Wrap upsert + PO creation in a transaction to prevent race conditions
    const po = await prisma.$transaction(async (tx) => {
      // Get next PO number
      const settings = await tx.appSettings.upsert({
        where: { id: "singleton" },
        update: { nextPoSequence: { increment: 1 } },
        create: { id: "singleton" },
      });

      const poNumber = `${settings.poNumberPrefix}-${new Date().getFullYear()}-${String(settings.nextPoSequence).padStart(4, "0")}`;

      // Calculate totals from line items
      const lineItems = body.lineItems || [];
      const subtotal = lineItems.reduce(
        (sum: number, item: any) => sum + item.qtyOrdered * item.unitCost,
        0
      );

      const created = await tx.purchaseOrder.create({
        data: {
          poNumber,
          vendorId: body.vendorId,
          status: "DRAFT",
          subtotal,
          total: subtotal,
          orderMethod: body.orderMethod || "EMAIL",
          notes: body.notes || null,
          locationCode: body.locationCode || null,
          createdBy: "manual",
          lineItems: {
            create: lineItems.map((item: any) => ({
              inventoryItemId: item.inventoryItemId,
              vendorSku: item.vendorSku || null,
              description: item.description,
              qtyOrdered: item.qtyOrdered,
              unitCost: item.unitCost,
              lineTotal: item.qtyOrdered * item.unitCost,
            })),
          },
          statusHistory: {
            create: {
              toStatus: "DRAFT",
              note: "Purchase order created",
              triggeredBy: "manual",
            },
          },
        },
        include: {
          vendor: true,
          lineItems: { include: { inventoryItem: true } },
        },
      });

      return created;
    });

    return NextResponse.json({ po }, { status: 201 });
  } catch (error) {
    console.error("Failed to create PO:", error);
    return NextResponse.json({ error: "Failed to create purchase order" }, { status: 500 });
  }
}
