import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

interface ClaudeResponse {
  content: Array<{ type: string; text: string }>;
}

interface SuggestedAlternative {
  altItemName: string;
  altVendorName: string;
  reason: string;
}

/**
 * POST /api/oos/alternatives
 * Accepts { inventoryItemId } and uses Claude to suggest alternative products.
 */
export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const { inventoryItemId } = body;

    if (!inventoryItemId) {
      return NextResponse.json(
        { error: "inventoryItemId is required" },
        { status: 400 }
      );
    }

    // Load the inventory item with vendor
    const item = await prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      include: {
        vendor: { select: { id: true, name: true } },
      },
    });

    if (!item) {
      return NextResponse.json(
        { error: "Inventory item not found" },
        { status: 404 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured" },
        { status: 500 }
      );
    }

    // Build the Claude prompt
    const prompt = `You are a purchasing assistant for Jamaica Herbal, a Jamaican heritage herbal and natural products store in South Florida. The store sells herbs, teas, natural remedies, supplements, essential oils, and Caribbean food products.

An item is out of stock and we need alternative product suggestions from other vendors.

Item details:
- Name: ${item.name}
- SKU: ${item.sku}
- Category: ${item.category || "General"}
- Current Vendor: ${item.vendor?.name || "Unknown"}

Please suggest 3-5 alternative herbal/natural products that serve the same purpose or could substitute for this item. For each alternative, provide:
1. A product name
2. A vendor/brand name that commonly supplies this type of product
3. A brief reason why it's a good alternative

Consider Caribbean, Jamaican, and tropical herbal suppliers. Think about products from vendors like Starwest Botanicals, Mountain Rose Herbs, Frontier Co-op, Island Herbs & Spices, or similar natural product distributors.

Respond ONLY with a JSON array in this exact format, no other text:
[
  {
    "altItemName": "Product Name",
    "altVendorName": "Vendor Name",
    "reason": "Brief reason why this is a good alternative"
  }
]`;

    const messages: ClaudeMessage[] = [
      { role: "user", content: prompt },
    ];

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages,
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error("Claude API error:", errText);
      return NextResponse.json(
        { error: "AI suggestion service unavailable" },
        { status: 502 }
      );
    }

    const claudeData: ClaudeResponse = await claudeRes.json();
    const responseText =
      claudeData.content?.[0]?.text || "[]";

    // Parse the JSON response from Claude
    let suggestions: SuggestedAlternative[] = [];
    try {
      // Extract JSON array from response (handle markdown code blocks)
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        suggestions = JSON.parse(jsonMatch[0]);
      }
    } catch (parseErr) {
      console.error("Failed to parse Claude response:", parseErr);
      console.error("Raw response:", responseText);
      return NextResponse.json(
        { error: "Failed to parse AI suggestions" },
        { status: 500 }
      );
    }

    // Save suggestions to the database
    const savedAlternatives = [];
    for (const suggestion of suggestions) {
      // Try to find a matching vendor in our database
      let altVendorId: string | null = null;
      if (suggestion.altVendorName) {
        const matchedVendor = await prisma.vendor.findFirst({
          where: {
            name: {
              contains: suggestion.altVendorName,
              mode: "insensitive",
            },
          },
        });
        if (matchedVendor) {
          altVendorId = matchedVendor.id;
        }
      }

      const alt = await prisma.alternativeProduct.create({
        data: {
          primaryItemId: inventoryItemId,
          altItemName: suggestion.altItemName,
          altVendorId,
          reason: suggestion.reason,
        },
        include: {
          altVendor: { select: { id: true, name: true } },
        },
      });

      savedAlternatives.push({
        ...alt,
        altVendorName: suggestion.altVendorName,
      });
    }

    return NextResponse.json({
      itemId: inventoryItemId,
      itemName: item.name,
      alternatives: savedAlternatives,
      count: savedAlternatives.length,
    });
  } catch (error) {
    console.error("OOS alternatives error:", error);
    return NextResponse.json(
      {
        error: "Failed to generate alternatives",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
