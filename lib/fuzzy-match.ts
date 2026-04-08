/**
 * Fuzzy matching engine for delivery OCR items against PO line items.
 * Uses Levenshtein distance + token overlap for robust matching.
 * No external dependencies.
 */

import type { OcrItem } from "./ocr-delivery";

// ---------- Types ----------

export interface POLineItemForMatch {
  id: string;
  description: string;
  qtyOrdered: number;
  qtyReceived: number;
  vendorSku?: string | null;
  inventoryItemId: string;
}

export type MatchStatusType = "EXACT" | "FUZZY" | "UNMATCHED";

export interface MatchedItem {
  ocrItem: OcrItem;
  poLineItem: POLineItemForMatch | null;
  confidence: number;
  status: MatchStatusType;
}

export interface MatchResult {
  matches: MatchedItem[];
}

// ---------- String Utilities ----------

/** Normalize a string for comparison: lowercase, collapse whitespace, strip punctuation. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokenize a string into words. */
function tokenize(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

/**
 * Compute Levenshtein distance between two strings.
 * Uses the classic dynamic-programming approach with O(min(m,n)) space.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure a is the shorter string for space optimization
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const aLen = a.length;
  const bLen = b.length;
  let prev = new Array(aLen + 1);
  let curr = new Array(aLen + 1);

  for (let i = 0; i <= aLen; i++) prev[i] = i;

  for (let j = 1; j <= bLen; j++) {
    curr[0] = j;
    for (let i = 1; i <= aLen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        prev[i] + 1,       // deletion
        curr[i - 1] + 1,   // insertion
        prev[i - 1] + cost  // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[aLen];
}

/**
 * Compute similarity between two strings (0–1).
 * Combines normalized Levenshtein similarity with token overlap (Jaccard).
 */
function similarity(a: string, b: string): number {
  const normA = normalize(a);
  const normB = normalize(b);

  if (normA === normB) return 1.0;
  if (!normA || !normB) return 0;

  // Levenshtein-based similarity (on full normalized strings)
  const maxLen = Math.max(normA.length, normB.length);
  const levDist = levenshtein(normA, normB);
  const levSim = 1 - levDist / maxLen;

  // Token overlap (Jaccard-like)
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);

  if (tokensA.length === 0 && tokensB.length === 0) return 1.0;
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  // Count tokens from A that have a close match in B
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
      if (tSim > bestScore) {
        bestScore = tSim;
        bestIdx = j;
      }
    }

    if (bestScore >= 0.7 && bestIdx >= 0) {
      matchedTokens += bestScore;
      usedB.add(bestIdx);
    }
  }

  const unionSize = Math.max(tokensA.length, tokensB.length);
  const tokenSim = matchedTokens / unionSize;

  // Weighted combination: 40% Levenshtein, 60% token overlap
  // Token overlap is more forgiving with word reordering
  return 0.4 * levSim + 0.6 * tokenSim;
}

/**
 * Try to match by SKU — an exact SKU match is very high confidence.
 */
function skuMatch(
  ocrSku: string | null,
  vendorSku: string | null | undefined
): number {
  if (!ocrSku || !vendorSku) return 0;
  const a = normalize(ocrSku);
  const b = normalize(vendorSku);
  if (!a || !b) return 0;
  if (a === b) return 1.0;
  // Partial SKU match
  if (a.includes(b) || b.includes(a)) return 0.8;
  return 0;
}

// ---------- Main Matching Function ----------

/**
 * Match OCR-extracted delivery items against a PO's expected line items.
 * Each OCR item is matched to the best PO line item (or left unmatched).
 * PO line items can only be matched once (greedy best-first).
 */
export function matchDeliveryToPO(
  ocrItems: OcrItem[],
  poLineItems: POLineItemForMatch[]
): MatchResult {
  if (ocrItems.length === 0) {
    return { matches: [] };
  }

  // Build a score matrix: ocrItems x poLineItems
  const scores: { ocrIdx: number; poIdx: number; confidence: number }[] = [];

  for (let oi = 0; oi < ocrItems.length; oi++) {
    const ocr = ocrItems[oi];
    for (let pi = 0; pi < poLineItems.length; pi++) {
      const pol = poLineItems[pi];

      // Name-based similarity
      const nameSim = similarity(ocr.name, pol.description);

      // SKU boost
      const skuSim = skuMatch(ocr.sku, pol.vendorSku);

      // Combined confidence: SKU match is a strong signal
      let confidence: number;
      if (skuSim >= 0.8) {
        // If SKU matches, high confidence even with weaker name match
        confidence = Math.max(skuSim, 0.3 * nameSim + 0.7 * skuSim);
      } else {
        confidence = nameSim;
      }

      scores.push({ ocrIdx: oi, poIdx: pi, confidence });
    }
  }

  // Sort by confidence descending for greedy assignment
  scores.sort((a, b) => b.confidence - a.confidence);

  const assignedOcr = new Set<number>();
  const assignedPo = new Set<number>();
  const matchMap = new Map<
    number,
    { poIdx: number; confidence: number }
  >();

  for (const { ocrIdx, poIdx, confidence } of scores) {
    if (assignedOcr.has(ocrIdx) || assignedPo.has(poIdx)) continue;
    // Only assign matches that will actually be used in output (>= 0.5).
    // Lower matches would consume a PO line item slot but get discarded
    // as UNMATCHED, potentially blocking a better match for that PO line.
    if (confidence < 0.5) continue;

    assignedOcr.add(ocrIdx);
    assignedPo.add(poIdx);
    matchMap.set(ocrIdx, { poIdx, confidence });
  }

  // Build result
  const matches: MatchedItem[] = ocrItems.map((ocrItem, oi) => {
    const match = matchMap.get(oi);

    if (!match || match.confidence < 0.5) {
      return {
        ocrItem,
        poLineItem: null, // Don't expose low-confidence matches
        confidence: match?.confidence ?? 0,
        status: "UNMATCHED" as const,
      };
    }

    const poLine = poLineItems[match.poIdx];
    const status: MatchStatusType =
      match.confidence >= 0.9 ? "EXACT" : "FUZZY";

    return {
      ocrItem,
      poLineItem: poLine,
      confidence: Math.round(match.confidence * 100) / 100,
      status,
    };
  });

  return { matches };
}
