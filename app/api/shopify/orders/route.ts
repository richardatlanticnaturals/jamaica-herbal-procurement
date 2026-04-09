import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";

/**
 * GET /api/shopify/orders
 * Fetches recent orders from Shopify Admin API.
 * Query params:
 *   status - "any" | "open" | "closed" (default "any")
 *   limit - number of orders (default 50, max 250)
 *   created_at_min - ISO date string to filter orders after this date
 */

const SHOPIFY_API_VERSION = "2024-10";

function getBaseUrl(): string {
  const store = process.env.SHOPIFY_STORE;
  if (!store) throw new Error("SHOPIFY_STORE env var is not set");
  return `https://${store}/admin/api/${SHOPIFY_API_VERSION}`;
}

function getHeaders(): Record<string, string> {
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!token) throw new Error("SHOPIFY_ACCESS_TOKEN env var is not set");
  return {
    "X-Shopify-Access-Token": token,
    "Content-Type": "application/json",
  };
}

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "any";
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 250);
    const createdAtMin = searchParams.get("created_at_min") || "";

    const baseUrl = getBaseUrl();
    const headers = getHeaders();

    // Build Shopify orders query
    const params = new URLSearchParams({
      status,
      limit: String(limit),
      fields:
        "id,name,created_at,total_price,financial_status,fulfillment_status,line_items,customer",
    });

    if (createdAtMin) {
      params.set("created_at_min", createdAtMin);
    }

    const url = `${baseUrl}/orders.json?${params.toString()}`;
    const res = await fetch(url, { headers });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Shopify API error (${res.status}): ${text}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    const orders = (data.orders || []).map((order: any) => ({
      id: order.id,
      name: order.name,
      createdAt: order.created_at,
      totalPrice: order.total_price,
      financialStatus: order.financial_status,
      fulfillmentStatus: order.fulfillment_status,
      customer: order.customer
        ? {
            firstName: order.customer.first_name,
            lastName: order.customer.last_name,
            email: order.customer.email,
          }
        : null,
      lineItems: (order.line_items || []).map((li: any) => ({
        id: li.id,
        title: li.title,
        sku: li.sku,
        quantity: li.quantity,
        price: li.price,
        variantTitle: li.variant_title,
      })),
    }));

    return NextResponse.json({
      orders,
      count: orders.length,
    });
  } catch (error) {
    console.error("Failed to fetch Shopify orders:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch Shopify orders",
      },
      { status: 500 }
    );
  }
}
