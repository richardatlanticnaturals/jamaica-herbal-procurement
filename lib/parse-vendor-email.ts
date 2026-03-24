/**
 * parse-vendor-email.ts
 * Uses Claude API to extract structured procurement data from vendor emails.
 * Identifies PO confirmations, out-of-stock notices, delivery dates, and alternatives.
 */

export interface ParsedEmailResult {
  isPoRelated: boolean;
  poNumber: string | null;
  status: "confirmed" | "partial" | "rejected" | "out_of_stock" | "unknown";
  expectedDate: string | null;
  outOfStockItems: string[];
  alternatives: { original: string; suggested: string; vendor: string }[];
  notes: string | null;
}

interface EmailInput {
  subject: string;
  body: string;
  from: string;
}

const SYSTEM_PROMPT = `You are an AI assistant for Jamaica Herbal, a natural products store. Your job is to analyze emails from vendors/suppliers and extract structured procurement data.

Analyze the email and determine:
1. Is this email related to a Purchase Order (PO)? Look for PO numbers, order confirmations, shipping notices, out-of-stock notices, or any supply chain communication.
2. What PO number is referenced? Look for patterns like "PO-2026-0001", "PO#1234", "Order #1234", "Reference: PO-XXX", etc.
3. What is the confirmation status?
   - "confirmed" = order fully confirmed, all items available
   - "partial" = some items confirmed, some out of stock or backordered
   - "rejected" = order rejected or cancelled by vendor
   - "out_of_stock" = vendor reports items unavailable
   - "unknown" = PO-related but status unclear
4. Is there an expected delivery date? Extract it in ISO 8601 format (YYYY-MM-DD).
5. Are any items reported as out of stock? List product names or SKUs.
6. Are alternative products suggested for out-of-stock items?
7. Any special notes (price changes, minimum order issues, backorder dates, etc.)

You MUST respond with valid JSON only. No markdown, no explanation, just the JSON object.`;

const USER_PROMPT_TEMPLATE = `Analyze this vendor email and extract procurement data.

FROM: {{from}}
SUBJECT: {{subject}}

BODY:
{{body}}

Respond with ONLY a JSON object in this exact format:
{
  "isPoRelated": boolean,
  "poNumber": string | null,
  "status": "confirmed" | "partial" | "rejected" | "out_of_stock" | "unknown",
  "expectedDate": string | null,
  "outOfStockItems": ["item name or SKU"],
  "alternatives": [{"original": "original item", "suggested": "suggested replacement", "vendor": "vendor name"}],
  "notes": string | null
}`;

export async function parseVendorEmail(email: EmailInput): Promise<ParsedEmailResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }

  const userPrompt = USER_PROMPT_TEMPLATE
    .replace("{{from}}", email.from)
    .replace("{{subject}}", email.subject)
    .replace("{{body}}", email.body);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Claude API error (${response.status}): ${errorBody}`
    );
  }

  const data = await response.json();

  // Extract text content from the response
  const textBlock = data.content?.find(
    (block: { type: string }) => block.type === "text"
  );
  if (!textBlock?.text) {
    throw new Error("No text content in Claude API response");
  }

  // Parse the JSON from Claude's response, handling possible markdown fencing
  let jsonStr = textBlock.text.trim();

  // Strip markdown code fences if present
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  let parsed: ParsedEmailResult;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (parseError) {
    console.error("Failed to parse Claude response as JSON:", jsonStr);
    throw new Error(
      `Failed to parse Claude response as JSON: ${parseError instanceof Error ? parseError.message : "Unknown error"}`
    );
  }

  // Validate and normalize the response
  return {
    isPoRelated: Boolean(parsed.isPoRelated),
    poNumber: parsed.poNumber || null,
    status: validateStatus(parsed.status),
    expectedDate: parsed.expectedDate || null,
    outOfStockItems: Array.isArray(parsed.outOfStockItems)
      ? parsed.outOfStockItems.filter(Boolean)
      : [],
    alternatives: Array.isArray(parsed.alternatives)
      ? parsed.alternatives
          .filter(
            (a) =>
              a && typeof a.original === "string" && typeof a.suggested === "string"
          )
          .map((a) => ({
            original: a.original,
            suggested: a.suggested,
            vendor: a.vendor || "Unknown",
          }))
      : [],
    notes: parsed.notes || null,
  };
}

function validateStatus(
  status: string
): ParsedEmailResult["status"] {
  const validStatuses: ParsedEmailResult["status"][] = [
    "confirmed",
    "partial",
    "rejected",
    "out_of_stock",
    "unknown",
  ];
  return validStatuses.includes(status as ParsedEmailResult["status"])
    ? (status as ParsedEmailResult["status"])
    : "unknown";
}
