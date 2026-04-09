# Comcash API Rules

## CRITICAL: Which Endpoints to Use

The Comcash server has TWO API layers. Using the wrong one returns empty data.

### Employee API (prefix: /employee/)
Use for: Products, Vendors, Categories, Warehouse, Auth

| Action | Endpoint | Method |
|--------|----------|--------|
| Auth (get JWT) | `/employee/auth/signin` | POST |
| Product list (paginated) | `/employee/product/list` | POST |
| Product view | `/employee/product/view` | POST |
| Product categories | `/employee/product/categories` | POST |
| Product vendors | `/employee/product/vendors` | POST |
| Search by barcode | `/employee/product/searchByBarcode` | POST |
| Update inventory | `/employee/warehouse/changeQuantity` | POST |

**Auth:** Body `{ openApiKey, pin, password }` → returns `{ accessToken }`
**Headers:** `Authorization: Bearer {jwt}` + `Content-Type: application/json`
**Product list MUST include:** `warehouseIds: [1, 2, 3]` to get onHand stock data
**onHand format:** Array of `[{ warehouseId, quantity: "7.0000" }]` — SUM all quantities

### V2 API (NO prefix)
Use for: Sales data ONLY

| Action | Endpoint | Method |
|--------|----------|--------|
| Sale list | `/sale/list` | POST |
| Report list | `/report/list` | POST |

**Headers:** `OPEN_API_KEY: {key}` + `Authorization: Bearer {jwt}` + `Content-Type: application/json`
**Body:** `{ limit: 100, offset: 0, order: "desc" }` (numbers, not strings)

### DO NOT USE
- `/employee/sale/list` — Returns EMPTY. Always use `/sale/list` (no employee prefix)
- `/purchase-order/list` — 404 (not installed)
- `/inventory/update` — 404 (use warehouse/changeQuantity instead)
- `/product/list` without JWT — returns only 1 product

## Authentication

```
POST /employee/auth/signin
{
  "openApiKey": "MMRPVknvbX32oyzC",
  "pin": "1111",
  "password": "Richie.001"
}
→ { "accessToken": "eyJ...", "expiresIn": 1775604317 }
```

JWT tokens expire. Cache and refresh before expiry (60s safety margin).

## Environment Variables
- `COMCASH_OPENAPI_URL` = https://ssl-openapi-jamaicanherbal.comcash.com
- `COMCASH_OPENAPI_KEY` = MMRPVknvbX32oyzC
- `COMCASH_EMPLOYEE_PIN` = 1111
- `COMCASH_EMPLOYEE_PASSWORD` = Richie.001

## Key Gotchas
1. `onHand` is an ARRAY, not a number. Sum `quantity` across all warehouses.
2. Sales endpoint is `/sale/list` (V2), NOT `/employee/sale/list` (empty).
3. `qtyUpdated` on products is NOT reliable for sales tracking — only updates on manual stock adjustments.
4. `limit`/`offset` should be numbers, not strings.
5. The Employee API needs JWT from `/employee/auth/signin`. The V2 endpoints need both `OPEN_API_KEY` header AND JWT.
