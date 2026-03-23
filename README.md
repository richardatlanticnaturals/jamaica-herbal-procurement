# Jamaica Herbal Procurement System

AI-powered purchase order management for Jamaica Herbal stores.

## What This App Does

1. **Inventory Sync** — Pull inventory from Comcash POS (CSV import now, API later)
2. **Auto-Generate POs** — When items hit reorder points, auto-create purchase orders grouped by vendor
3. **AI Agent Ordering** — Email vendors or place orders on vendor portals automatically
4. **OCR Receiving** — Photograph delivery slips, AI reads them and matches against POs
5. **Out-of-Stock Handling** — Detect OOS from vendor emails, suggest alternative products
6. **Shopify Sync** — Keep online store inventory accurate

## Tech Stack

- **Frontend:** Next.js 14 (App Router) + Tailwind CSS + shadcn/ui
- **Backend:** Next.js API Routes on Vercel (serverless)
- **Database:** PostgreSQL on Neon (free tier)
- **ORM:** Prisma 7
- **Auth:** NextAuth.js + Google OAuth (restricted to jamaicanherbal@gmail.com)
- **AI/OCR:** Claude API (Vision + Text)
- **Email:** Gmail API
- **Estimated cost:** $5-40/month

## Current Progress

### Phase 1: Foundation — DONE
- [x] Next.js 14 + Tailwind + shadcn/ui scaffold
- [x] Prisma schema (13 models: Vendor, InventoryItem, PurchaseOrder, POLineItem, Receiving, ReceivingLineItem, AlternativeProduct, POStatusLog, AppSettings + auth models)
- [x] NextAuth.js with Google OAuth
- [x] Sidebar navigation (Dashboard, Inventory, Vendors, POs, Receiving, Alerts, Settings)
- [x] Dashboard page with KPI cards and quick actions
- [x] Inventory page with CSV import from Comcash
- [x] Vendor CRUD with dialog form (email, portal, phone order methods)
- [x] API routes: /api/vendors, /api/inventory, /api/inventory/import
- [x] PO, Receiving, Alerts, Settings page stubs
- [x] Build passes cleanly

### Phase 2: Purchase Orders — TODO (Week 3-4)
- [ ] PO auto-generation from low-stock items (group by vendor)
- [ ] Gmail API integration (OAuth flow in Settings)
- [ ] PO email sending (Claude composes professional email body)
- [ ] PO PDF generation
- [ ] Approval workflow (review drafts > approve > send)

### Phase 3: Email Parsing — TODO (Week 5-6)
- [ ] Vercel Cron polls Gmail every 30 min
- [ ] Claude parses vendor replies (confirmations, ETAs, OOS)
- [ ] Auto-update PO status from email content
- [ ] In-app notifications

### Phase 4: OCR Receiving — TODO (Week 7-8)
- [ ] Camera/photo upload (mobile-friendly)
- [ ] Claude Vision OCR + structured extraction
- [ ] Fuzzy matching (OCR items to PO line items)
- [ ] Side-by-side review UI with confidence scores
- [ ] Receiving confirmation updates inventory + Shopify

### Phase 5: OOS Intelligence — TODO (Week 9-10)
- [ ] OOS detection in email parser
- [ ] Claude-powered alternative product suggestions
- [ ] Alerts page with action buttons
- [ ] Alternative ordering flow

### Phase 6: Vendor Portal Automation — OPTIONAL
- [ ] Puppeteer on Railway for vendor website ordering

### Phase 7: Comcash Live Sync — WHEN API AVAILABLE
- [ ] Replace CSV with live API sync

## Setup Instructions

### 1. Create Neon Database (free)
- Go to https://neon.tech and create a free account
- Create a new project, copy the connection string

### 2. Google OAuth Credentials
- Go to https://console.cloud.google.com
- Create a new project or use existing
- Enable "Google+ API" or "People API"
- Create OAuth 2.0 credentials (Web application)
- Add redirect URI: `http://localhost:3000/api/auth/callback/google`
- Copy Client ID and Client Secret

### 3. Configure Environment
```bash
cp .env.example .env
# Fill in: DATABASE_URL, NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
```

### 4. Run Database Migrations
```bash
npx prisma migrate dev --name init
```

### 5. Start Dev Server
```bash
npm run dev
```

App runs at http://localhost:3000

## Architecture

```
Standalone Web App (Next.js on Vercel)
    |
Next.js API Layer (serverless)
    |
    +-- Comcash POS (CSV import now, API later)
    +-- Shopify Admin API (inventory sync)
    +-- Claude API (OCR, email parsing, suggestions)
    +-- Gmail API (send POs, read confirmations)
    +-- PostgreSQL on Neon (via Prisma)
```

## App Pages

| Page | Route | Status |
|------|-------|--------|
| Dashboard | `/` | Built |
| Inventory | `/inventory` | Built (with CSV import) |
| Vendors | `/vendors` | Built (CRUD + dialog) |
| Purchase Orders | `/po` | Stub (Phase 2) |
| Receiving | `/receiving` | Stub (Phase 4) |
| Alerts | `/alerts` | Stub (Phase 5) |
| Settings | `/settings` | Stub |
| Login | `/login` | Built (Google OAuth) |

## Key Design Decisions

- **Standalone app** (not embedded in Shopify) — simpler, faster to build, no app review
- **Google Sign-In** — one click login with jamaicanherbal@gmail.com, no extra passwords
- **CSV-first for Comcash** — works immediately, API ready when Comcash provides access
- **Claude Vision for OCR** — handles OCR + structured extraction in one API call
- **Gmail API** (not SMTP) — can both send POs and read vendor replies
- **Single-tenant** — built for Jamaica Herbal only, no multi-tenant complexity
