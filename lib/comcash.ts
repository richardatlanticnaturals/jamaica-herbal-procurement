/**
 * Comcash Employee API Client
 *
 * Uses the Employee API (ssl-openapi) with JWT authentication.
 * Flow: POST /employee/auth/signin -> get JWT token -> use token for all subsequent requests.
 * JWT tokens expire based on the `expiresIn` field in the auth response.
 */

const COMCASH_OPENAPI_URL =
  process.env.COMCASH_OPENAPI_URL ||
  "https://ssl-openapi-jamaicanherbal.comcash.com";
const COMCASH_OPENAPI_KEY = process.env.COMCASH_OPENAPI_KEY || "";
const COMCASH_EMPLOYEE_PIN = process.env.COMCASH_EMPLOYEE_PIN || "";
const COMCASH_EMPLOYEE_PASSWORD = process.env.COMCASH_EMPLOYEE_PASSWORD || "";

// --- JWT Token Cache ---

interface TokenCache {
  token: string;
  expiresAt: number; // Unix timestamp in ms
}

let cachedToken: TokenCache | null = null;

// --- Types matching Comcash Employee API responses ---

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
  lastCost?: string;
  statusId?: number;
  primaryVendorId?: number;
  primaryVendorName?: string;
  vendorId?: number;
  weight?: string;
  isEBT?: number;
  isScale?: number;
  size?: string;
  skuCodes?: string[];
  onHand?: number;
  customAttributes?: unknown[];
  modifierGroupIds?: number[];
  vendorProductIds?: unknown[];
  notes?: unknown[];
  created?: number;
  updated?: number;
  qtyUpdated?: number;
}

export interface ComcashAuthResponse {
  token: string;
  expiresIn: number; // seconds until expiry
  employeeId?: number;
  employeeName?: string;
}

export interface ComcashProductListResponse {
  data: ComcashProduct[];
  total?: number;
  offset?: number;
  limit?: number;
}

// --- Authentication ---

/**
 * Authenticate with the Comcash Employee API.
 * Caches the JWT token and auto-refreshes when expired.
 * Returns the JWT bearer token string.
 */
export async function authenticateEmployee(): Promise<string> {
  // Return cached token if still valid (with 60s safety margin)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const url = `${COMCASH_OPENAPI_URL}/employee/auth/signin`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      openApiKey: COMCASH_OPENAPI_KEY,
      pin: COMCASH_EMPLOYEE_PIN,
      password: COMCASH_EMPLOYEE_PASSWORD,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    cachedToken = null;
    throw new Error(
      `Comcash Employee auth failed (${res.status}): ${text.slice(0, 300)}`
    );
  }

  const data = await res.json();

  // The response may return the token at top level or nested
  const token = data.token || data.accessToken || data.access_token;
  const expiresIn = data.expiresIn || data.expires_in || 3600; // default 1hr

  if (!token) {
    throw new Error(
      `Comcash Employee auth: no token in response. Keys: ${Object.keys(data).join(", ")}`
    );
  }

  cachedToken = {
    token,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  console.log(
    `[Comcash] Employee authenticated. Token expires in ${expiresIn}s`
  );

  return cachedToken.token;
}

/**
 * Test whether the Comcash Employee API credentials are working.
 * Returns true if auth succeeds, false otherwise.
 */
export async function testConnection(): Promise<boolean> {
  try {
    await authenticateEmployee();
    return true;
  } catch {
    return false;
  }
}

// --- Authenticated request helper ---

/**
 * Make an authenticated request to the Comcash Employee API.
 * Auto-acquires/refreshes the JWT token.
 */
async function employeeApiRequest<T>(
  endpoint: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  const token = await authenticateEmployee();
  const url = `${COMCASH_OPENAPI_URL}${endpoint}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();

    // If 401/403, clear cached token so next call re-authenticates
    if (res.status === 401 || res.status === 403) {
      cachedToken = null;
    }

    throw new Error(
      `Comcash Employee API error ${res.status} on ${endpoint}: ${text.slice(0, 300)}`
    );
  }

  return res.json() as Promise<T>;
}

// --- Public API ---

/**
 * Fetch vendors from Comcash POS via the Employee API.
 */
export async function fetchVendors(): Promise<ComcashVendor[]> {
  const response = await employeeApiRequest<
    ComcashVendor[] | { data: ComcashVendor[] }
  >("/employee/product/vendors");

  if (Array.isArray(response)) return response;
  if (
    response &&
    typeof response === "object" &&
    "data" in response &&
    Array.isArray(response.data)
  ) {
    return response.data;
  }

  console.warn("[Comcash] Unexpected vendor response format:", typeof response);
  return [];
}

/**
 * Fetch a paginated batch of products from Comcash via the Employee API.
 * @param offset - Starting index
 * @param limit - Number of products to return (max 100)
 */
export async function fetchProducts(
  offset: number = 0,
  limit: number = 100
): Promise<{ products: ComcashProduct[]; total: number }> {
  const response = await employeeApiRequest<
    ComcashProductListResponse | ComcashProduct[] | ComcashProduct
  >("/employee/product/list", {
    offset,
    limit,
    sort: "title",
    order: "asc",
    warehouseIds: [1, 2, 3], // Required to get onHand stock data
  });

  // Handle various response shapes the API might return
  if (Array.isArray(response)) {
    // Don't use array length as total — it's just the batch size.
    // Return -1 to signal "unknown total" so pagination continues until an empty batch.
    return { products: response, total: -1 };
  }

  if (
    response &&
    typeof response === "object" &&
    "data" in response &&
    Array.isArray((response as ComcashProductListResponse).data)
  ) {
    const r = response as ComcashProductListResponse;
    return { products: r.data, total: r.total || r.data.length };
  }

  // Single product response (old API behavior)
  if (response && typeof response === "object" && "id" in response) {
    return { products: [response as ComcashProduct], total: 1 };
  }

  return { products: [], total: 0 };
}

/**
 * Fetch all products from Comcash via the Employee API.
 * Paginates through all results (100 per call).
 *
 * @param onProgress - Optional callback for progress updates
 */
export async function fetchAllProducts(
  onProgress?: (fetched: number) => void
): Promise<ComcashProduct[]> {
  const allProducts: ComcashProduct[] = [];
  const limit = 100;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { products, total } = await fetchProducts(offset, limit);

    if (products.length === 0) {
      // No more products
      hasMore = false;
      break;
    }

    allProducts.push(...products);
    offset += products.length;

    if (onProgress) {
      onProgress(allProducts.length);
    }

    // Stop if we got fewer than requested (last page) or reached known total
    if (products.length < limit) {
      hasMore = false;
    } else if (total > 0 && offset >= total) {
      hasMore = false;
    }
  }

  return allProducts;
}

/**
 * Search for a product by barcode/SKU via the Employee API.
 */
export async function fetchProductByBarcode(
  barcode: string
): Promise<ComcashProduct | null> {
  try {
    const response = await employeeApiRequest<
      ComcashProduct | ComcashProduct[] | { data: ComcashProduct[] }
    >("/employee/product/searchByBarcode", {
      barcode,
    });

    // Single product
    if (
      response &&
      typeof response === "object" &&
      "id" in response &&
      !Array.isArray(response)
    ) {
      return response as ComcashProduct;
    }

    // Array of products
    if (Array.isArray(response) && response.length > 0) {
      return response[0];
    }

    // Wrapped response
    if (
      response &&
      typeof response === "object" &&
      "data" in response &&
      Array.isArray((response as { data: ComcashProduct[] }).data)
    ) {
      const items = (response as { data: ComcashProduct[] }).data;
      return items.length > 0 ? items[0] : null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Push inventory quantity changes back to Comcash POS.
 * Uses the warehouse/changeQuantity endpoint.
 *
 * @param items - Array of { productId, warehouseId, quantity } objects
 * @returns Number of items successfully updated
 */
export async function updateInventory(
  items: Array<{
    productId: number;
    warehouseId?: number;
    quantity: number;
  }>
): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  // Process in batches of 25 to avoid overloading the API
  const batchSize = 25;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    for (const item of batch) {
      try {
        await employeeApiRequest("/employee/warehouse/changeQuantity", {
          productId: item.productId,
          warehouseId: item.warehouseId || 1, // Default warehouse
          quantity: item.quantity,
        });
        updated++;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Unknown error";
        errors.push(
          `Product ${item.productId}: ${msg}`
        );
      }
    }
  }

  return { updated, errors };
}

/**
 * Fetch a single product by SKU (legacy compat — searches by barcode internally).
 */
export async function fetchProductBySku(
  sku: string
): Promise<ComcashProduct | null> {
  return fetchProductByBarcode(sku);
}
