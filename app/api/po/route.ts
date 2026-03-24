import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const status = searchParams.get("status") || "";

    const where: any = {};
    if (status) {
      where.status = status;
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
  try {
    const body = await request.json();

    // Get next PO number
    const settings = await prisma.appSettings.upsert({
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

    const po = await prisma.purchaseOrder.create({
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

    return NextResponse.json({ po }, { status: 201 });
  } catch (error) {
    console.error("Failed to create PO:", error);
    return NextResponse.json({ error: "Failed to create purchase order" }, { status: 500 });
  }
}
