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
 * Sends a base64-encoded image or PDF to Claude Vision and extracts
 * structured delivery slip data.
 *
 * Supports both images (JPEG, PNG, GIF, WEBP) and PDF documents.
 * For PDFs, uses Claude's document content block type.
 */
export async function ocrDeliverySlip(
  base64Data: string
): Promise<OcrDeliveryResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  // Detect if this is a PDF or image from the data-url prefix
  const isPdf = base64Data.startsWith("data:application/pdf");

  // Build the appropriate content block for Claude API
  let contentBlock: Record<string, unknown>;

  if (isPdf) {
    // PDF: use document content block type
    const pdfRawData = base64Data.replace(/^data:application\/pdf;base64,/, "");
    contentBlock = {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: pdfRawData,
      },
    };
  } else {
    // Image: use image content block type
    const imageData = base64Data.replace(/^data:image\/\w+;base64,/, "");

    // Detect media type from the data-url prefix, default to jpeg
    let mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" =
      "image/jpeg";
    const prefixMatch = base64Data.match(/^data:(image\/\w+);base64,/);
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

    contentBlock = {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data: imageData,
      },
    };
  }

  // Try Sonnet first, fall back to Haiku if overloaded
  const models = ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"];
  const maxRetries = 2;
  let response: Response | null = null;
  let lastError = "";

  for (const model of models) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 2000));
        console.log(`[OCR] Retry ${model} attempt ${attempt + 1}...`);
      }

      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2025-04-15",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: [
                contentBlock,
                {
                  type: "text",
                  text: isPdf
                    ? "Extract all delivery/invoice information from this PDF document. Return ONLY the JSON object, no markdown fences."
                    : "Extract all delivery/invoice information from this image. Return ONLY the JSON object, no markdown fences.",
                },
              ],
            },
          ],
          system: SYSTEM_PROMPT,
        }),
      });

      if (response.ok) {
        console.log(`[OCR] Success with ${model}`);
        break;
      }

      lastError = await response.text();
      console.error(`[OCR] ${model} error (attempt ${attempt + 1}):`, response.status);

      if (response.status !== 429 && response.status !== 529 && response.status !== 500) break;
    }

    if (response?.ok) break;
    console.log(`[OCR] ${model} failed, trying next model...`);
  }

  if (!response || !response.ok) {
    throw new Error(`Claude API error: ${response?.status || "unknown"} after ${maxRetries} attempts`);
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
    // Try one more cleanup: remove any leading/trailing non-JSON characters
    const cleanMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (cleanMatch) {
      try {
        parsed = JSON.parse(cleanMatch[0]);
      } catch {
        console.error("[OCR] Failed to parse OCR JSON after cleanup. Raw text:", rawText.substring(0, 500));
        throw new Error("Failed to parse OCR response as JSON");
      }
    } else {
      console.error("[OCR] No JSON object found in response. Raw text:", rawText.substring(0, 500));
      throw new Error("Failed to parse OCR response as JSON");
    }
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
