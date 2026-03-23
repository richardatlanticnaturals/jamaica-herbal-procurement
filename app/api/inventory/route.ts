import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const items = await prisma.inventoryItem.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: {
        vendor: {
          select: { id: true, name: true },
        },
      },
    });
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Failed to fetch inventory:", error);
    return NextResponse.json({ error: "Failed to fetch inventory" }, { status: 500 });
  }
}
