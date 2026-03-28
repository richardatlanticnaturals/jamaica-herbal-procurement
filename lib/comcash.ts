/**
 * Comcash Open API V2 Client
 *
 * Two servers exist:
 *   - ssl-api (legacy): uses X_API_KEY header, vendor/list works, product/list needs session_id
 *   - ssl-openapi (V2): uses OPEN_API_KEY + Authorization: Bearer headers, full product access
 *
 * Product/list returns ONE product per call — use offset param to paginate.
 */

const COMCASH_OPENAPI_URL =
  process.env.COMCASH_OPENAPI_URL ||
  "https://ssl-openapi-jamaicanherbal.comcash.com";
const COMCASH_API_URL =
  process.env.COMCASH_API_URL ||
  "https://ssl-api-jamaicanherbal.comcash.com";
const COMCASH_OPENAPI_KEY = process.env.COMCASH_OPENAPI_KEY || "";
const COMCASH_API_KEY = process.env.COMCASH_API_KEY || "";

// --- Types matching actual Comcash V2 responses ---

export interface ComcashVendor {
  id: number;
  name: string;
  phone?: string;
  email?: string;
  billingAddressId?: number;
  employeeId?: number;
  status?: number;
  balance?: string;
  currencyCode?: string;
  created?: number;
  updated?: number;
}

export interface ComcashProduct {
  id: number;
  title: string;
  categoryId?: number;
  typeId?: number;
  price?: string;
  statusId?: number;
  primaryVendorId?: number;
  primaryVendorName?: string;
  weight?: string;
  isEBT?: number;
  isScale?: number;
  size?: string;
  skuCodes?: string[];
  customAttributes?: unknown[];
  modifierGroupIds?: number[];
  vendorProductIds?: unknown[];
  notes?: unknown[];
  created?: number;
  updated?: number;
  qtyUpdated?: number;
}

// --- Request helpers ---

/** Make a request to the ssl-openapi server (V2 — products, full access) */
async function openApiRequest<T>(
  endpoint: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  const url = `${COMCASH_OPENAPI_URL}${endpoint}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      OPEN_API_KEY: COMCASH_OPENAPI_KEY,
      Authorization: `Bearer ${COMCASH_OPENAPI_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Comcash OpenAPI error ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

/** Make a request to the ssl-api server (legacy — vendors) */
async function legacyApiRequest<T>(
  endpoint: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  const url = `${COMCASH_API_URL}${endpoint}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      X_API_KEY: COMCASH_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Comcash API error ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

// --- Public API ---

/**
 * Fetch all vendors from Comcash POS
 * Works on both servers — tries openapi first, falls back to legacy
 */
export async function fetchVendors(): Promise<ComcashVendor[]> {
  try {
    // Try openapi server first
    const response = await openApiRequest<ComcashVendor[] | { data: ComcashVendor[] }>(
      "/vendor/list"
    );
    if (Array.isArray(response)) return response;
    if (response && typeof response === "object" && "data" in response && Array.isArray(response.data)) {
      return response.data;
    }
  } catch {
    // Fall through to legacy
  }

  // Fallback: legacy ssl-api server
  const response = await legacyApiRequest<
    ComcashVendor[] | { status: string; data: ComcashVendor[] }
  >("/vendor/list");

  if (Array.isArray(response)) return response;
  if (response && typeof response === "object" && "data" in response && Array.isArray(response.data)) {
    return response.data;
  }

  console.warn("Unexpected Comcash vendor response format");
  return [];
}

/**
 * Fetch all products from Comcash via the OpenAPI V2 server.
 *
 * The API returns ONE product per call, so we iterate using offset.
 * ~3,500 products takes about 5-7 minutes with parallel batching.
 *
 * @param onProgress - Optional callback for progress updates
 * @param concurrency - Number of parallel requests (default 10)
 */
export async function fetchAllProducts(
  onProgress?: (fetched: number) => void,
  concurrency = 10
): Promise<ComcashProduct[]> {
  const products: ComcashProduct[] = [];
  let offset = 0;
  let consecutiveEmpty = 0;
  const maxEmpty = 5; // Stop after 5 consecutive empty responses

  while (consecutiveEmpty < maxEmpty) {
    // Fetch a batch of products in parallel
    const promises: Promise<ComcashProduct | null>[] = [];

    for (let i = 0; i < concurrency; i++) {
      const currentOffset = offset + i;
      promises.push(fetchSingleProduct(currentOffset));
    }

    const results = await Promise.all(promises);

    let batchHasProduct = false;
    for (const product of results) {
      if (product) {
        products.push(product);
        batchHasProduct = true;
        consecutiveEmpty = 0;
      }
    }

    if (!batchHasProduct) {
      consecutiveEmpty++;
    }

    offset += concurrency;

    if (onProgress) {
      onProgress(products.length);
    }
  }

  return products;
}

/**
 * Fetch a single product by offset index
 */
async function fetchSingleProduct(offset: number): Promise<ComcashProduct | null> {
  try {
    const response = await openApiRequest<ComcashProduct | { errorCode: number }>(
      "/product/list",
      {
        salesOutletId: "1",
        offset: String(offset),
        limit: "20",
        sort: "title",
        order: "asc",
      }
    );

    // Check if it's a valid product (has an id field)
    if (response && typeof response === "object" && "id" in response && response.id) {
      return response as ComcashProduct;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch a single product by SKU
 */
export async function fetchProductBySku(sku: string): Promise<ComcashProduct | null> {
  try {
    const response = await openApiRequest<ComcashProduct | { errorCode: number }>(
      "/product/list",
      {
        salesOutletId: "1",
        search: sku,
      }
    );

    if (response && typeof response === "object" && "id" in response && response.id) {
      return response as ComcashProduct;
    }

    return null;
  } catch {
    return null;
  }
}
