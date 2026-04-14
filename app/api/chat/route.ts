import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";
import {
  authenticateEmployee,
  fetchVendors,
  fetchAllProducts,
} from "@/lib/comcash";
import { refreshStock } from "@/lib/refresh-stock";

// --- Comcash Employee API config ---
const COMCASH_OPENAPI_URL =
  process.env.COMCASH_OPENAPI_URL ||
  "https://ssl-openapi-jamaicanherbal.comcash.com";
const COMCASH_OPENAPI_KEY = process.env.COMCASH_OPENAPI_KEY || "";

// --- Claude client ---
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- System prompt for the procurement assistant ---
const SYSTEM_PROMPT = `Jamaica Herbal procurement assistant. Two stores: Lauderdale Lakes, North Lauderdale.
Be concise. Use markdown tables. Format money as $X.XX.
WRITES: Always dry run first, show summary, ask "Ready to apply? yes/no", only apply after confirmation. After applying, sync to Comcash.
READS: No confirmation needed.
SALES DATA:
- For product-specific sales questions ("how many patties sold?", "turmeric sales this week"), use search_sales with the product name and days parameter. It paginates through up to 500 live sales and returns aggregated data with daily breakdowns.
- For "top sellers" or "best sellers", use query_top_sellers. Pass days param to filter by time period (e.g. days=7 for "this week", days=30 for "this month").
- For "how is X selling?" or product deep-dives, use query_product_history for a complete product profile including stock, pricing, vendor, and sales history.
- For items that haven't sold, use query_slow_movers (uses ProductSales cache).
- NEVER say "I don't have access to sales data" — always try search_sales first.
STOCK LEVELS: When answering stock level questions, always call refresh_stock first to ensure data is current. Tell the user "Refreshing stock from POS..." before showing results.
PO STATUSES: DRAFT (not sent), PENDING_APPROVAL (needs approval), APPROVED (ready to send), SENT (sent to vendor, awaiting delivery), CONFIRMED (vendor confirmed), PARTIALLY_RECEIVED (some items received), RECEIVED (all received), CANCELLED, CLOSED. When user says "pending POs", they mean active undelivered POs: use status SENT or query with no status filter and explain the breakdown.
Categories (from Comcash POS): Jamaica Herbal Products, Grocery, Herbs, Skin Care, Vitamins, Sea Moss Gel, Digestive Health, Mens Health, Womens Health, Essential Oils, Cold and Flu, Teas, Juice Bar, Hair Care, Heart Health, Superfoods and Greens, Detox, CBD, Tonics, Joint Support, Nuts and Seeds, Sleep and Stress Relief, Atlantic Naturals Products, Incense, Brain Health, Oral Care, Ethnic Products, Weight Loss, Blood Sugar Support, Patties, Acai, Coffee, Blood Pressure Support, Body Building, Hot Tea Beverage.
When searching for items or categories, use the query_inventory tool with the category or search param. Use partial matches — e.g. category: "Herb" will match "Herbs".
SMART POs: When asked to create a PO for a vendor (especially excluding slow movers), use create_smart_po. It handles everything server-side in one call. Do NOT manually query inventory then create a PO — use create_smart_po instead.
PO STATUSES: DRAFT=new, APPROVED=ready to send, SENT=emailed to vendor, CONFIRMED=vendor confirmed, PARTIALLY_RECEIVED=some items arrived, RECEIVED=all arrived, CLOSED=completed.`;

// --- Tool definitions for Claude ---
const tools: Anthropic.Tool[] = [
  {
    name: "query_inventory",
    description: "Search inventory by name/SKU, filter by stock status or vendor.",
    input_schema: {
      type: "object" as const,
      properties: {
        search: { type: "string" },
        status: { type: "string", enum: ["all", "low_stock", "out_of_stock"] },
        vendorId: { type: "string", description: "Filter by vendor ID" },
        vendorName: { type: "string", description: "Filter by vendor name (searches by partial match)" },
        category: { type: "string", description: "Filter by category name (partial match)" },
        limit: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "query_purchase_orders",
    description:
      "Query purchase orders with filters for status, vendor, date range, or search by PO number.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          description:
            "PO status filter (DRAFT, PENDING_APPROVAL, APPROVED, SENT, CONFIRMED, PARTIALLY_RECEIVED, RECEIVED, CANCELLED, CLOSED)",
        },
        vendorId: { type: "string", description: "Filter by vendor ID" },
        search: {
          type: "string",
          description: "Search by PO number or vendor name",
        },
        limit: { type: "number", description: "Max results (default 50)" },
        dateFrom: {
          type: "string",
          description: "Start date filter (ISO string)",
        },
        dateTo: {
          type: "string",
          description: "End date filter (ISO string)",
        },
      },
      required: [],
    },
  },
  {
    name: "query_vendors",
    description:
      "List or search vendors. Returns vendor info with counts of POs and inventory items.",
    input_schema: {
      type: "object" as const,
      properties: {
        search: {
          type: "string",
          description: "Search by vendor name",
        },
        limit: { type: "number", description: "Max results (default 50)" },
      },
      required: [],
    },
  },
  {
    name: "search_sales",
    description:
      "Search sales data by product name/keyword OR by category. Scans all sales in the date range. Use for 'how many patties sold this week', 'coffee category sales last 30 days', etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        productSearch: {
          type: "string",
          description: "Product name or keyword to search (partial match). E.g. 'patt' matches 'Vegan Patty'.",
        },
        category: {
          type: "string",
          description: "Search by category name. Looks up all products in this category, then finds their sales. E.g. 'Coffee' finds sales for Beet Root Latte, Espresso Shot, etc.",
        },
        days: {
          type: "number",
          description: "Number of days to look back (default 7). E.g. 7 for last week, 30 for last month, 90 for last quarter.",
        },
        limit: {
          type: "number",
          description: "Max number of sales to paginate through (default 500, max 500). Higher = more complete but slower.",
        },
      },
      required: [],
    },
  },
  {
    name: "create_purchase_order",
    description:
      "Create a new DRAFT purchase order for a specific vendor with line items. Returns the created PO.",
    input_schema: {
      type: "object" as const,
      properties: {
        vendorId: { type: "string", description: "Vendor ID to order from" },
        items: {
          type: "array",
          description: "Line items for the PO",
          items: {
            type: "object",
            properties: {
              inventoryItemId: {
                type: "string",
                description: "Inventory item ID",
              },
              qtyOrdered: { type: "number", description: "Quantity to order" },
              unitCost: { type: "number", description: "Cost per unit" },
              description: { type: "string", description: "Item description" },
            },
            required: [
              "inventoryItemId",
              "qtyOrdered",
              "unitCost",
              "description",
            ],
          },
        },
        notes: {
          type: "string",
          description: "Optional notes for the PO",
        },
      },
      required: ["vendorId", "items"],
    },
  },
  {
    name: "auto_generate_pos",
    description:
      "Automatically generate DRAFT purchase orders for items below their reorder point. Groups items by vendor. Skips vendors that already have a DRAFT PO. Optionally filter to specific vendors by ID or name.",
    input_schema: {
      type: "object" as const,
      properties: {
        vendorIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of vendor IDs to generate POs for. If omitted, generates for all vendors with low-stock items.",
        },
        vendorNames: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of vendor names to generate POs for (partial match). If omitted, generates for all vendors.",
        },
      },
      required: [],
    },
  },
  {
    name: "create_smart_po",
    description: "Create a PO for a specific vendor with all low-stock items, optionally excluding items that haven't sold in X months. Handles the entire flow server-side: finds low stock items, checks sales history, creates the PO. Use this instead of manually querying inventory then creating a PO.",
    input_schema: {
      type: "object" as const,
      properties: {
        vendorName: { type: "string", description: "Vendor name to create PO for" },
        vendorId: { type: "string", description: "Vendor ID (if known)" },
        excludeSlowMonths: { type: "number", description: "Exclude items with no sales in this many months (default 0 = include all)" },
        notes: { type: "string", description: "Optional notes for the PO" },
        dryRun: { type: "boolean", description: "If true, show what would be ordered without creating. ALWAYS do dry run first." },
      },
      required: [],
    },
  },
  {
    name: "get_dashboard_stats",
    description:
      "Get key performance indicator counts: total products, low stock count, out of stock count, active POs, vendor count, and pending deliveries.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "sync_comcash_vendors",
    description:
      "Trigger a sync of vendors from the Comcash POS system into the local database.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "sync_comcash_products",
    description:
      "Trigger a sync of products/inventory from the Comcash POS system. This updates stock levels, prices, and product info.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "update_inventory_items",
    description:
      "Update one or more inventory items. Can change category, currentStock, reorderPoint, reorderQty, costPrice, retailPrice, vendorId, isActive. Use this for bulk operations like 'set all negative stock to 0', 'categorize uncategorized items', 'deactivate discontinued items', etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        updates: {
          type: "array",
          description: "Array of updates to apply. Each has an item ID and the fields to change.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Inventory item ID" },
              category: { type: "string", description: "New category name" },
              currentStock: { type: "number", description: "New stock count" },
              reorderPoint: { type: "number", description: "New reorder point" },
              reorderQty: { type: "number", description: "New reorder quantity" },
              costPrice: { type: "number", description: "New cost price" },
              retailPrice: { type: "number", description: "New retail price" },
              vendorId: { type: "string", description: "New vendor ID" },
              isActive: { type: "boolean", description: "Whether item is active" },
            },
            required: ["id"],
          },
        },
      },
      required: ["updates"],
    },
  },
  {
    name: "bulk_update_inventory",
    description:
      "Apply a bulk update to inventory items matching a filter. Use this for operations like 'set all negative stock to 0', 'set reorder point to 5 for all items with reorder point 0', etc. Returns the count of items updated.",
    input_schema: {
      type: "object" as const,
      properties: {
        filter: {
          type: "object",
          description: "Filter criteria to select items. All conditions must match (AND).",
          properties: {
            nameContains: { type: "string", description: "Match items whose name contains this text (case-insensitive)" },
            skuContains: { type: "string", description: "Match items whose SKU contains this text" },
            category: { type: "string", description: "Match items with this category (case-insensitive contains)" },
            categoryEmpty: { type: "boolean", description: "If true, match items with empty/null category" },
            vendorId: { type: "string", description: "Match items from this vendor" },
            vendorName: { type: "string", description: "Match items from vendor with this name (searches)" },
            vendorEmpty: { type: "boolean", description: "If true, match items with no vendor assigned" },
            stockBelow: { type: "number", description: "Match items with currentStock below this number" },
            stockAbove: { type: "number", description: "Match items with currentStock above this number" },
            isActive: { type: "boolean", description: "Match active or inactive items" },
          },
        },
        set: {
          type: "object",
          description: "Fields to update on all matching items.",
          properties: {
            category: { type: "string", description: "Set category to this value" },
            currentStock: { type: "number", description: "Set stock to this value" },
            reorderPoint: { type: "number", description: "Set reorder point to this value" },
            reorderQty: { type: "number", description: "Set reorder quantity to this value" },
            costPrice: { type: "number", description: "Set cost price" },
            retailPrice: { type: "number", description: "Set retail price" },
            vendorId: { type: "string", description: "Assign to this vendor" },
            isActive: { type: "boolean", description: "Set active/inactive" },
          },
        },
        dryRun: {
          type: "boolean",
          description: "If true, only count matching items without making changes. Always do a dry run first and tell the user how many items will be affected before applying.",
        },
      },
      required: ["filter", "set"],
    },
  },
  {
    name: "sync_inventory_to_comcash",
    description:
      "Push updated inventory stock levels from the app database to Comcash POS via warehouse/changeQuantity. Call this AFTER applying inventory changes to sync the POS system. Pass the IDs of items that were changed.",
    input_schema: {
      type: "object" as const,
      properties: {
        inventoryItemIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of inventory item IDs to sync to Comcash. If empty, syncs all items that have a comcashItemId.",
        },
      },
      required: [],
    },
  },
  {
    name: "query_slow_movers",
    description: "Find inventory items that haven't sold recently, using the ProductSales cache. Returns items NOT in the sales cache (never sold) or with lastSoldAt older than X months. Can filter by vendor.",
    input_schema: {
      type: "object" as const,
      properties: {
        months: { type: "number", description: "Items with no sales in this many months (default 4)" },
        vendorId: { type: "string", description: "Filter by vendor ID" },
        vendorName: { type: "string", description: "Filter by vendor name (searches)" },
        limit: { type: "number", description: "Max results (default 20)" },
      },
      required: [],
    },
  },
  {
    name: "query_top_sellers",
    description: "Get top-selling products. Uses ProductSales cache for all-time data, or paginates live Comcash API when a specific time period is requested via 'days' parameter. Use days=7 for 'this week', days=30 for 'this month'.",
    input_schema: {
      type: "object" as const,
      properties: {
        sortBy: { type: "string", enum: ["qty", "revenue"], description: "Sort by quantity sold or revenue (default qty)" },
        vendorId: { type: "string", description: "Filter by vendor ID" },
        vendorName: { type: "string", description: "Filter by vendor name (searches)" },
        category: { type: "string", description: "Filter by inventory category" },
        days: { type: "number", description: "Only count sales from the last N days. If omitted, uses all-time cache data. Use 7 for 'this week', 30 for 'this month'." },
        limit: { type: "number", description: "Max results (default 20)" },
      },
      required: [],
    },
  },
  {
    name: "query_product_history",
    description: "Get a complete product profile: current stock, reorder point, cost/retail price, category, vendor, total qty sold (from cache), and daily sales for last 30 days from live API. Use for 'how is X selling?' or product deep-dives.",
    input_schema: {
      type: "object" as const,
      properties: {
        productName: { type: "string", description: "Product name to look up (partial match)" },
      },
      required: ["productName"],
    },
  },
  {
    name: "refresh_stock",
    description:
      "Fast refresh of stock levels from the Comcash POS. Updates ONLY currentStock on inventory items (not names, prices, or vendors). Call this before answering any stock level questions to ensure data is current.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "auto_tune_reorder_points",
    description:
      "Calculate optimal reorder points based on sales velocity over the last 90 days. Uses formula: ceil(avgDailySales * leadTimeDays * safetyFactor). Default safetyFactor is 1.25 (lean). Returns a preview of suggested changes. If dryRun is false, applies the changes. Always do a dry run first and show the user what will change before applying.",
    input_schema: {
      type: "object" as const,
      properties: {
        safetyFactor: { type: "number", description: "Safety stock multiplier (default 1.25)" },
        minReorderPoint: { type: "number", description: "Minimum reorder point floor (default 2)" },
        periodDays: { type: "number", description: "Number of days of sales history to analyze (default 90)" },
        dryRun: { type: "boolean", description: "If true (default), only preview changes without applying. Set to false to apply after user confirms." },
      },
      required: [],
    },
  },
];

// --- Tool execution handlers ---

// Safety cap: truncate tool results to prevent token explosions
// Aggregated results (search_sales, query_product_history, query_top_sellers) are already
// compact so we use a higher limit and smarter truncation.
const MAX_TOOL_RESULT_CHARS = 6000;
function capResult(json: string, toolName?: string): string {
  if (!json || json.length <= MAX_TOOL_RESULT_CHARS) return json || "{}";
  // Try to parse and limit array items
  try {
    const obj = JSON.parse(json);
    // Sales aggregation tools return pre-aggregated data — only trim dailyBreakdown
    // and matchedProducts, not the summary fields
    if (toolName === "search_sales" || toolName === "query_product_history" || toolName === "query_top_sellers") {
      // Trim daily breakdown to 30 max entries
      if (Array.isArray(obj.dailyBreakdown) && obj.dailyBreakdown.length > 30) {
        obj.dailyBreakdown = obj.dailyBreakdown.slice(0, 30);
        obj.dailyBreakdown_note = "Showing last 30 days";
      }
      // Trim matched products to 25 max
      if (Array.isArray(obj.matchedProducts) && obj.matchedProducts.length > 25) {
        const total = obj.matchedProducts.length;
        obj.matchedProducts = obj.matchedProducts.slice(0, 25);
        obj.matchedProducts_note = `Showing top 25 of ${total}`;
      }
      if (Array.isArray(obj.items) && obj.items.length > 25) {
        const total = obj.items.length;
        obj.items = obj.items.slice(0, 25);
        obj.items_note = `Showing top 25 of ${total}`;
      }
      const trimmed = JSON.stringify(obj);
      if (trimmed.length <= MAX_TOOL_RESULT_CHARS) return trimmed;
    }
    // Default truncation for other tools
    for (const key of Object.keys(obj)) {
      if (Array.isArray(obj[key]) && obj[key].length > 10) {
        const total = obj[key].length;
        obj[key] = obj[key].slice(0, 10);
        obj[key + "_note"] = `Showing 10 of ${total}. Ask for more with higher limit.`;
      }
    }
    const trimmed = JSON.stringify(obj);
    if (trimmed.length <= MAX_TOOL_RESULT_CHARS) return trimmed;
    // Still too large — aggressively trim arrays to 5
    for (const key of Object.keys(obj)) {
      if (Array.isArray(obj[key]) && obj[key].length > 5) {
        const total = obj[key].length;
        obj[key] = obj[key].slice(0, 5);
        obj[key + "_note"] = `Showing 5 of ${total}. Ask for more with higher limit.`;
      }
    }
    return JSON.stringify(obj).slice(0, MAX_TOOL_RESULT_CHARS);
  } catch {
    // Not valid JSON — return a safe truncated JSON object
    return JSON.stringify({ data: json.slice(0, MAX_TOOL_RESULT_CHARS - 50), truncated: true });
  }
}

async function executeToolCall(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  try {
    let result: string;
    switch (name) {
      case "query_inventory": result = await handleQueryInventory(input); break;
      case "query_purchase_orders": result = await handleQueryPurchaseOrders(input); break;
      case "query_vendors": result = await handleQueryVendors(input); break;
      case "search_sales": result = await handleSearchSales(input); break;
      case "create_purchase_order": result = await handleCreatePO(input); break;
      case "auto_generate_pos": result = await handleAutoGeneratePOs(input); break;
      case "create_smart_po": result = await handleCreateSmartPO(input); break;
      case "get_dashboard_stats": result = await handleDashboardStats(); break;
      case "sync_comcash_vendors": result = await handleSyncVendors(); break;
      case "sync_comcash_products": result = await handleSyncProducts(); break;
      case "update_inventory_items": result = await handleUpdateInventoryItems(input); break;
      case "bulk_update_inventory": result = await handleBulkUpdateInventory(input); break;
      case "sync_inventory_to_comcash": result = await handleSyncInventoryToComcash(input); break;
      case "query_slow_movers": result = await handleQuerySlowMovers(input); break;
      case "query_top_sellers": result = await handleQueryTopSellers(input); break;
      case "query_product_history": result = await handleQueryProductHistory(input); break;
      case "refresh_stock": result = await handleRefreshStock(); break;
      case "auto_tune_reorder_points": result = await handleAutoTuneReorderPoints(input); break;
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
    // Pass tool name so capResult can use smarter truncation for aggregated tools
    return capResult(result, name);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Chat Tool Error] ${name}:`, msg);
    return JSON.stringify({ error: msg });
  }
}

// --- Individual tool handlers ---

async function handleQueryInventory(
  input: Record<string, unknown>
): Promise<string> {
  const search = (input.search as string) || "";
  const status = (input.status as string) || "all";
  const vendorName = (input.vendorName as string) || "";
  const category = (input.category as string) || "";
  const limit = (input.limit as number) || 20;

  // Resolve vendorName to vendorId if provided
  let vendorId = (input.vendorId as string) || "";
  if (vendorName && !vendorId) {
    const vendor = await prisma.vendor.findFirst({
      where: { name: { contains: vendorName, mode: "insensitive" } },
      select: { id: true },
    });
    if (vendor) vendorId = vendor.id;
    else {
      return JSON.stringify({ items: [], count: 0, message: `No vendor found matching "${vendorName}"` });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { isActive: true };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
      { category: { contains: search, mode: "insensitive" } },
    ];
  }

  if (vendorId) {
    where.vendorId = vendorId;
  }

  if (category) {
    where.category = { contains: category, mode: "insensitive" };
  }

  // low_stock needs in-memory filter because reorderPoint varies per item.
  // out_of_stock can be filtered at the DB level for efficiency.
  const needsInMemoryFilter = status === "low_stock";

  if (status === "out_of_stock") {
    where.currentStock = { lte: 0 };
  }

  // For low_stock, fetch all matching items since we filter in-memory
  // and need to scan the full dataset to find items near their reorder point.
  const items = await prisma.inventoryItem.findMany({
    where,
    take: needsInMemoryFilter ? 2000 : limit,
    orderBy: needsInMemoryFilter ? { currentStock: "asc" } : { name: "asc" },
    include: {
      vendor: { select: { id: true, name: true } },
    },
  });

  let filtered = items;
  if (status === "low_stock") {
    filtered = items.filter(
      (i) => i.currentStock > 0 && i.currentStock <= i.reorderPoint
    );
  } else if (status === "out_of_stock") {
    filtered = items.filter((i) => i.currentStock <= 0);
  }

  const result = filtered.slice(0, limit).map((i) => ({
    id: i.id,
    sku: i.sku,
    name: i.name,
    stock: i.currentStock,
    reorder: i.reorderPoint,
    cost: Number(i.costPrice),
    price: Number(i.retailPrice),
    vendor: i.vendor?.name || "—",
    vendorId: i.vendorId,
    cat: i.category || "",
  }));

  return JSON.stringify({ items: result, count: result.length });
}

async function handleQueryPurchaseOrders(
  input: Record<string, unknown>
): Promise<string> {
  const status = (input.status as string) || "";
  const vendorId = (input.vendorId as string) || "";
  const search = (input.search as string) || "";
  const limit = (input.limit as number) || 50;
  const dateFrom = (input.dateFrom as string) || "";
  const dateTo = (input.dateTo as string) || "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (status) where.status = status;
  if (vendorId) where.vendorId = vendorId;

  if (search) {
    where.OR = [
      { poNumber: { contains: search, mode: "insensitive" } },
      { vendor: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }

  const orders = await prisma.purchaseOrder.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      vendor: { select: { id: true, name: true } },
      _count: { select: { lineItems: true } },
    },
  });

  const result = orders.map((o) => ({
    id: o.id,
    po: o.poNumber,
    vendor: o.vendor.name,
    vendorId: o.vendorId,
    status: o.status,
    total: Number(o.total),
    items: o._count.lineItems,
    date: o.createdAt.toISOString().split("T")[0],
  }));

  return JSON.stringify({ orders: result, count: result.length });
}

async function handleQueryVendors(
  input: Record<string, unknown>
): Promise<string> {
  const search = (input.search as string) || "";
  const limit = (input.limit as number) || 50;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { isActive: true };

  if (search) {
    where.name = { contains: search, mode: "insensitive" };
  }

  const vendors = await prisma.vendor.findMany({
    where,
    take: limit,
    orderBy: { name: "asc" },
    include: {
      _count: { select: { purchaseOrders: true, items: true } },
    },
  });

  const result = vendors.map((v) => ({
    id: v.id,
    name: v.name,
    email: v.email || "",
    phone: v.phone || "",
    pos: v._count.purchaseOrders,
    items: v._count.items,
  }));

  return JSON.stringify({ vendors: result, count: result.length });
}

// --- search_sales: paginate through live Comcash sales, filter by product name, aggregate results ---
async function handleSearchSales(
  input: Record<string, unknown>
): Promise<string> {
  let productSearch = ((input.productSearch as string) || "").toLowerCase().trim();
  const categorySearch = ((input.category as string) || "").trim();
  const days = (input.days as number) || 7;

  // If category is provided, look up product names in that category
  let categoryProductNames: string[] = [];
  if (categorySearch) {
    const categoryItems = await prisma.inventoryItem.findMany({
      where: { category: { contains: categorySearch, mode: "insensitive" }, isActive: true },
      select: { name: true },
    });
    categoryProductNames = categoryItems.map((i) => i.name.toLowerCase());
    if (categoryProductNames.length === 0) {
      return JSON.stringify({ error: `No products found in category "${categorySearch}"`, matchedProducts: [], totalSales: 0 });
    }
  }

  try {
    const token = await authenticateEmployee();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffUnix = Math.floor(cutoffDate.getTime() / 1000);

    // Paginate through sales — 100 per page, up to maxSales
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allSales: any[] = [];
    let offset = 0;
    const pageSize = 100;
    let keepFetching = true;

    while (keepFetching) {
      const res = await fetch(`${COMCASH_OPENAPI_URL}/sale/list`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          OPEN_API_KEY: COMCASH_OPENAPI_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ limit: pageSize, offset, order: "desc" }),
      });

      if (!res.ok) {
        const text = await res.text();
        return JSON.stringify({ error: `Comcash API ${res.status}: ${text.slice(0, 200)}` });
      }

      const rawData = await res.json();
      const batch = Array.isArray(rawData) ? rawData : rawData.data || [];

      if (batch.length === 0) {
        keepFetching = false;
        break;
      }

      // Check if we've gone past the cutoff date
      for (const sale of batch) {
        const saleTime = sale.timeCreated || 0;
        if (saleTime < cutoffUnix) {
          // This sale is older than our window — stop fetching
          keepFetching = false;
          break;
        }
        allSales.push(sale);
      }

      offset += batch.length;

      // If batch was smaller than page size, no more data
      if (batch.length < pageSize) {
        keepFetching = false;
      }
    }

    // Aggregate by product — filter by productSearch if provided
    const productAgg: Record<string, {
      name: string;
      totalQty: number;
      totalRevenue: number;
      transactions: number;
      dailyMap: Record<string, { qty: number; revenue: number }>;
    }> = {};

    let totalTransactions = 0;
    let totalRevenue = 0;

    for (const sale of allSales) {
      const saleDate = sale.timeCreated
        ? new Date(sale.timeCreated * 1000).toISOString().split("T")[0]
        : "unknown";
      const products = sale.products || [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const p of products as any[]) {
        const title = (p.title || "").trim();
        const titleLower = title.toLowerCase();

        // Filter by product search OR category products
        if (categoryProductNames.length > 0) {
          // Category mode: match against any product name in the category
          if (!categoryProductNames.some((cpn) => titleLower.includes(cpn) || cpn.includes(titleLower))) continue;
        } else if (productSearch) {
          if (!titleLower.includes(productSearch)) continue;
        }

        const qty = parseFloat(p.quantity || "0") || 0;
        const revenue = parseFloat(p.totalForProduct || "0") || 0;

        if (!productAgg[titleLower]) {
          productAgg[titleLower] = {
            name: title,
            totalQty: 0,
            totalRevenue: 0,
            transactions: 0,
            dailyMap: {},
          };
        }

        const agg = productAgg[titleLower];
        agg.totalQty += qty;
        agg.totalRevenue += revenue;
        agg.transactions += 1;

        if (!agg.dailyMap[saleDate]) {
          agg.dailyMap[saleDate] = { qty: 0, revenue: 0 };
        }
        agg.dailyMap[saleDate].qty += qty;
        agg.dailyMap[saleDate].revenue += revenue;
      }

      totalTransactions++;
      totalRevenue += parseFloat(sale.payment?.totalPayedAmount || "0") || 0;
    }

    // Convert aggregations to sorted arrays
    const matchedProducts = Object.values(productAgg)
      .sort((a, b) => b.totalQty - a.totalQty)
      .map((p) => ({
        name: p.name,
        totalQty: Math.round(p.totalQty * 100) / 100,
        totalRevenue: Math.round(p.totalRevenue * 100) / 100,
        transactions: p.transactions,
        dailyBreakdown: Object.entries(p.dailyMap)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, data]) => ({
            date,
            qty: Math.round(data.qty * 100) / 100,
            revenue: Math.round(data.revenue * 100) / 100,
          })),
      }));

    return JSON.stringify({
      source: "live_api",
      searchTerm: productSearch || "(all products)",
      daysSearched: days,
      salesScanned: allSales.length,
      totalTransactions,
      matchedProducts,
      matchedProductCount: matchedProducts.length,
      overallTotalQty: Math.round(matchedProducts.reduce((s, p) => s + p.totalQty, 0) * 100) / 100,
      overallTotalRevenue: Math.round(matchedProducts.reduce((s, p) => s + p.totalRevenue, 0) * 100) / 100,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return JSON.stringify({ error: `Failed to search sales: ${msg}` });
  }
}

// --- query_product_history: complete product profile with stock, pricing, vendor, sales ---
async function handleQueryProductHistory(
  input: Record<string, unknown>
): Promise<string> {
  const productName = ((input.productName as string) || "").trim();

  if (!productName) {
    return JSON.stringify({ error: "productName is required" });
  }

  try {
    // Find matching inventory items
    const items = await prisma.inventoryItem.findMany({
      where: {
        name: { contains: productName, mode: "insensitive" },
        isActive: true,
      },
      take: 5,
      include: {
        vendor: { select: { id: true, name: true } },
      },
    });

    if (items.length === 0) {
      return JSON.stringify({ error: `No products found matching "${productName}"`, items: [] });
    }

    // Get ProductSales cache data for these items
    const skus = items.map((i) => i.sku);
    const cachedSales = await prisma.productSales.findMany({
      where: { sku: { in: skus } },
    });
    const salesBySku = new Map(cachedSales.map((s) => [s.sku, s]));

    // Get daily sales from live API for last 30 days
    const token = await authenticateEmployee();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    const cutoffUnix = Math.floor(cutoffDate.getTime() / 1000);

    // Paginate through sales to find matches
    const dailyMap: Record<string, { qty: number; revenue: number }> = {};
    let offset = 0;
    let keepFetching = true;
    let recentQty = 0;
    let recentRevenue = 0;

    const searchLower = productName.toLowerCase();

    while (keepFetching && offset < 500) {
      const res = await fetch(`${COMCASH_OPENAPI_URL}/sale/list`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          OPEN_API_KEY: COMCASH_OPENAPI_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ limit: 100, offset, order: "desc" }),
      });

      if (!res.ok) break;

      const rawData = await res.json();
      const batch = Array.isArray(rawData) ? rawData : rawData.data || [];
      if (batch.length === 0) break;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const sale of batch as any[]) {
        const saleTime = sale.timeCreated || 0;
        if (saleTime < cutoffUnix) {
          keepFetching = false;
          break;
        }

        const saleDate = new Date(saleTime * 1000).toISOString().split("T")[0];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const p of (sale.products || []) as any[]) {
          const title = (p.title || "").toLowerCase();
          if (!title.includes(searchLower)) continue;

          const qty = parseFloat(p.quantity || "0") || 0;
          const revenue = parseFloat(p.totalForProduct || "0") || 0;

          recentQty += qty;
          recentRevenue += revenue;

          if (!dailyMap[saleDate]) {
            dailyMap[saleDate] = { qty: 0, revenue: 0 };
          }
          dailyMap[saleDate].qty += qty;
          dailyMap[saleDate].revenue += revenue;
        }
      }

      offset += batch.length;
      if (batch.length < 100) keepFetching = false;
    }

    const dailyBreakdown = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date,
        qty: Math.round(data.qty * 100) / 100,
        revenue: Math.round(data.revenue * 100) / 100,
      }));

    // Build product profiles
    const profiles = items.map((item) => {
      const cached = salesBySku.get(item.sku);
      return {
        name: item.name,
        sku: item.sku,
        currentStock: item.currentStock,
        reorderPoint: item.reorderPoint,
        reorderQty: item.reorderQty,
        costPrice: Number(item.costPrice),
        retailPrice: Number(item.retailPrice),
        category: item.category || "--",
        vendor: item.vendor?.name || "--",
        vendorId: item.vendorId || "--",
        // From cache (all-time)
        allTimeQtySold: cached?.totalQtySold ?? 0,
        allTimeRevenue: cached ? Number(cached.totalRevenue) : 0,
        allTimeSalesCount: cached?.salesCount ?? 0,
        lastSoldAt: cached?.lastSoldAt ? cached.lastSoldAt.toISOString().split("T")[0] : "never",
      };
    });

    return JSON.stringify({
      source: "combined",
      products: profiles,
      last30Days: {
        qtySold: Math.round(recentQty * 100) / 100,
        revenue: Math.round(recentRevenue * 100) / 100,
        dailyBreakdown,
      },
      salesScanned: offset,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return JSON.stringify({ error: `Failed to get product history: ${msg}` });
  }
}

async function handleCreatePO(
  input: Record<string, unknown>
): Promise<string> {
  const vendorId = input.vendorId as string;
  const items = input.items as Array<{
    inventoryItemId: string;
    qtyOrdered: number;
    unitCost: number;
    description: string;
  }>;
  const notes = (input.notes as string) || "";

  if (!vendorId || !items || items.length === 0) {
    return JSON.stringify({
      error: "vendorId and at least one item are required",
    });
  }

  // Use transaction to get PO number and create PO atomically
  const po = await prisma.$transaction(async (tx) => {
    const settings = await tx.appSettings.upsert({
      where: { id: "singleton" },
      update: { nextPoSequence: { increment: 1 } },
      create: { id: "singleton" },
    });

    const poNumber = `${settings.poNumberPrefix}-${new Date().getFullYear()}-${String(settings.nextPoSequence).padStart(4, "0")}`;

    const lineItems = items.map((item) => ({
      inventoryItemId: item.inventoryItemId,
      description: item.description,
      qtyOrdered: item.qtyOrdered,
      unitCost: item.unitCost,
      lineTotal: item.qtyOrdered * item.unitCost,
    }));

    const subtotal = lineItems.reduce((sum, li) => sum + li.lineTotal, 0);

    return await tx.purchaseOrder.create({
      data: {
        poNumber,
        vendorId,
        status: "DRAFT",
        subtotal,
        total: subtotal,
        orderMethod: "EMAIL",
        notes: notes || null,
        createdBy: "ai-chat",
        lineItems: { create: lineItems },
        statusHistory: {
          create: {
            toStatus: "DRAFT",
            note: "Created via AI Chat",
            triggeredBy: "ai-chat",
          },
        },
      },
      include: {
        vendor: { select: { name: true } },
        lineItems: true,
      },
    });
  });

  return JSON.stringify({
    success: true,
    poNumber: po.poNumber,
    vendor: po.vendor.name,
    status: po.status,
    total: Number(po.total),
    lineItemCount: po.lineItems.length,
    message: `Created DRAFT PO ${po.poNumber} for ${po.vendor.name} with ${po.lineItems.length} items totaling $${Number(po.total).toFixed(2)}`,
  });
}

async function handleCreateSmartPO(
  input: Record<string, unknown>
): Promise<string> {
  const vendorName = (input.vendorName as string) || "";
  const vendorId = (input.vendorId as string) || "";
  const excludeSlowMonths = (input.excludeSlowMonths as number) || 4; // Always exclude slow movers by default
  const notes = (input.notes as string) || "";
  const dryRun = (input.dryRun as boolean) ?? true;

  // Find vendor
  let vendor = null;
  if (vendorId) {
    vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  } else if (vendorName) {
    vendor = await prisma.vendor.findFirst({
      where: { name: { contains: vendorName, mode: "insensitive" } },
    });
  }
  if (!vendor) {
    return JSON.stringify({ error: `Vendor "${vendorName || vendorId}" not found` });
  }

  // Get all low-stock items for this vendor
  const allItems = await prisma.inventoryItem.findMany({
    where: { vendorId: vendor.id, isActive: true },
  });
  const lowStockItems = allItems.filter(
    (i) => i.currentStock <= i.reorderPoint
  );

  if (lowStockItems.length === 0) {
    return JSON.stringify({ message: `${vendor.name} has no low-stock items.`, count: 0 });
  }

  // Optionally exclude slow movers
  let itemsToOrder = lowStockItems;
  let excluded: string[] = [];

  if (excludeSlowMonths > 0) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - excludeSlowMonths);

    // Get sales data for these items
    const skus = lowStockItems.map((i) => i.sku);
    const salesData = await prisma.productSales.findMany({
      where: { sku: { in: skus } },
      select: { sku: true, lastSoldAt: true, totalQtySold: true },
    });
    const salesMap = new Map(salesData.map((s) => [s.sku, s]));

    itemsToOrder = lowStockItems.filter((item) => {
      const sale = salesMap.get(item.sku);
      if (!sale || !sale.lastSoldAt) {
        // No sales record — consider it a slow mover, exclude
        excluded.push(item.name);
        return false;
      }
      if (sale.lastSoldAt < cutoff) {
        // Last sold before cutoff — slow mover, exclude
        excluded.push(item.name);
        return false;
      }
      return true; // Active seller, include
    });
  }

  if (itemsToOrder.length === 0) {
    return JSON.stringify({
      message: `All ${lowStockItems.length} low-stock items from ${vendor.name} are slow movers (no sales in ${excludeSlowMonths} months). Nothing to order.`,
      excluded: excluded.length,
    });
  }

  // Fetch sales velocity data for qty calculation: Math.max(1, qtySoldLast4Months)
  const orderSkus = itemsToOrder.map((i) => i.sku).filter(Boolean);
  const fourMonthsAgoPO = new Date();
  fourMonthsAgoPO.setMonth(fourMonthsAgoPO.getMonth() - 4);
  const velocityData = await prisma.productSales.findMany({
    where: { sku: { in: orderSkus }, lastSoldAt: { gte: fourMonthsAgoPO } },
    select: { sku: true, totalQtySold: true },
  });
  const velocityMap = new Map<string, number>(velocityData.map((s) => [s.sku, s.totalQtySold]));

  if (dryRun) {
    // Order qty based on sales velocity: Math.max(1, qtySoldLast4Months)
    const subtotal = itemsToOrder.reduce(
      (sum, i) => sum + Math.max(1, velocityMap.get(i.sku) || 0) * Number(i.costPrice), 0
    );
    return JSON.stringify({
      dryRun: true,
      vendor: vendor.name,
      totalLowStock: lowStockItems.length,
      excludedSlowMovers: excluded.length,
      itemsToOrder: itemsToOrder.length,
      subtotal: Math.round(subtotal * 100) / 100,
      sampleItems: itemsToOrder.slice(0, 15).map((i) => ({
        name: i.name,
        stock: i.currentStock,
        orderQty: Math.max(1, velocityMap.get(i.sku) || 0),
        cost: Number(i.costPrice),
      })),
      excludedSample: excluded.slice(0, 10),
      message: `Ready to create PO for ${vendor.name}: ${itemsToOrder.length} items, ~$${subtotal.toFixed(2)}. ${excluded.length} slow movers excluded. Reply YES to create.`,
    });
  }

  // Create the PO
  const po = await prisma.$transaction(async (tx) => {
    const settings = await tx.appSettings.upsert({
      where: { id: "singleton" },
      update: { nextPoSequence: { increment: 1 } },
      create: { id: "singleton" },
    });

    const poNumber = `${settings.poNumberPrefix}-${new Date().getFullYear()}-${String(settings.nextPoSequence).padStart(4, "0")}`;

    // Order qty based on sales velocity: Math.max(1, qtySoldLast4Months)
    const lineItems = itemsToOrder.map((item) => {
      const qtyOrdered = Math.max(1, velocityMap.get(item.sku) || 0);
      return {
        inventoryItemId: item.id,
        vendorSku: item.vendorSku || null,
        description: item.name,
        qtyOrdered,
        unitCost: Number(item.costPrice),
        lineTotal: qtyOrdered * Number(item.costPrice),
      };
    });

    const subtotal = lineItems.reduce((sum, li) => sum + li.lineTotal, 0);

    return await tx.purchaseOrder.create({
      data: {
        poNumber,
        vendorId: vendor!.id,
        status: "DRAFT",
        subtotal,
        total: subtotal,
        orderMethod: "EMAIL",
        notes: notes || `Smart PO: ${excluded.length} slow movers excluded`,
        createdBy: "ai-chat",
        lineItems: { create: lineItems },
        statusHistory: {
          create: {
            toStatus: "DRAFT",
            note: `Created via AI Chat: ${itemsToOrder.length} items, ${excluded.length} slow movers excluded`,
            triggeredBy: "ai-chat",
          },
        },
      },
      include: { vendor: { select: { name: true } }, lineItems: true },
    });
  });

  return JSON.stringify({
    success: true,
    poNumber: po.poNumber,
    vendor: po.vendor.name,
    items: po.lineItems.length,
    total: Number(po.total),
    excludedSlowMovers: excluded.length,
    message: `Created DRAFT PO ${po.poNumber} for ${po.vendor.name}: ${po.lineItems.length} items, $${Number(po.total).toFixed(2)}. ${excluded.length} slow movers excluded.`,
  });
}

async function handleAutoGeneratePOs(input: Record<string, unknown> = {}): Promise<string> {
  // Optional vendor filtering by IDs or names
  const vendorIds = (input.vendorIds as string[]) || [];
  const vendorNames = (input.vendorNames as string[]) || [];

  // If vendorNames provided, look up their IDs
  let resolvedVendorIds: string[] = [...vendorIds];
  if (vendorNames.length > 0) {
    const matchedVendors = await prisma.vendor.findMany({
      where: {
        OR: vendorNames.map((name) => ({
          name: { contains: name, mode: "insensitive" as const },
        })),
      },
      select: { id: true },
    });
    resolvedVendorIds.push(...matchedVendors.map((v) => v.id));
  }

  // Build query filter
  const itemWhere: any = { isActive: true, vendorId: { not: null } };
  if (resolvedVendorIds.length > 0) {
    itemWhere.vendorId = { in: resolvedVendorIds };
  }

  const allItems = await prisma.inventoryItem.findMany({
    where: itemWhere,
    include: { vendor: true },
  });

  const itemsNeedingReorder = allItems.filter(
    (item) => item.currentStock <= item.reorderPoint
  );

  if (itemsNeedingReorder.length === 0) {
    return JSON.stringify({
      message: "No items below reorder point",
      created: 0,
    });
  }

  // Group by vendor
  const byVendor = new Map<
    string,
    typeof itemsNeedingReorder
  >();
  for (const item of itemsNeedingReorder) {
    if (!item.vendorId) continue;
    const existing = byVendor.get(item.vendorId) || [];
    existing.push(item);
    byVendor.set(item.vendorId, existing);
  }

  const createdPOs = await prisma.$transaction(async (tx) => {
    const settings = await tx.appSettings.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton" },
    });

    let nextSeq = settings.nextPoSequence;
    const year = new Date().getFullYear();
    const poNumbers: string[] = [];

    // Check for existing DRAFT POs to prevent duplicates
    const existingDraftVendorIds = new Set(
      (
        await tx.purchaseOrder.findMany({
          where: {
            status: "DRAFT",
            vendorId: { in: Array.from(byVendor.keys()) },
          },
          select: { vendorId: true },
        })
      ).map((po) => po.vendorId)
    );

    // Fetch sales velocity data for qty calculation
    const allReorderSkus = itemsNeedingReorder.map((i) => i.sku).filter(Boolean);
    const fourMonthsAgoAuto = new Date();
    fourMonthsAgoAuto.setMonth(fourMonthsAgoAuto.getMonth() - 4);
    const autoSalesData = await tx.productSales.findMany({
      where: { sku: { in: allReorderSkus }, lastSoldAt: { gte: fourMonthsAgoAuto } },
      select: { sku: true, totalQtySold: true },
    });
    const autoSalesMap = new Map<string, number>(autoSalesData.map((s) => [s.sku, s.totalQtySold]));

    for (const [vendorId, items] of byVendor) {
      if (existingDraftVendorIds.has(vendorId)) continue;

      // Exclude slow movers (0 sales in 4 months)
      const activeItems = items.filter((item) => (autoSalesMap.get(item.sku) || 0) > 0);
      if (activeItems.length === 0) continue;

      const poNumber = `${settings.poNumberPrefix}-${year}-${String(nextSeq).padStart(4, "0")}`;
      nextSeq++;

      // Order qty based on sales velocity: Math.max(1, qtySoldLast4Months)
      const lineItems = activeItems.map((item) => {
        const qtyOrdered = Math.max(1, autoSalesMap.get(item.sku) || 0);
        return {
          inventoryItemId: item.id,
          vendorSku: item.vendorSku || null,
          description: item.name,
          qtyOrdered,
          unitCost: Number(item.costPrice),
          lineTotal: qtyOrdered * Number(item.costPrice),
        };
      });

      const subtotal = lineItems.reduce(
        (sum, li) => sum + li.lineTotal,
        0
      );

      await tx.purchaseOrder.create({
        data: {
          poNumber,
          vendorId,
          status: "DRAFT",
          subtotal,
          total: subtotal,
          orderMethod: activeItems[0].vendor?.orderMethod || "EMAIL",
          createdBy: "ai-chat",
          lineItems: { create: lineItems },
          statusHistory: {
            create: {
              toStatus: "DRAFT",
              note: `Auto-generated via AI Chat: ${items.length} items below reorder point`,
              triggeredBy: "ai-chat",
            },
          },
        },
      });

      poNumbers.push(poNumber);
    }

    await tx.appSettings.update({
      where: { id: "singleton" },
      data: { nextPoSequence: nextSeq },
    });

    return poNumbers;
  });

  return JSON.stringify({
    message: `Created ${createdPOs.length} purchase orders for ${itemsNeedingReorder.length} low-stock items`,
    created: createdPOs.length,
    poNumbers: createdPOs,
    itemCount: itemsNeedingReorder.length,
    vendorsSkipped: byVendor.size - createdPOs.length,
  });
}

async function handleDashboardStats(): Promise<string> {
  // Fetch all items for in-memory stock analysis (reorderPoint varies per item)
  const allItems = await prisma.inventoryItem.findMany({
    where: { isActive: true },
    select: { currentStock: true, reorderPoint: true },
  });

  const totalProducts = allItems.length;
  const outOfStock = allItems.filter((i) => i.currentStock <= 0).length;
  const lowStock = allItems.filter(
    (i) => i.currentStock > 0 && i.currentStock <= i.reorderPoint
  ).length;

  const [activePOs, vendorCount, pendingDeliveries] =
    await Promise.all([
      prisma.purchaseOrder.count({
        where: {
          status: {
            in: [
              "DRAFT",
              "PENDING_APPROVAL",
              "APPROVED",
              "SENT",
              "CONFIRMED",
            ],
          },
        },
      }),
      prisma.vendor.count({ where: { isActive: true } }),
      prisma.purchaseOrder.count({
        where: { status: { in: ["SENT", "CONFIRMED"] } },
      }),
    ]);

  return JSON.stringify({
    totalProducts,
    lowStock,
    outOfStock,
    activePOs,
    vendorCount,
    pendingDeliveries,
  });
}

async function handleSyncVendors(): Promise<string> {
  const comcashVendors = await fetchVendors();

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const cv of comcashVendors) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vendorName = (
      (cv as any).name ||
      (cv as any).vendor_name ||
      ""
    ).trim();
    if (!vendorName || vendorName.toUpperCase() === "NONE") {
      skipped++;
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const comcashId = String((cv as any).id || (cv as any).vendor_id);

    let existing = await prisma.vendor.findUnique({
      where: { comcashVendorId: comcashId },
    });

    if (!existing) {
      existing = await prisma.vendor.findFirst({
        where: { name: { equals: vendorName, mode: "insensitive" } },
      });
    }

    if (existing) {
      await prisma.vendor.update({
        where: { id: existing.id },
        data: {
          comcashVendorId: comcashId,
          name: vendorName,
          phone: cv.phone || existing.phone,
          email: cv.email || existing.email,
        },
      });
      updated++;
    } else {
      await prisma.vendor.create({
        data: {
          comcashVendorId: comcashId,
          name: vendorName,
          phone: cv.phone || null,
          email: cv.email || null,
          isActive: true,
        },
      });
      created++;
    }
  }

  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", lastVendorSync: new Date() },
    update: { lastVendorSync: new Date() },
  });

  return JSON.stringify({
    success: true,
    synced: created + updated,
    created,
    updated,
    skipped,
    total: comcashVendors.length,
  });
}

async function handleSyncProducts(): Promise<string> {
  const products = await fetchAllProducts();

  let created = 0;
  let updated = 0;
  let skipped = 0;

  const batchSize = 50;
  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);

    await prisma.$transaction(async (tx) => {
      for (const product of batch) {
        const sku = product.skuCodes?.[0] || `COMCASH-${product.id}`;
        const name = product.title || "Unknown";
        const retailPrice = product.price ? parseFloat(product.price) : 0;
        const costPrice = product.lastCost
          ? parseFloat(product.lastCost)
          : 0;
        let onHand = 0;
        if (Array.isArray(product.onHand)) {
          onHand = product.onHand.reduce(
            (sum, wh) => sum + parseFloat(wh.quantity || "0"), 0
          );
        } else if (typeof product.onHand === "number") {
          onHand = product.onHand;
        }
        onHand = Math.round(onHand);

        if (!name || name === "Unknown") {
          skipped++;
          continue;
        }

        let vendorId: string | null = null;
        const comcashVendorId =
          product.primaryVendorId || product.vendorId;
        if (
          comcashVendorId &&
          product.primaryVendorName !== "NONE"
        ) {
          const vendor = await tx.vendor.findFirst({
            where: {
              OR: [
                { comcashVendorId: String(comcashVendorId) },
                ...(product.primaryVendorName
                  ? [
                      {
                        name: {
                          contains: product.primaryVendorName,
                          mode: "insensitive" as const,
                        },
                      },
                    ]
                  : []),
              ],
            },
            select: { id: true },
          });
          vendorId = vendor?.id || null;
        }

        const existing = await tx.inventoryItem.findUnique({
          where: { sku },
        });

        if (existing) {
          await tx.inventoryItem.update({
            where: { sku },
            data: {
              name,
              comcashItemId: String(product.id),
              retailPrice,
              costPrice: costPrice > 0 ? costPrice : existing.costPrice,
              currentStock: onHand,
              vendorId: vendorId || existing.vendorId,
              isActive: product.statusId === 1,
              lastSyncedAt: new Date(),
            },
          });
          updated++;
        } else {
          await tx.inventoryItem.create({
            data: {
              sku,
              name,
              comcashItemId: String(product.id),
              retailPrice,
              costPrice,
              currentStock: onHand,
              reorderPoint: 5,
              reorderQty: 10,
              vendorId,
              isActive: product.statusId === 1,
              lastSyncedAt: new Date(),
            },
          });
          created++;
        }
      }
    });
  }

  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: { lastProductSync: new Date() },
    create: { id: "singleton", lastProductSync: new Date() },
  });

  return JSON.stringify({
    success: true,
    message: `Synced ${products.length} products (${created} new, ${updated} updated, ${skipped} skipped)`,
    total: products.length,
    created,
    updated,
    skipped,
  });
}

async function handleQuerySlowMovers(
  input: Record<string, unknown>
): Promise<string> {
  const months = (input.months as number) || 4;
  const vendorName = (input.vendorName as string) || "";
  const vendorId = (input.vendorId as string) || "";
  const limit = (input.limit as number) || 20;

  try {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - months);

    // Resolve vendor filter
    let filterVendorId = vendorId;
    if (vendorName && !filterVendorId) {
      const vendor = await prisma.vendor.findFirst({
        where: { name: { contains: vendorName, mode: "insensitive" } },
        select: { id: true },
      });
      if (vendor) filterVendorId = vendor.id;
    }

    // Build inventory filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invWhere: any = { isActive: true };
    if (filterVendorId) invWhere.vendorId = filterVendorId;

    // Check if ProductSales has any data — if not, we can't determine slow movers
    const totalSalesRecords = await prisma.productSales.count();
    if (totalSalesRecords === 0) {
      return JSON.stringify({
        source: "product_sales_cache",
        items: [],
        count: 0,
        message: "No sales data available yet. Use 'Sync Sales' to import sales data from Comcash POS first. Without sales data, all items would appear as slow movers.",
      });
    }

    // Get all active inventory items
    const allItems = await prisma.inventoryItem.findMany({
      where: invWhere,
      select: {
        id: true,
        sku: true,
        name: true,
        currentStock: true,
        costPrice: true,
        retailPrice: true,
        category: true,
        vendor: { select: { name: true } },
      },
    });

    // Get ProductSales for items that HAVE sold
    const salesData = await prisma.productSales.findMany({
      where: {
        sku: { in: allItems.map((i) => i.sku) },
      },
      select: {
        sku: true,
        lastSoldAt: true,
        totalQtySold: true,
        totalRevenue: true,
      },
    });

    const salesBySku = new Map(salesData.map((s) => [s.sku, s]));

    // Find slow movers: never sold OR last sold before cutoff
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const slowMovers: any[] = [];

    for (const item of allItems) {
      const sale = salesBySku.get(item.sku);
      const lastSold = sale?.lastSoldAt || null;
      const isSlowMover = !lastSold || lastSold < cutoffDate;

      if (isSlowMover) {
        slowMovers.push({
          name: item.name,
          sku: item.sku,
          stock: item.currentStock,
          cost: Number(item.costPrice),
          price: Number(item.retailPrice),
          lastSold: lastSold ? lastSold.toISOString().split("T")[0] : "never",
          qtySold: sale?.totalQtySold || 0,
          revenue: sale ? Number(sale.totalRevenue) : 0,
          vendor: item.vendor?.name || "--",
          category: item.category || "--",
        });
      }
    }

    // Sort: never-sold first, then by oldest lastSold
    slowMovers.sort((a, b) => {
      if (a.lastSold === "never" && b.lastSold !== "never") return -1;
      if (a.lastSold !== "never" && b.lastSold === "never") return 1;
      return a.lastSold.localeCompare(b.lastSold);
    });

    const result = slowMovers.slice(0, limit);

    return JSON.stringify({
      source: "product_sales_cache",
      items: result,
      count: result.length,
      totalSlowMovers: slowMovers.length,
      cutoffDate: cutoffDate.toISOString().split("T")[0],
      message: `Found ${slowMovers.length} items with no sales since ${cutoffDate.toISOString().split("T")[0]}${vendorName ? ` from ${vendorName}` : ""}`,
    });
  } catch (err) {
    return JSON.stringify({
      error: `Failed to query slow movers: ${err instanceof Error ? err.message : "Unknown error"}`,
    });
  }
}

// --- query_top_sellers: aggregated top sellers — from cache or live API if days specified ---
async function handleQueryTopSellers(
  input: Record<string, unknown>
): Promise<string> {
  const sortBy = (input.sortBy as string) || "qty";
  const vendorName = (input.vendorName as string) || "";
  const vendorId = (input.vendorId as string) || "";
  const category = (input.category as string) || "";
  const days = (input.days as number) || 0;
  const limit = (input.limit as number) || 20;

  try {
    // --- If days is specified, paginate through live API and aggregate ---
    if (days > 0) {
      const token = await authenticateEmployee();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffUnix = Math.floor(cutoffDate.getTime() / 1000);

      const productAgg: Record<string, { name: string; totalQty: number; totalRevenue: number; transactions: number }> = {};
      let offset = 0;
      let keepFetching = true;

      while (keepFetching && offset < 500) {
        const res = await fetch(`${COMCASH_OPENAPI_URL}/sale/list`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            OPEN_API_KEY: COMCASH_OPENAPI_KEY,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ limit: 100, offset, order: "desc" }),
        });

        if (!res.ok) break;
        const rawData = await res.json();
        const batch = Array.isArray(rawData) ? rawData : rawData.data || [];
        if (batch.length === 0) break;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const sale of batch as any[]) {
          if ((sale.timeCreated || 0) < cutoffUnix) {
            keepFetching = false;
            break;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const p of (sale.products || []) as any[]) {
            const title = (p.title || "").trim();
            const key = title.toLowerCase();
            const qty = parseFloat(p.quantity || "0") || 0;
            const revenue = parseFloat(p.totalForProduct || "0") || 0;

            if (!productAgg[key]) {
              productAgg[key] = { name: title, totalQty: 0, totalRevenue: 0, transactions: 0 };
            }
            productAgg[key].totalQty += qty;
            productAgg[key].totalRevenue += revenue;
            productAgg[key].transactions += 1;
          }
        }

        offset += batch.length;
        if (batch.length < 100) keepFetching = false;
      }

      // Filter by category/vendor if requested (need to cross-ref inventory)
      let results = Object.values(productAgg);

      if (vendorName || vendorId || category) {
        // Get inventory items for filtering
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invWhere: any = { isActive: true };
        let filterVendorId = vendorId;
        if (vendorName && !filterVendorId) {
          const vendor = await prisma.vendor.findFirst({
            where: { name: { contains: vendorName, mode: "insensitive" } },
            select: { id: true },
          });
          if (vendor) filterVendorId = vendor.id;
        }
        if (filterVendorId) invWhere.vendorId = filterVendorId;
        if (category) invWhere.category = { contains: category, mode: "insensitive" };

        const invItems = await prisma.inventoryItem.findMany({
          where: invWhere,
          select: { name: true },
        });
        const allowedNames = new Set(invItems.map((i) => i.name.toLowerCase()));
        results = results.filter((p) => allowedNames.has(p.name.toLowerCase()));
      }

      // Sort and limit
      results.sort((a, b) => sortBy === "revenue" ? b.totalRevenue - a.totalRevenue : b.totalQty - a.totalQty);
      const topItems = results.slice(0, limit).map((p) => ({
        name: p.name,
        qtySold: Math.round(p.totalQty * 100) / 100,
        revenue: Math.round(p.totalRevenue * 100) / 100,
        transactions: p.transactions,
      }));

      return JSON.stringify({
        source: "live_api",
        period: `last ${days} days`,
        salesScanned: offset,
        items: topItems,
        count: topItems.length,
        sortedBy: sortBy === "revenue" ? "revenue" : "qty",
      });
    }

    // --- No days specified: use all-time ProductSales cache ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    // Filter by vendor (through inventory item relation)
    let filterVendorId = vendorId;
    if (vendorName && !filterVendorId) {
      const vendor = await prisma.vendor.findFirst({
        where: { name: { contains: vendorName, mode: "insensitive" } },
        select: { id: true },
      });
      if (vendor) filterVendorId = vendor.id;
    }

    if (filterVendorId || category) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invFilter: any = {};
      if (filterVendorId) invFilter.vendorId = filterVendorId;
      if (category) invFilter.category = { contains: category, mode: "insensitive" };
      where.inventoryItem = invFilter;
    }

    // Check if ProductSales table has any data
    const totalSalesRecords = await prisma.productSales.count();
    if (totalSalesRecords === 0) {
      return JSON.stringify({
        source: "product_sales_cache",
        items: [],
        count: 0,
        message: "No sales data available yet. Use 'Sync Sales' to import sales data from Comcash POS first.",
      });
    }

    const topSellers = await prisma.productSales.findMany({
      where,
      orderBy: sortBy === "revenue" ? { totalRevenue: "desc" } : { totalQtySold: "desc" },
      take: limit,
      include: {
        inventoryItem: {
          select: {
            currentStock: true,
            reorderPoint: true,
            costPrice: true,
            retailPrice: true,
            category: true,
            vendor: { select: { name: true } },
          },
        },
      },
    });

    const result = topSellers.map((ps) => ({
      name: ps.productName,
      sku: ps.sku,
      qtySold: ps.totalQtySold,
      revenue: Number(ps.totalRevenue),
      lastSold: ps.lastSoldAt ? ps.lastSoldAt.toISOString().split("T")[0] : "never",
      transactions: ps.salesCount,
      currentStock: ps.inventoryItem?.currentStock ?? "--",
      reorderPt: ps.inventoryItem?.reorderPoint ?? "--",
      vendor: ps.inventoryItem?.vendor?.name || "--",
      category: ps.inventoryItem?.category || "--",
    }));

    return JSON.stringify({
      source: "product_sales_cache",
      items: result,
      count: result.length,
      sortedBy: sortBy === "revenue" ? "totalRevenue" : "totalQtySold",
    });
  } catch (err) {
    return JSON.stringify({
      error: `Failed to query top sellers: ${err instanceof Error ? err.message : "Unknown error"}`,
    });
  }
}

async function handleRefreshStock(): Promise<string> {
  const result = await refreshStock();
  return JSON.stringify({
    success: result.success,
    itemsUpdated: result.itemsUpdated,
    itemsSkipped: result.itemsSkipped,
    totalFetched: result.totalFetched,
    durationMs: result.durationMs,
    message: result.success
      ? `Stock refreshed from POS: ${result.itemsUpdated} items updated, ${result.itemsSkipped} unchanged (${result.durationMs}ms)`
      : `Stock refresh failed: ${result.error}`,
  });
}

async function handleSyncInventoryToComcash(
  input: Record<string, unknown>
): Promise<string> {
  const inventoryItemIds = (input.inventoryItemIds as string[]) || [];

  try {
    // IMPORTANT: Comcash warehouse/changeQuantity expects a DELTA, NOT absolute stock.
    // For manual sync, we must fetch current Comcash stock and compute the difference.

    // Get items to sync — either specific IDs or all with comcashItemId
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { comcashItemId: { not: null } };
    if (inventoryItemIds.length > 0) {
      where.id = { in: inventoryItemIds };
    }

    const items = await prisma.inventoryItem.findMany({
      where,
      select: {
        id: true,
        name: true,
        sku: true,
        comcashItemId: true,
        comcashMeasureUnitId: true,
        currentStock: true,
      },
    });

    if (items.length === 0) {
      return JSON.stringify({
        message: "No items with Comcash IDs found to sync",
        synced: 0,
      });
    }

    // Step 1: Fetch current Comcash stock to compute deltas
    // Use fetchProducts with includeWarehouse=true to get onHand data
    const { fetchProducts } = await import("@/lib/comcash");
    const comcashStockMap = new Map<string, number>(); // comcashItemId (string) -> current Comcash stock

    // Paginate through all Comcash products to build a stock lookup
    const pageLimit = 100;
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const { products, total } = await fetchProducts(offset, pageLimit, true);
      if (products.length === 0) break;
      for (const p of products) {
        let stock = 0;
        if (Array.isArray(p.onHand)) {
          stock = Math.round(p.onHand.reduce((sum, wh) => sum + parseFloat(wh.quantity || "0"), 0));
        } else if (typeof p.onHand === "number") {
          stock = Math.round(p.onHand);
        }
        comcashStockMap.set(String(p.id), stock);
      }
      offset += products.length;
      if (products.length < pageLimit) hasMore = false;
      else if (total > 0 && offset >= total) hasMore = false;
    }

    // Step 2: Compute deltas (appStock - comcashStock) and only push non-zero deltas
    const token = await authenticateEmployee();
    let synced = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Build delta list
    const deltaBatch: Array<{ productId: number; warehouseId: number; measureUnitId: number; quantity: number; name: string }> = [];
    for (const item of items) {
      const comcashId = item.comcashItemId!;
      const comcashStock = comcashStockMap.get(comcashId) ?? 0;
      const delta = item.currentStock - comcashStock;
      if (delta === 0) {
        skipped++;
        continue;
      }
      deltaBatch.push({
        productId: parseInt(comcashId, 10),
        warehouseId: 2,
        measureUnitId: item.comcashMeasureUnitId || 1, // Use product-specific measureUnitId from DB
        quantity: delta, // Positive = add, Negative = subtract
        name: item.name,
      });
    }

    if (deltaBatch.length === 0) {
      return JSON.stringify({
        success: true,
        synced: 0,
        skipped: items.length,
        total: items.length,
        message: `All ${items.length} items already match Comcash stock — nothing to push`,
      });
    }

    // Batch items in groups of 25
    const batchSize = 25;
    for (let i = 0; i < deltaBatch.length; i += batchSize) {
      const batch = deltaBatch.slice(i, i + batchSize);

      const products = batch.map(({ productId, warehouseId, measureUnitId, quantity }) => ({
        productId,
        warehouseId,
        measureUnitId,
        quantity,
      }));

      try {
        const res = await fetch(
          `${COMCASH_OPENAPI_URL}/employee/warehouse/changeQuantity`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              OPEN_API_KEY: COMCASH_OPENAPI_KEY,
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              note: `Delta sync from procurement app ${new Date().toISOString()}`,
              products,
            }),
          }
        );

        if (res.ok) {
          synced += batch.length;
        } else {
          const errText = await res.text();
          errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${errText.slice(0, 100)}`);
        }
      } catch (err) {
        errors.push(
          `Batch ${Math.floor(i / batchSize) + 1}: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    }

    return JSON.stringify({
      success: synced > 0,
      synced,
      skipped,
      total: items.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Synced ${synced} of ${deltaBatch.length} items with stock differences to Comcash POS (${skipped} already matched)${errors.length > 0 ? ` (${errors.length} batch errors)` : ""}`,
    });
  } catch (err) {
    return JSON.stringify({
      error: `Failed to sync to Comcash: ${err instanceof Error ? err.message : "Unknown error"}`,
    });
  }
}

async function handleUpdateInventoryItems(
  input: Record<string, unknown>
): Promise<string> {
  const updates = input.updates as Array<{
    id: string;
    category?: string;
    currentStock?: number;
    reorderPoint?: number;
    reorderQty?: number;
    costPrice?: number;
    retailPrice?: number;
    vendorId?: string;
    isActive?: boolean;
  }>;

  if (!updates || updates.length === 0) {
    return JSON.stringify({ error: "No updates provided" });
  }

  if (updates.length > 200) {
    return JSON.stringify({
      error: "Too many individual updates. Use bulk_update_inventory for large batches.",
    });
  }

  let updated = 0;
  const errors: string[] = [];

  for (const update of updates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = {};
      if (update.category !== undefined) data.category = update.category;
      if (update.currentStock !== undefined) data.currentStock = update.currentStock;
      if (update.reorderPoint !== undefined) data.reorderPoint = update.reorderPoint;
      if (update.reorderQty !== undefined) data.reorderQty = update.reorderQty;
      if (update.costPrice !== undefined) data.costPrice = update.costPrice;
      if (update.retailPrice !== undefined) data.retailPrice = update.retailPrice;
      if (update.vendorId !== undefined) data.vendorId = update.vendorId;
      if (update.isActive !== undefined) data.isActive = update.isActive;

      if (Object.keys(data).length === 0) continue;

      await prisma.inventoryItem.update({
        where: { id: update.id },
        data,
      });
      updated++;
    } catch (err) {
      errors.push(`Item ${update.id}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  return JSON.stringify({
    success: true,
    updated,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
    message: `Updated ${updated} of ${updates.length} items${errors.length > 0 ? ` (${errors.length} errors)` : ""}`,
  });
}

async function handleBulkUpdateInventory(
  input: Record<string, unknown>
): Promise<string> {
  const filter = (input.filter || {}) as {
    nameContains?: string;
    skuContains?: string;
    category?: string;
    categoryEmpty?: boolean;
    vendorId?: string;
    vendorName?: string;
    vendorEmpty?: boolean;
    stockBelow?: number;
    stockAbove?: number;
    isActive?: boolean;
  };
  const setFields = (input.set || {}) as {
    category?: string;
    currentStock?: number;
    reorderPoint?: number;
    reorderQty?: number;
    costPrice?: number;
    retailPrice?: number;
    vendorId?: string;
    isActive?: boolean;
  };
  const dryRun = (input.dryRun as boolean) ?? true;

  // Build Prisma where clause from filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  // Name/SKU search
  if (filter.nameContains) {
    where.name = { contains: filter.nameContains, mode: "insensitive" };
  }
  if (filter.skuContains) {
    where.sku = { contains: filter.skuContains, mode: "insensitive" };
  }

  // Vendor name resolution
  if (filter.vendorName && !filter.vendorId && !filter.vendorEmpty) {
    const vendor = await prisma.vendor.findFirst({
      where: { name: { contains: filter.vendorName, mode: "insensitive" } },
      select: { id: true },
    });
    if (vendor) {
      where.vendorId = vendor.id;
    }
  }

  // categoryEmpty and category are mutually exclusive — categoryEmpty takes precedence
  if (filter.categoryEmpty) {
    where.OR = [
      { category: null },
      { category: "" },
      { category: "Uncategorized" },
    ];
  } else if (filter.category) {
    where.category = { contains: filter.category, mode: "insensitive" };
  }
  // vendorEmpty and vendorId are mutually exclusive — vendorEmpty takes precedence
  if (filter.vendorEmpty) {
    where.vendorId = null;
  } else if (filter.vendorId) {
    where.vendorId = filter.vendorId;
  }
  if (filter.stockBelow !== undefined) {
    where.currentStock = { ...(where.currentStock || {}), lt: filter.stockBelow };
  }
  if (filter.stockAbove !== undefined) {
    where.currentStock = { ...(where.currentStock || {}), gt: filter.stockAbove };
  }
  if (filter.isActive !== undefined) {
    where.isActive = filter.isActive;
  }

  // Count matching items
  const matchCount = await prisma.inventoryItem.count({ where });

  if (dryRun) {
    // Get a sample of matching items for context
    const sample = await prisma.inventoryItem.findMany({
      where,
      take: 10,
      select: { id: true, name: true, sku: true, category: true, currentStock: true },
    });

    return JSON.stringify({
      dryRun: true,
      matchCount,
      sample: sample.map((i) => ({
        name: i.name,
        sku: i.sku,
        category: i.category || "(none)",
        stock: i.currentStock,
      })),
      message: `${matchCount} items match the filter. Send again with dryRun: false to apply changes.`,
    });
  }

  // Safety check: don't update more than 5000 items at once
  if (matchCount > 5000) {
    return JSON.stringify({
      error: `Too many items (${matchCount}). Please use a more specific filter to update fewer than 5000 items at a time.`,
    });
  }

  // Build update data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};
  if (setFields.category !== undefined) data.category = setFields.category;
  if (setFields.currentStock !== undefined) data.currentStock = setFields.currentStock;
  if (setFields.reorderPoint !== undefined) data.reorderPoint = setFields.reorderPoint;
  if (setFields.reorderQty !== undefined) data.reorderQty = setFields.reorderQty;
  if (setFields.costPrice !== undefined) data.costPrice = setFields.costPrice;
  if (setFields.retailPrice !== undefined) data.retailPrice = setFields.retailPrice;
  if (setFields.vendorId !== undefined) data.vendorId = setFields.vendorId;
  if (setFields.isActive !== undefined) data.isActive = setFields.isActive;

  if (Object.keys(data).length === 0) {
    return JSON.stringify({ error: "No fields to update in 'set'" });
  }

  const result = await prisma.inventoryItem.updateMany({ where, data });

  return JSON.stringify({
    success: true,
    updated: result.count,
    message: `Updated ${result.count} items`,
  });
}

// --- Auto-Tune Reorder Points handler ---
async function handleAutoTuneReorderPoints(
  input: Record<string, unknown>
): Promise<string> {
  // Match API route defaults: 90 days, 1.25 safety factor
  const safetyFactor = (input.safetyFactor as number) || 1.25;
  const minReorderPoint = (input.minReorderPoint as number) || 2;
  const periodDays = (input.periodDays as number) || 90;
  const dryRun = input.dryRun !== false; // default true

  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - periodDays);

  // Get active inventory items with vendor lead times
  const items = await prisma.inventoryItem.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      sku: true,
      reorderPoint: true,
      vendor: { select: { leadTimeDays: true, name: true } },
    },
  });

  // Get sales data for the period
  const salesData = await prisma.productSales.findMany({
    where: { periodStart: { gte: periodStart }, totalQtySold: { gt: 0 } },
    select: { sku: true, totalQtySold: true, inventoryItemId: true },
  });

  // Aggregate sales by SKU
  const salesBySku: Record<string, number> = {};
  const salesByItemId: Record<string, number> = {};
  for (const sale of salesData) {
    salesBySku[sale.sku] = (salesBySku[sale.sku] || 0) + sale.totalQtySold;
    if (sale.inventoryItemId) {
      salesByItemId[sale.inventoryItemId] = (salesByItemId[sale.inventoryItemId] || 0) + sale.totalQtySold;
    }
  }

  // Calculate suggestions
  const changes: Array<{
    id: string; name: string; current: number; suggested: number;
    avgDaily: number; leadTime: number; vendor: string;
  }> = [];

  for (const item of items) {
    const totalSold = salesBySku[item.sku] || salesByItemId[item.id] || 0;
    const avgDaily = totalSold / periodDays;
    const leadTime = item.vendor?.leadTimeDays || 7;
    let suggested = Math.ceil(avgDaily * leadTime * safetyFactor);
    if (suggested < minReorderPoint) suggested = minReorderPoint;

    if (suggested !== item.reorderPoint) {
      changes.push({
        id: item.id,
        name: item.name,
        current: item.reorderPoint,
        suggested,
        avgDaily: Math.round(avgDaily * 100) / 100,
        leadTime,
        vendor: item.vendor?.name || "Unknown",
      });
    }
  }

  changes.sort((a, b) => Math.abs(b.suggested - b.current) - Math.abs(a.suggested - a.current));

  if (!dryRun && changes.length > 0) {
    const updates = changes.map((c) =>
      prisma.inventoryItem.update({
        where: { id: c.id },
        data: { reorderPoint: c.suggested },
      })
    );
    await prisma.$transaction(updates);
  }

  return JSON.stringify({
    dryRun,
    analyzed: items.length,
    itemsWithChanges: changes.length,
    applied: !dryRun ? changes.length : 0,
    safetyFactor,
    periodDays,
    minReorderPoint,
    changes: changes.slice(0, 30),
    message: dryRun
      ? `${changes.length} items would change. Send again with dryRun: false to apply.`
      : `Applied ${changes.length} reorder point changes.`,
  });
}

// --- Main POST handler ---

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }

    // Convert messages to Claude format — only keep last 6 messages to save tokens
    const recentMessages = messages.slice(-6);
    const claudeMessages: Anthropic.MessageParam[] = recentMessages.map(
      (m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })
    );
    // Ensure first message is from user (Claude requires this)
    if (claudeMessages.length > 0 && claudeMessages[0].role !== "user") {
      claudeMessages.shift();
    }

    // Token usage tracking across all loop iterations
    // Haiku 4.5 pricing: $1.00/M input, $5.00/M output
    const COST_PER_INPUT_TOKEN = 1.00 / 1_000_000;
    const COST_PER_OUTPUT_TOKEN = 5.00 / 1_000_000;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Tool use loop: keep calling Claude until we get a final text response
    let loopCount = 0;
    const maxLoops = 5;
    let currentMessages = [...claudeMessages];

    while (loopCount < maxLoops) {
      loopCount++;

      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools,
        messages: currentMessages,
      });

      // Accumulate token usage
      if (response.usage) {
        totalInputTokens += response.usage.input_tokens;
        totalOutputTokens += response.usage.output_tokens;
      }

      // Check if response contains tool_use blocks
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) {
        // No tool calls -- extract text and return
        const textContent = response.content
          .filter(
            (block): block is Anthropic.TextBlock =>
              block.type === "text"
          )
          .map((block) => block.text)
          .join("\n");

        const totalTokens = totalInputTokens + totalOutputTokens;
        const cost = totalInputTokens * COST_PER_INPUT_TOKEN + totalOutputTokens * COST_PER_OUTPUT_TOKEN;

        return NextResponse.json({
          content: textContent,
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            totalTokens,
            cost: Math.round(cost * 1_000_000) / 1_000_000, // round to 6 decimal places
          },
        });
      }

      // Execute tool calls and build tool result messages
      // Add the assistant response (with tool_use) to messages
      currentMessages.push({
        role: "assistant",
        content: response.content,
      });

      // Execute each tool call and add results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolBlock of toolUseBlocks) {
        const result = await executeToolCall(
          toolBlock.name,
          toolBlock.input as Record<string, unknown>
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolBlock.id,
          content: result,
        });
      }

      currentMessages.push({
        role: "user",
        content: toolResults,
      });
    }

    // If we hit max loops, return whatever we have
    const totalTokens = totalInputTokens + totalOutputTokens;
    const cost = totalInputTokens * COST_PER_INPUT_TOKEN + totalOutputTokens * COST_PER_OUTPUT_TOKEN;

    return NextResponse.json({
      content:
        "I apologize, but I was unable to complete the request within the allowed number of steps. Please try simplifying your question.",
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens,
        cost: Math.round(cost * 1_000_000) / 1_000_000,
      },
    });
  } catch (error) {
    console.error("[Chat API Error]:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
