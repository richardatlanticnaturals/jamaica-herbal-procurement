import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ocrDeliverySlip, type OcrItem } from "@/lib/ocr-delivery";
import { requireAuth } from "@/lib/api-auth";

/**
 * POST /api/receiving/quick
 * Quick Receive: OCR an invoice/packing slip WITHOUT a PO,
 * fuzzy-match items against the entire inventory, and return
 * matched results for user review. Does NOT update stock.
 *
 * Body: { image: string (base64), locationCode?: "LL" | "NL" }
 */

// ---------- Similarity helpers (reuse logic from lib/fuzzy-match.ts) ----------

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (a.length > b.length) [a, b] = [b, a];
  const aLen = a.length;
  const bLen = b.length;
  let prev = new Array(aLen + 1);
  let curr = new Array(aLen + 1);
  for (let i = 0; i <= aLen; i++) prev[i] = i;
  for (let j = 1; j <= bLen; j++) {
    curr[0] = j;
    for (let i = 1; i <= aLen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(prev[i] + 1, curr[i - 1] + 1, prev[i - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[aLen];
}

function tokenize(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

function similarity(a: string, b: string): number {
  const normA = normalize(a);
  const normB = normalize(b);
  if (normA === normB) return 1.0;
  if (!normA || !normB) return 0;

  const maxLen = Math.max(normA.length, normB.length);
  const levSim = 1 - levenshtein(normA, normB) / maxLen;

  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.length === 0 && tokensB.length === 0) return 1.0;
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  let matchedTokens = 0;
  const usedB = new Set<number>();
  for (const ta of tokensA) {
    let bestScore = 0;
    let bestIdx = -1;
    for (let j = 0; j < tokensB.length; j++) {
      if (usedB.has(j)) continue;
      const tb = tokensB[j];
      const tMaxLen = Math.max(ta.length, tb.length);
      if (tMaxLen === 0) continue;
      const tSim = 1 - levenshtein(ta, tb) / tMaxLen;
      if (tSim > bestScore) { bestScore = tSim; bestIdx = j; }
    }
    if (bestScore >= 0.7 && bestIdx >= 0) {
      matchedTokens += bestScore;
      usedB.add(bestIdx);
    }
  }
  const unionSize = Math.max(tokensA.length, tokensB.length);
  const tokenSim = matchedTokens / unionSize;
  return 0.4 * levSim + 0.6 * tokenSim;
}

function skuMatch(ocrSku: string | null, invSku: string | null): number {
  if (!ocrSku || !invSku) return 0;
  const a = normalize(ocrSku);
  const b = normalize(invSku);
  if (!a || !b) return 0;
  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.8;
  return 0;
}

// ---------- Types ----------

interface InventoryCandidate {
  id: string;
  sku: string;
  name: string;
  vendorSku: string | null;
  currentStock: number;
}

export interface QuickMatchCandidate {
  inventoryItemId: string;
  inventoryName: string;
  inventorySku: string;
  confidence: number;
  currentStock: number;
}

export interface QuickMatchedItem {
  ocrItem: OcrItem;
  status: "EXACT" | "FUZZY" | "UNMATCHED";
  topMatches: QuickMatchCandidate[];
  selectedMatch: QuickMatchCandidate | null;
}

// ---------- Handler ----------

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const { image, locationCode } = body as {
      image: string;
      locationCode?: "LL" | "NL";
    };

    if (!image) {
      return NextResponse.json(
        { error: "image (base64) is required" },
        { status: 400 }
      );
    }

    // Step 1: OCR the invoice/packing slip
    const ocrResult = await ocrDeliverySlip(image);

    if (ocrResult.items.length === 0) {
      return NextResponse.json(
        { error: "No items could be extracted from the image. Try a clearer photo." },
        { status: 422 }
      );
    }

    // Step 2: Load all active inventory items for matching
    const allInventory: InventoryCandidate[] = await prisma.inventoryItem.findMany({
      where: { isActive: true },
      select: {
        id: true,
        sku: true,
        name: true,
        vendorSku: true,
        currentStock: true,
      },
    });

    // Step 3: For each OCR item, find top 3 inventory matches
    const matchedItems: QuickMatchedItem[] = ocrResult.items.map((ocrItem) => {
      const scored: { inv: InventoryCandidate; confidence: number }[] = [];

      for (const inv of allInventory) {
        // Name similarity
        const nameSim = similarity(ocrItem.name, inv.name);

        // SKU match (check both sku and vendorSku)
        const skuSim1 = skuMatch(ocrItem.sku, inv.sku);
        const skuSim2 = skuMatch(ocrItem.sku, inv.vendorSku);
        const skuSim = Math.max(skuSim1, skuSim2);

        let confidence: number;
        if (skuSim >= 0.8) {
          confidence = Math.max(skuSim, 0.3 * nameSim + 0.7 * skuSim);
        } else {
          confidence = nameSim;
        }

        if (confidence >= 0.3) {
          scored.push({ inv, confidence });
        }
      }

      // Sort by confidence descending, take top 3
      scored.sort((a, b) => b.confidence - a.confidence);
      const top3 = scored.slice(0, 3);

      const topMatches: QuickMatchCandidate[] = top3.map((s) => ({
        inventoryItemId: s.inv.id,
        inventoryName: s.inv.name,
        inventorySku: s.inv.sku,
        confidence: Math.round(s.confidence * 100) / 100,
        currentStock: s.inv.currentStock,
      }));

      // Determine status based on best match
      const bestConfidence = topMatches.length > 0 ? topMatches[0].confidence : 0;
      let status: "EXACT" | "FUZZY" | "UNMATCHED";
      if (bestConfidence >= 0.9) {
        status = "EXACT";
      } else if (bestConfidence >= 0.5) {
        status = "FUZZY";
      } else {
        status = "UNMATCHED";
      }

      return {
        ocrItem,
        status,
        topMatches,
        selectedMatch: topMatches.length > 0 ? topMatches[0] : null,
      };
    });

    return NextResponse.json({
      ocrResult,
      matchedItems,
      locationCode: locationCode || null,
    });
  } catch (error) {
    console.error("Quick receive OCR failed:", error);
    const message =
      error instanceof Error ? error.message : "Failed to process invoice";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
