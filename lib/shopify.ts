/**
 * Shopify Admin API client for inventory sync.
 * Uses REST Admin API with X-Shopify-Access-Token header.
 *
 * Env vars required:
 *   SHOPIFY_STORE  — e.g. "jamaican-herbal.myshopify.com"
 *   SHOPIFY_ACCESS_TOKEN — Admin API access token (shpat_...)
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

// -- Shopify REST response types --

interface ShopifyProduct {
  id: number;
  variants: ShopifyVariant[];
}

interface ShopifyVariant {
  id: number;
  sku: string;
  inventory_item_id: number;
}

interface ShopifyInventoryLevel {
  inventory_item_id: number;
  location_id: number;
  available: number | null;
}

// -- Internal result types --

export interface InventorySyncResult {
  sku: string;
  success: boolean;
  shopifyInventoryItemId?: number;
  previousQty?: number | null;
  newQty?: number;
  error?: string;
}

/**
 * Find a Shopify inventory_item_id by SKU.
 * Searches products by SKU using the variant SKU field.
 */
async function findInventoryItemBySku(
  sku: string
): Promise<{ inventoryItemId: number; locationId: number } | null> {
  const baseUrl = getBaseUrl();
  const headers = getHeaders();

  // Step 1: Search for the product variant by SKU
  // Shopify doesn't have a direct "search by SKU" for inventory items,
  // so we search products and filter by variant SKU.
  const searchUrl = `${baseUrl}/products.json?fields=id,variants&limit=250`;
  let cursor: string | null = null;
  let found: ShopifyVariant | null = null;

  // Paginate through products to find the SKU
  let url = searchUrl;
  while (!found) {
    if (cursor) {
      url = `${baseUrl}/products.json?fields=id,variants&limit=250&page_info=${cursor}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify products search failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { products: ShopifyProduct[] };
    for (const product of data.products) {
      const variant = product.variants.find(
        (v) => v.sku && v.sku.toLowerCase() === sku.toLowerCase()
      );
      if (variant) {
        found = variant;
        break;
      }
    }

    // Check for pagination via Link header
    const linkHeader = res.headers.get("link");
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/page_info=([^>&]+).*rel="next"/);
      cursor = match ? match[1] : null;
    } else {
      break; // No more pages
    }
  }

  if (!found) return null;

  // Step 2: Get the location for this inventory item
  const levelsUrl = `${baseUrl}/inventory_levels.json?inventory_item_ids=${found.inventory_item_id}`;
  const levelsRes = await fetch(levelsUrl, { headers });
  if (!levelsRes.ok) {
    const text = await levelsRes.text();
    throw new Error(
      `Shopify inventory_levels fetch failed (${levelsRes.status}): ${text}`
    );
  }

  const levelsData = (await levelsRes.json()) as {
    inventory_levels: ShopifyInventoryLevel[];
  };

  // Use the first location (primary location)
  const level = levelsData.inventory_levels[0];
  if (!level) return null;

  return {
    inventoryItemId: found.inventory_item_id,
    locationId: level.location_id,
  };
}

/**
 * Update the available inventory for a single SKU in Shopify.
 * Uses the "set" endpoint to set an absolute quantity.
 */
export async function updateInventoryLevel(
  sku: string,
  quantity: number
): Promise<InventorySyncResult> {
  try {
    const baseUrl = getBaseUrl();
    const headers = getHeaders();

    const item = await findInventoryItemBySku(sku);
    if (!item) {
      return { sku, success: false, error: `SKU "${sku}" not found in Shopify` };
    }

    // Use the inventory_levels/set endpoint to set absolute quantity
    const setUrl = `${baseUrl}/inventory_levels/set.json`;
    const res = await fetch(setUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        location_id: item.locationId,
        inventory_item_id: item.inventoryItemId,
        available: quantity,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        sku,
        success: false,
        shopifyInventoryItemId: item.inventoryItemId,
        error: `Shopify set inventory failed (${res.status}): ${text}`,
      };
    }

    const result = (await res.json()) as {
      inventory_level: ShopifyInventoryLevel;
    };

    return {
      sku,
      success: true,
      shopifyInventoryItemId: item.inventoryItemId,
      newQty: result.inventory_level.available ?? quantity,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { sku, success: false, error: message };
  }
}

/**
 * Sync multiple inventory items to Shopify in sequence.
 * Shopify REST API has rate limits (~2 req/sec) so we process one at a time.
 * Returns results for each item.
 */
export async function syncAllInventory(
  items: { sku: string; qty: number }[]
): Promise<InventorySyncResult[]> {
  const results: InventorySyncResult[] = [];

  for (const item of items) {
    const result = await updateInventoryLevel(item.sku, item.qty);
    results.push(result);

    // Respect Shopify rate limits — small delay between requests
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return results;
}
