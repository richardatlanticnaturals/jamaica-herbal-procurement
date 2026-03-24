/**
 * OCR Delivery Slip — Uses Claude Vision to extract structured data
 * from a photo of a delivery slip / invoice.
 */

export interface OcrItem {
  name: string;
  qty: number;
  unitPrice: number | null;
  sku: string | null;
}

export interface OcrDeliveryResult {
  vendorName: string | null;
  invoiceNumber: string | null;
  date: string | null;
  items: OcrItem[];
}

const SYSTEM_PROMPT = `You are an expert at reading delivery slips, invoices, and packing lists for a herbal/natural products store. Extract structured information from the image provided.

Return ONLY valid JSON with this exact structure (no markdown, no explanation):
{
  "vendorName": "string or null",
  "invoiceNumber": "string or null",
  "date": "string in YYYY-MM-DD format or null",
  "items": [
    {
      "name": "product name as written",
      "qty": number,
      "unitPrice": number or null,
      "sku": "string or null"
    }
  ]
}

Rules:
- Extract the vendor/supplier name from the header or letterhead
- Extract the invoice/delivery number
- Extract the date (convert to YYYY-MM-DD)
- For each line item, extract the product name, quantity, unit price, and SKU/code
- If a value is not visible or unclear, use null
- Quantities must be positive integers; if unclear default to 1
- Unit prices should be decimal numbers (e.g. 12.50)
- Clean up OCR artifacts in product names (fix obvious misspellings)
- Do NOT invent data — only extract what is visible in the image`;

/**
 * Sends a base64-encoded image to Claude Vision and extracts
 * structured delivery slip data.
 */
export async function ocrDeliverySlip(
  base64Image: string
): Promise<OcrDeliveryResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  // Strip data-url prefix if present
  const imageData = base64Image.replace(/^data:image\/\w+;base64,/, "");

  // Detect media type from the data-url prefix, default to jpeg
  let mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" =
    "image/jpeg";
  const prefixMatch = base64Image.match(/^data:(image\/\w+);base64,/);
  if (prefixMatch) {
    const detected = prefixMatch[1] as string;
    if (
      detected === "image/png" ||
      detected === "image/gif" ||
      detected === "image/webp"
    ) {
      mediaType = detected;
    }
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: imageData,
              },
            },
            {
              type: "text",
              text: "Extract all delivery/invoice information from this image. Return ONLY the JSON object, no markdown fences.",
            },
          ],
        },
      ],
      system: SYSTEM_PROMPT,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    console.error("Claude API error:", response.status, errBody);
    throw new Error(`Claude API error: ${response.status}`);
  }

  const data = await response.json();

  // Extract text content from the response
  const textBlock = data.content?.find(
    (block: { type: string }) => block.type === "text"
  );
  if (!textBlock?.text) {
    throw new Error("No text content in Claude response");
  }

  const rawText: string = textBlock.text.trim();

  // Try to parse JSON — handle cases where Claude wraps in markdown fences
  let jsonStr = rawText;
  const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  let parsed: OcrDeliveryResult;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.error("Failed to parse OCR JSON:", jsonStr);
    throw new Error("Failed to parse OCR response as JSON");
  }

  // Validate and sanitize the result
  return {
    vendorName: parsed.vendorName ?? null,
    invoiceNumber: parsed.invoiceNumber ?? null,
    date: parsed.date ?? null,
    items: Array.isArray(parsed.items)
      ? parsed.items.map((item) => ({
          name: String(item.name || "Unknown Item"),
          qty:
            typeof item.qty === "number" && item.qty > 0
              ? Math.round(item.qty)
              : 1,
          unitPrice:
            typeof item.unitPrice === "number" ? item.unitPrice : null,
          sku: item.sku ? String(item.sku) : null,
        }))
      : [],
  };
}
