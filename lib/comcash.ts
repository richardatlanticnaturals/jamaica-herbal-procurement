const COMCASH_API_URL =
  process.env.COMCASH_API_URL ||
  "https://ssl-api-jamaicanherbal.comcash.com";
const COMCASH_API_KEY = process.env.COMCASH_API_KEY || "";

export interface ComcashVendor {
  vendor_id: number;
  vendor_name: string;
  phone?: string;
  email?: string;
  contact_name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  is_active?: boolean;
}

export interface ComcashProduct {
  product_id: number;
  product_name: string;
  sku?: string;
  barcode?: string;
  price?: number;
  cost?: number;
  vendor_id?: number;
  category?: string;
  qty_on_hand?: number;
}

interface ComcashResponse<T> {
  status: string;
  data: T[];
  message?: string;
}

async function comcashRequest<T>(
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
    throw new Error(
      `Comcash API error ${res.status}: ${text}`
    );
  }

  return res.json() as Promise<T>;
}

/**
 * Fetch all vendors from Comcash POS
 */
export async function fetchVendors(): Promise<ComcashVendor[]> {
  const response = await comcashRequest<ComcashResponse<ComcashVendor>>(
    "/vendor/list"
  );

  // Handle both array response and wrapped response
  if (Array.isArray(response)) {
    return response;
  }

  if (response.data && Array.isArray(response.data)) {
    return response.data;
  }

  // If the response is an object with vendor entries
  if (typeof response === "object" && response !== null) {
    const values = Object.values(response);
    if (values.length > 0 && Array.isArray(values[0])) {
      return values[0] as ComcashVendor[];
    }
  }

  console.warn("Unexpected Comcash vendor response format:", typeof response);
  return [];
}

/**
 * Fetch all products from Comcash POS (for future use)
 */
export async function fetchProducts(
  sessionId?: string
): Promise<ComcashProduct[]> {
  const body: Record<string, unknown> = {};
  if (sessionId) {
    body.session_id = sessionId;
  }

  const response = await comcashRequest<ComcashResponse<ComcashProduct>>(
    "/product/list",
    body
  );

  if (Array.isArray(response)) {
    return response;
  }

  if (response.data && Array.isArray(response.data)) {
    return response.data;
  }

  if (typeof response === "object" && response !== null) {
    const values = Object.values(response);
    if (values.length > 0 && Array.isArray(values[0])) {
      return values[0] as ComcashProduct[];
    }
  }

  console.warn("Unexpected Comcash product response format:", typeof response);
  return [];
}
