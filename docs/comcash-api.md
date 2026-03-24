# Comcash Open API V2 — Documentation

Source: https://documenter.getpostman.com/view/4664787/S17m1C8N#intro

Base URL: `https://admin-jamaicanherbal.comcash.com` (needs confirmation — may be a separate API subdomain)

## Authentication

All endpoints require JWT token via `Authorization: Bearer {{jwt}}` header.

### POST /auth/signin
Sign in to get JWT token.
```json
{
  "openApiKey": "{{openApiKey}}",
  "salesOutletId": "54",
  "customSalesOutletId": "5",
  "phone": "660829802",
  "password": "123456"
}
```

### POST /auth/signup
Create new user account.
```json
{
  "openApiKey": "{{openApiKey}}",
  "salesOutletId": "5",
  "customSalesOutletId": "5",
  "firstName": "Test",
  "lastName": "User",
  "email": "testuser@test.com",
  "phone": "1234567",
  "countryPhoneCode": "+1",
  "password": "123456",
  "repeatPassword": "123456"
}
```

### POST /auth/regenerate-token
Regenerate JWT token when switching sales outlet.
```json
{
  "customSalesOutletId": 2
}
```
Headers: `Authorization: Bearer {{jwt}}`

### POST /auth/verify-customer
Generate JWT from access token (for POS customers without password).
```json
{
  "openApiKey": "{{openApiKey}}",
  "salesOutletId": "5",
  "customSalesOutletId": 2,
  "customerId": "11911",
  "accessToken": "w7wbsrkxntawcpmuw5~u4f6u"
}
```

---

## Product Endpoints

### POST /product/view
View a single product by ID.
```json
{
  "productId": "1411"
}
```

### POST /product/list
Get paginated list of products with filters.
```json
{
  "categoryId": "2",
  "brandIds": ["1"],
  "priceFrom": "0.01",
  "priceTo": "20.00",
  "customAttributes": [
    { "id": "1", "value": "2015" },
    { "id": "1", "value": "2016" }
  ],
  "offset": "0",
  "limit": "20",
  "sort": "title",
  "order": "asc"
}
```

### POST /product/search
Search products by title.
```json
{
  "q": "am",
  "offset": "0",
  "limit": "20",
  "sort": "title",
  "order": "asc"
}
```

### POST /product/favorites
Get favorite products. No body required.

### POST /product/archive
Get archived products. No body required.

### POST /product/raw
Get raw product data. No body required.

---

## Vendor Endpoints

### POST /vendor/list
Get list of vendors. No body shown in docs (likely supports limit/offset).

---

## Purchase Order Endpoints

### POST /purchase-order/list
Get purchase orders.
```json
{
  "stockLocationId": "2",
  "limit": "100",
  "offset": "0",
  "order": "asc",
  "status": "1"
}
```

---

## Report Endpoints

### POST /report/list
Get reports.
```json
{
  "limit": "100",
  "offset": "0",
  "order": "asc"
}
```

---

## Sale Endpoints

### POST /sale/list
Get sales history.
```json
{
  "limit": "100",
  "offset": "0",
  "employeeId": "29",
  "customerId": "492",
  "id": 13215,
  "timeFrom": "1552870800",
  "timeTo": "1553526000",
  "status": "1",
  "order": "asc"
}
```

---

## Other Endpoints (available in sidebar)
- **Attribute Group** — product attributes
- **Brand** — brand management
- **Category** — category management
- **Card on File** — saved payment cards
- **Cart** — shopping cart
- **Checkout** — checkout flow
- **Customer** — customer management
- **Custom Attribute** — custom product attributes
- **Gift Card** — gift card management
- **Measure Unit** — units of measure
- **Menu** — menu management
- **Modifier / Modifier Group** — product modifiers
- **Page** — custom pages
- **Sales Outlet** — store locations
- **Tax** — tax configuration

---

## Required Environment Variables
- `openApiKey` — API key from Comcash (need to get from Settings or POS Nation support)
- `url` — Base API URL (e.g., `https://admin-jamaicanherbal.comcash.com` or separate API domain)
- `jwt` — JWT token obtained from /auth/signin

## Notes
- All requests are POST with JSON body
- All authenticated endpoints need `Authorization: Bearer {{jwt}}`
- Pagination uses `offset` and `limit` (not page numbers)
- Sales outlet IDs: 1 = Jamaica Herbal - Lauderdale Lakes, 2 = Shopify, 3 = Shopify (Jamaican Herbal)
