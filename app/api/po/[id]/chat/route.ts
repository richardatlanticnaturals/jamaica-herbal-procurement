import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Haiku 4.5 pricing: $1.00/M input, $5.00/M output
const COST_PER_INPUT_TOKEN = 1.0 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 5.0 / 1_000_000;

// --- Load full PO with line items and vendor ---
async function loadPO(poId: string) {
  return prisma.purchaseOrder.findUnique({
    where: { id: poId },
    include: {
      vendor: true,
      lineItems: {
        include: {
          inventoryItem: {
            select: { id: true, name: true, sku: true, currentStock: true },
          },
        },
      },
      statusHistory: { orderBy: { createdAt: "asc" } },
    },
  });
}

// --- Tool definitions for PO chat ---
const poTools: Anthropic.Tool[] = [
  {
    name: "update_line_item",
    description:
      "Update qty or unit cost on a line item. Match by description or SKU (case-insensitive partial match).",
    input_schema: {
      type: "object" as const,
      properties: {
        match: {
          type: "string",
          description: "Description or SKU to match the line item",
        },
        qtyOrdered: {
          type: "number",
          description: "New quantity (optional, omit to keep current)",
        },
        unitCost: {
          type: "number",
          description: "New unit cost (optional, omit to keep current)",
        },
      },
      required: ["match"],
    },
  },
  {
    name: "add_item",
    description:
      "Search inventory and add an item to this PO. First searches by name/SKU, then adds with given qty and cost.",
    input_schema: {
      type: "object" as const,
      properties: {
        search: {
          type: "string",
          description: "Name or SKU to search for in inventory",
        },
        qtyOrdered: { type: "number", description: "Quantity to order" },
        unitCost: {
          type: "number",
          description:
            "Unit cost override (optional, defaults to item cost price)",
        },
      },
      required: ["search", "qtyOrdered"],
    },
  },
  {
    name: "remove_item",
    description:
      "Remove a line item from this PO by description or SKU match.",
    input_schema: {
      type: "object" as const,
      properties: {
        match: {
          type: "string",
          description: "Description or SKU to match the line item to remove",
        },
      },
      required: ["match"],
    },
  },
  {
    name: "update_notes",
    description: "Update the PO notes/special instructions.",
    input_schema: {
      type: "object" as const,
      properties: {
        notes: { type: "string", description: "New notes text" },
      },
      required: ["notes"],
    },
  },
  {
    name: "get_po_summary",
    description: "Return current PO state: all items, quantities, costs, total.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "remove_slow_movers",
    description: "Remove items from this PO that haven't sold in X months. Checks the ProductSales cache. Always do a dry run first.",
    input_schema: {
      type: "object" as const,
      properties: {
        months: { type: "number", description: "Remove items with no sales in this many months (default 4)" },
        dryRun: { type: "boolean", description: "If true, show which items would be removed without removing them. ALWAYS do dry run first." },
      },
      required: [],
    },
  },
];

// --- Execute a tool call against the PO ---
async function executeToolCall(
  toolName: string,
  input: Record<string, unknown>,
  poId: string,
  vendorId: string | null
): Promise<{ result: string; poUpdated: boolean }> {
  const canEdit = async () => {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: { status: true },
    });
    return po && ["DRAFT", "APPROVED"].includes(po.status);
  };

  switch (toolName) {
    case "get_po_summary": {
      const po = await loadPO(poId);
      if (!po) return { result: "PO not found.", poUpdated: false };
      const lines = po.lineItems.map(
        (li) =>
          `- ${li.description} (${li.inventoryItem?.sku || "no-sku"}): ${li.qtyOrdered} x $${Number(li.unitCost).toFixed(2)} = $${Number(li.lineTotal).toFixed(2)}`
      );
      return {
        result: `PO ${po.poNumber} | ${po.status} | ${po.lineItems.length} items | $${Number(po.total).toFixed(2)}\n${lines.join("\n")}\nNotes: ${po.notes || "(none)"}`,
        poUpdated: false,
      };
    }

    case "update_line_item": {
      if (!(await canEdit()))
        return {
          result: "Cannot edit: PO is not in DRAFT or APPROVED status.",
          poUpdated: false,
        };
      const match = (input.match as string).toLowerCase();
      const po = await loadPO(poId);
      if (!po) return { result: "PO not found.", poUpdated: false };

      const found = po.lineItems.find(
        (li) =>
          li.description.toLowerCase().includes(match) ||
          (li.inventoryItem?.sku || "").toLowerCase().includes(match) ||
          (li.vendorSku || "").toLowerCase().includes(match)
      );
      if (!found)
        return {
          result: `No line item matching "${input.match}". Items: ${po.lineItems.map((li) => li.description).join(", ")}`,
          poUpdated: false,
        };

      const newQty =
        input.qtyOrdered != null ? (input.qtyOrdered as number) : found.qtyOrdered;
      const newCost =
        input.unitCost != null ? (input.unitCost as number) : Number(found.unitCost);
      const lineTotal = newQty * newCost;

      await prisma.$transaction(async (tx) => {
        await tx.pOLineItem.update({
          where: { id: found.id },
          data: { qtyOrdered: newQty, unitCost: newCost, lineTotal },
        });
        const allLines = await tx.pOLineItem.findMany({
          where: { purchaseOrderId: poId },
        });
        const subtotal = allLines.reduce(
          (sum, li) => sum + Number(li.lineTotal),
          0
        );
        const existing = await tx.purchaseOrder.findUnique({
          where: { id: poId },
          select: { tax: true, shipping: true },
        });
        await tx.purchaseOrder.update({
          where: { id: poId },
          data: {
            subtotal,
            total:
              subtotal +
              Number(existing?.tax || 0) +
              Number(existing?.shipping || 0),
          },
        });
      });

      return {
        result: `Updated "${found.description}": qty=${newQty}, cost=$${newCost.toFixed(2)}, line=$${lineTotal.toFixed(2)}`,
        poUpdated: true,
      };
    }

    case "add_item": {
      if (!(await canEdit()))
        return {
          result: "Cannot edit: PO is not in DRAFT or APPROVED status.",
          poUpdated: false,
        };
      const searchTerm = (input.search as string).trim();
      const qty = (input.qtyOrdered as number) || 1;

      // Search inventory
      const where: Record<string, unknown> = {
        isActive: true,
        OR: [
          { name: { contains: searchTerm, mode: "insensitive" } },
          { sku: { contains: searchTerm, mode: "insensitive" } },
        ],
      };
      if (vendorId) {
        where.vendorId = vendorId;
      }

      const items = await prisma.inventoryItem.findMany({
        where,
        take: 5,
        orderBy: { name: "asc" },
        select: {
          id: true,
          sku: true,
          name: true,
          currentStock: true,
          costPrice: true,
          vendorSku: true,
        },
      });

      if (items.length === 0) {
        // Try broader search without vendor filter
        const broadItems = await prisma.inventoryItem.findMany({
          where: {
            isActive: true,
            OR: [
              { name: { contains: searchTerm, mode: "insensitive" } },
              { sku: { contains: searchTerm, mode: "insensitive" } },
            ],
          },
          take: 5,
          select: { id: true, sku: true, name: true, costPrice: true },
        });
        if (broadItems.length === 0)
          return {
            result: `No inventory items found matching "${searchTerm}".`,
            poUpdated: false,
          };
        return {
          result: `No items from this vendor match "${searchTerm}", but found in other vendors: ${broadItems.map((i) => `${i.name} (${i.sku})`).join(", ")}. These belong to different vendors.`,
          poUpdated: false,
        };
      }

      // Check for duplicates
      const existingLineItems = await prisma.pOLineItem.findMany({
        where: { purchaseOrderId: poId },
        select: { inventoryItemId: true },
      });
      const existingIds = new Set(
        existingLineItems.map((li) => li.inventoryItemId)
      );

      // If multiple matches, pick the best one (exact name match first)
      let item = items.find(
        (i) => i.name.toLowerCase() === searchTerm.toLowerCase()
      );
      if (!item) item = items[0];

      if (existingIds.has(item.id))
        return {
          result: `"${item.name}" is already on this PO. Use update_line_item to change its quantity.`,
          poUpdated: false,
        };

      const unitCost =
        input.unitCost != null
          ? (input.unitCost as number)
          : Number(item.costPrice);
      const lineTotal = qty * unitCost;

      await prisma.$transaction(async (tx) => {
        await tx.pOLineItem.create({
          data: {
            purchaseOrderId: poId,
            inventoryItemId: item.id,
            vendorSku: item.vendorSku || null,
            description: item.name,
            qtyOrdered: qty,
            unitCost,
            lineTotal,
          },
        });
        const allLines = await tx.pOLineItem.findMany({
          where: { purchaseOrderId: poId },
        });
        const subtotal = allLines.reduce(
          (sum, li) => sum + Number(li.lineTotal),
          0
        );
        const existing = await tx.purchaseOrder.findUnique({
          where: { id: poId },
          select: { tax: true, shipping: true },
        });
        await tx.purchaseOrder.update({
          where: { id: poId },
          data: {
            subtotal,
            total:
              subtotal +
              Number(existing?.tax || 0) +
              Number(existing?.shipping || 0),
          },
        });
      });

      return {
        result: `Added "${item.name}" (${item.sku}): ${qty} x $${unitCost.toFixed(2)} = $${lineTotal.toFixed(2)}`,
        poUpdated: true,
      };
    }

    case "remove_item": {
      if (!(await canEdit()))
        return {
          result: "Cannot edit: PO is not in DRAFT or APPROVED status.",
          poUpdated: false,
        };
      const match = (input.match as string).toLowerCase();
      const po = await loadPO(poId);
      if (!po) return { result: "PO not found.", poUpdated: false };

      const found = po.lineItems.find(
        (li) =>
          li.description.toLowerCase().includes(match) ||
          (li.inventoryItem?.sku || "").toLowerCase().includes(match) ||
          (li.vendorSku || "").toLowerCase().includes(match)
      );
      if (!found)
        return {
          result: `No line item matching "${input.match}". Items: ${po.lineItems.map((li) => li.description).join(", ")}`,
          poUpdated: false,
        };

      await prisma.$transaction(async (tx) => {
        await tx.pOLineItem.delete({ where: { id: found.id } });
        const allLines = await tx.pOLineItem.findMany({
          where: { purchaseOrderId: poId },
        });
        const subtotal = allLines.reduce(
          (sum, li) => sum + Number(li.lineTotal),
          0
        );
        const existing = await tx.purchaseOrder.findUnique({
          where: { id: poId },
          select: { tax: true, shipping: true },
        });
        await tx.purchaseOrder.update({
          where: { id: poId },
          data: {
            subtotal,
            total:
              subtotal +
              Number(existing?.tax || 0) +
              Number(existing?.shipping || 0),
          },
        });
      });

      return {
        result: `Removed "${found.description}" (was ${found.qtyOrdered} x $${Number(found.unitCost).toFixed(2)})`,
        poUpdated: true,
      };
    }

    case "update_notes": {
      if (!(await canEdit()))
        return {
          result: "Cannot edit: PO is not in DRAFT or APPROVED status.",
          poUpdated: false,
        };
      const notes = (input.notes as string) || "";
      await prisma.purchaseOrder.update({
        where: { id: poId },
        data: { notes: notes || null },
      });
      return {
        result: `Notes updated to: "${notes || "(cleared)"}"`,
        poUpdated: true,
      };
    }

    case "remove_slow_movers": {
      const months = (input.months as number) || 4;
      const dryRun = (input.dryRun as boolean) ?? true;

      const po = await loadPO(poId);
      if (!po) return { result: "PO not found.", poUpdated: false };

      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);

      // Get sales data for items in this PO
      const skus = po.lineItems.map((li) => li.inventoryItem?.sku).filter(Boolean) as string[];
      const salesData = await prisma.productSales.findMany({
        where: { sku: { in: skus } },
        select: { sku: true, lastSoldAt: true, totalQtySold: true },
      });
      const salesMap = new Map(salesData.map((s) => [s.sku, s]));

      // Identify slow movers on this PO
      const slowMovers = po.lineItems.filter((li) => {
        const sku = li.inventoryItem?.sku;
        if (!sku) return true; // No SKU = no sales data = slow mover
        const sale = salesMap.get(sku);
        if (!sale || !sale.lastSoldAt) return true; // Never sold
        return sale.lastSoldAt < cutoff; // Last sold before cutoff
      });

      if (slowMovers.length === 0) {
        return { result: `No slow movers found on this PO. All ${po.lineItems.length} items have sold in the last ${months} months.`, poUpdated: false };
      }

      if (dryRun) {
        const list = slowMovers.map((li) => {
          const sale = salesMap.get(li.inventoryItem?.sku || "");
          const lastSold = sale?.lastSoldAt ? sale.lastSoldAt.toISOString().split("T")[0] : "never";
          return `- ${li.description} (last sold: ${lastSold})`;
        }).join("\n");
        return {
          result: `Found ${slowMovers.length} slow movers (no sales in ${months} months):\n${list}\n\nSay "yes" or "confirm" to remove them from this PO.`,
          poUpdated: false,
        };
      }

      // Actually remove them
      const removeIds = slowMovers.map((li) => li.id);
      await prisma.$transaction(async (tx) => {
        await tx.pOLineItem.deleteMany({ where: { id: { in: removeIds } } });
        const remaining = await tx.pOLineItem.findMany({ where: { purchaseOrderId: poId } });
        const subtotal = remaining.reduce((sum, li) => sum + Number(li.lineTotal), 0);
        await tx.purchaseOrder.update({
          where: { id: poId },
          data: { subtotal, total: subtotal },
        });
      });

      const updatedPO = await loadPO(poId);
      return {
        result: `Removed ${slowMovers.length} slow movers. PO now has ${updatedPO?.lineItems.length || 0} items, $${Number(updatedPO?.total || 0).toFixed(2)}.`,
        poUpdated: true,
      };
    }

    default:
      return { result: `Unknown tool: ${toolName}`, poUpdated: false };
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id: poId } = await params;
    const body = await request.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }

    // Load PO for context
    const po = await loadPO(poId);
    if (!po) {
      return NextResponse.json({ error: "PO not found" }, { status: 404 });
    }

    const canEditPO = ["DRAFT", "APPROVED"].includes(po.status);

    // Build concise system prompt with PO context
    const itemList = po.lineItems
      .map(
        (li) =>
          `${li.description} (${li.inventoryItem?.sku || "no-sku"}): ${li.qtyOrdered} x $${Number(li.unitCost).toFixed(2)}`
      )
      .join("; ");

    const systemPrompt = `You are editing PO ${po.poNumber} for ${po.vendor?.name || "unknown vendor"}. ${po.lineItems.length} items, $${Number(po.total).toFixed(2)}. Status: ${po.status}.
Items: ${itemList}
${canEditPO ? "Make changes directly when asked. Show a brief summary after each change." : "This PO is " + po.status + " - read-only. Answer questions but do not make changes."}
For adds: search inventory first, confirm the item, then add it.
For removes: match by name or SKU, confirm, then remove.
For "remove items that haven't sold": use remove_slow_movers with dryRun:true first, show the list, then apply after confirmation.
Be very concise. Use plain text, not markdown tables.`;

    // Convert messages to Claude format
    const claudeMessages: Anthropic.MessageParam[] = messages
      .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
      .map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    // Token tracking
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let poUpdated = false;

    // Tool use loop
    let loopCount = 0;
    const maxLoops = 5;
    let currentMessages = [...claudeMessages];

    while (loopCount < maxLoops) {
      loopCount++;

      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt,
        tools: canEditPO ? poTools : poTools.filter(t => t.name === "get_po_summary"), // only summary if read-only
        messages: currentMessages,
      });

      if (response.usage) {
        totalInputTokens += response.usage.input_tokens;
        totalOutputTokens += response.usage.output_tokens;
      }

      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) {
        // Final text response
        const textContent = response.content
          .filter(
            (block): block is Anthropic.TextBlock => block.type === "text"
          )
          .map((block) => block.text)
          .join("\n");

        const totalTokens = totalInputTokens + totalOutputTokens;
        const cost =
          totalInputTokens * COST_PER_INPUT_TOKEN +
          totalOutputTokens * COST_PER_OUTPUT_TOKEN;

        // If PO was modified, reload and return updated data
        let updatedPO = null;
        if (poUpdated) {
          updatedPO = await loadPO(poId);
        }

        return NextResponse.json({
          content: textContent,
          poUpdated,
          po: updatedPO,
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            totalTokens,
            cost: Math.round(cost * 1_000_000) / 1_000_000,
          },
        });
      }

      // Execute tool calls
      currentMessages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolBlock of toolUseBlocks) {
        const { result, poUpdated: changed } = await executeToolCall(
          toolBlock.name,
          toolBlock.input as Record<string, unknown>,
          poId,
          po.vendorId
        );
        if (changed) poUpdated = true;
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolBlock.id,
          content: result,
        });
      }

      currentMessages.push({ role: "user", content: toolResults });
    }

    // Max loops reached
    const totalTokens = totalInputTokens + totalOutputTokens;
    const cost =
      totalInputTokens * COST_PER_INPUT_TOKEN +
      totalOutputTokens * COST_PER_OUTPUT_TOKEN;
    let updatedPO = null;
    if (poUpdated) updatedPO = await loadPO(poId);

    return NextResponse.json({
      content: "Could not complete the request. Please try a simpler instruction.",
      poUpdated,
      po: updatedPO,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens,
        cost: Math.round(cost * 1_000_000) / 1_000_000,
      },
    });
  } catch (error) {
    console.error("[PO Chat Error]:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
