import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";
import {
  authenticateEmployee,
  fetchVendors,
  fetchAllProducts,
} from "@/lib/comcash";

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
Categories: Herbs & Teas, Vitamins & Supplements, Essential Oils, Hair & Beauty, Body Care, Food & Beverages, Incense & Spiritual, Accessories.`;

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
        vendorId: { type: "string" },
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
    name: "query_sales",
    description:
      "Fetch sales data from the Comcash POS system. Can filter by time range. Returns sale transactions with products, customers, and payment info.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Max number of sales to return (default 50)",
        },
        timeFrom: {
          type: "string",
          description:
            "Start of time range as ISO date string (e.g. 2024-01-01)",
        },
        timeTo: {
          type: "string",
          description:
            "End of time range as ISO date string (e.g. 2024-12-31)",
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
      "Automatically generate DRAFT purchase orders for all items that are below their reorder point. Groups items by vendor. Skips vendors that already have a DRAFT PO.",
    input_schema: {
      type: "object" as const,
      properties: {},
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
            category: { type: "string", description: "Match items with this category (case-insensitive contains)" },
            categoryEmpty: { type: "boolean", description: "If true, match items with empty/null category" },
            vendorId: { type: "string", description: "Match items from this vendor" },
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
];

// --- Tool execution handlers ---

async function executeToolCall(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  try {
    switch (name) {
      case "query_inventory":
        return await handleQueryInventory(input);
      case "query_purchase_orders":
        return await handleQueryPurchaseOrders(input);
      case "query_vendors":
        return await handleQueryVendors(input);
      case "query_sales":
        return await handleQuerySales(input);
      case "create_purchase_order":
        return await handleCreatePO(input);
      case "auto_generate_pos":
        return await handleAutoGeneratePOs();
      case "get_dashboard_stats":
        return await handleDashboardStats();
      case "sync_comcash_vendors":
        return await handleSyncVendors();
      case "sync_comcash_products":
        return await handleSyncProducts();
      case "update_inventory_items":
        return await handleUpdateInventoryItems(input);
      case "bulk_update_inventory":
        return await handleBulkUpdateInventory(input);
      case "sync_inventory_to_comcash":
        return await handleSyncInventoryToComcash(input);
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
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
  const vendorId = (input.vendorId as string) || "";
  const limit = (input.limit as number) || 20;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { isActive: true };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
    ];
  }

  if (vendorId) {
    where.vendorId = vendorId;
  }

  // Fetch all for in-memory filtering when needed
  const needsInMemoryFilter =
    status === "low_stock" || status === "out_of_stock";

  if (status === "out_of_stock" && !needsInMemoryFilter) {
    where.currentStock = { lte: 0 };
  }

  const items = await prisma.inventoryItem.findMany({
    where,
    take: needsInMemoryFilter ? 500 : limit,
    orderBy: { name: "asc" },
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
  const limit = (input.limit as number) || 20;
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
  const limit = (input.limit as number) || 20;

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

async function handleQuerySales(
  input: Record<string, unknown>
): Promise<string> {
  const limit = (input.limit as number) || 20;
  const timeFrom = (input.timeFrom as string) || "";
  const timeTo = (input.timeTo as string) || "";

  try {
    // Authenticate with Comcash Employee API
    const token = await authenticateEmployee();

    // Build request body for sale/list
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = {
      offset: 0,
      limit,
    };

    // The sale/list endpoint may accept date filters
    if (timeFrom) body.timeFrom = timeFrom;
    if (timeTo) body.timeTo = timeTo;

    const res = await fetch(`${COMCASH_OPENAPI_URL}/sale/list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        OPEN_API_KEY: COMCASH_OPENAPI_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      return JSON.stringify({
        error: `Comcash sales API returned ${res.status}: ${text.slice(0, 200)}`,
      });
    }

    const data = await res.json();

    // Return whatever the API gives us -- Claude will interpret it
    return JSON.stringify({
      sales: Array.isArray(data) ? data : data.data || data,
      count: Array.isArray(data)
        ? data.length
        : data.total || (data.data ? data.data.length : 0),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return JSON.stringify({
      error: `Failed to fetch sales: ${msg}`,
    });
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

async function handleAutoGeneratePOs(): Promise<string> {
  // Replicate the logic from /api/po/auto-generate
  const allItems = await prisma.inventoryItem.findMany({
    where: { isActive: true, vendorId: { not: null } },
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

    for (const [vendorId, items] of byVendor) {
      if (existingDraftVendorIds.has(vendorId)) continue;

      const poNumber = `${settings.poNumberPrefix}-${year}-${String(nextSeq).padStart(4, "0")}`;
      nextSeq++;

      const lineItems = items.map((item) => ({
        inventoryItemId: item.id,
        vendorSku: item.vendorSku || null,
        description: item.name,
        qtyOrdered: item.reorderQty,
        unitCost: Number(item.costPrice),
        lineTotal: item.reorderQty * Number(item.costPrice),
      }));

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
          orderMethod: items[0].vendor?.orderMethod || "EMAIL",
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
        const onHand =
          typeof product.onHand === "number" ? product.onHand : 0;

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

async function handleSyncInventoryToComcash(
  input: Record<string, unknown>
): Promise<string> {
  const inventoryItemIds = (input.inventoryItemIds as string[]) || [];

  try {
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
        currentStock: true,
      },
    });

    if (items.length === 0) {
      return JSON.stringify({
        message: "No items with Comcash IDs found to sync",
        synced: 0,
      });
    }

    // Authenticate with Comcash
    const token = await authenticateEmployee();

    // Push each item's stock to Comcash via warehouse/changeQuantity
    let synced = 0;
    const errors: string[] = [];

    // Batch items in groups of 25
    const batchSize = 25;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      const products = batch.map((item) => ({
        productId: parseInt(item.comcashItemId!, 10),
        warehouseId: 1,
        measureUnitId: 1,
        quantity: item.currentStock,
      }));

      try {
        const res = await fetch(
          `${COMCASH_OPENAPI_URL}/employee/warehouse/changeQuantity`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              note: `Sync from procurement app ${new Date().toISOString()}`,
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
      total: items.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Synced ${synced} of ${items.length} items to Comcash POS${errors.length > 0 ? ` (${errors.length} batch errors)` : ""}`,
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
    category?: string;
    categoryEmpty?: boolean;
    vendorId?: string;
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

  if (filter.category) {
    where.category = { contains: filter.category, mode: "insensitive" };
  }
  if (filter.categoryEmpty) {
    where.OR = [
      { category: null },
      { category: "" },
      { category: "Uncategorized" },
    ];
  }
  if (filter.vendorId) {
    where.vendorId = filter.vendorId;
  }
  if (filter.vendorEmpty) {
    where.vendorId = null;
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
        max_tokens: 1024,
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
        (block): block is Anthropic.ContentBlock & { type: "tool_use" } =>
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
