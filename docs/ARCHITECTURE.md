# Architecture

## Components

```
 Customer web / Expo app        Seller portal + POS        Staff / Rider / Compliance / Admin
          │                            │                                │
          ├──── Firebase Auth (phone OTP / anonymous) ──────────────────┤
          │                            │                                │
          ▼                            ▼                                ▼
 ┌──────────────────────────── Cloudflare Worker (edge/worker) ───────────────────────────┐
 │ verify Firebase ID token (RS256 / Google JWKS) · App Check · Turnstile · rate limits    │
 │ HMAC-SHA256 store QR tokens · counter checkout tokens · KV replay guard                 │
 └───────────────┬─────────────────────────────────────────────┬──────────────────────────┘
                 │ HMAC-signed call                             │ Firestore REST with the
                 ▼                                              ▼ caller's own ID token
        Cloud Functions v2 (Admin SDK)  ◄──────────────►  Firestore (rules = zero trust)
        roles · QR sessions · Phase 2:                    Storage (rules)
        stock transactions, billing, orders
                 │
                 ▼
      Service Adapter Layer (services/adapters) — Payment · Geo · Auth · GST (mocks now)
```

Clients read Firestore directly (fast, offline-capable, real-time) but can only
write the few fields the rules allow. Anything involving money, tax or stock
goes through a Cloud Function running a Firestore transaction.

## Roles (custom claims only)

| Role | Claims | Can |
|---|---|---|
| `super_admin` | `role` | Everything via functions; edit stores, zones, HSN master directly (audited) |
| `seller` | `role, vendorId, storeIds[]` (empty = all stores of vendor) | Own vendor's stores, stock, invoices, QR posters |
| `staff` | `role, vendorId, storeIds[]` (required) | Assigned stores only: picking, inward, shelf data, checklists |
| `rider` | `role` | Own rider doc (shift, location), assigned orders |
| `compliance` | `role` | Read KYC, listings, checklists, audit logs; review via functions |
| `customer` | none (default for phone accounts) | Own profile, orders, invoices; browse listed stock |
| `temp_qr_guest` | `role, scopedStoreId, qrExp` on an **anonymous** user | One store's listed stock, own 10-minute cart, own walk-in bill — for 2 hours |

A Firestore `roleMirror` field exists for display only. Rules, functions and the
worker read the signed token.

## Walk-in QR flow

1. Seller calls `POST /v1/qr/sign {storeId}` → poster URL
   `https://<web>/store?s=S1&token=v1.k1.<payload>.<hmac>`; payload = `{t:'store', sid, ver, iat}`.
2. Customer scans → web storefront calls `GET /v1/qr/resolve` (genuine? store open?).
3. Browser signs in anonymously, solves Turnstile, calls `POST /v1/qr/session`.
   Worker verifies ID token (must be anonymous), Turnstile, QR HMAC, store
   `qrKeyVersion`, rate limits → HMAC-signed call to `qrSessionClaim`.
4. Function re-checks everything and sets `{role:'temp_qr_guest', scopedStoreId, qrExp}`.
   Client refreshes its ID token.
5. Guest reads that store's listed stock and writes a `temp_carts` doc
   (product ids + qty only, expires ≤10 min).
6. Guest pays in-app, or calls `POST /v1/checkout/token` and shows the QR at the counter.
7. Cashier scans → `POST /v1/checkout/redeem` (staff/seller of that store, single use)
   → POS loads the cart → Phase 2 `commitSale` transaction recomputes prices, deducts
   FEFO batches, writes the ledger + invoice, marks the cart `CONSUMED`.
8. Optional upgrade: guest links a phone (OTP) → `completeGuestUpgrade` clears guest claims.

**Revoking posters:** bump `stores/{id}.qrKeyVersion` — every old poster stops working.
**Rotating the key:** add `k2` to `QR_HMAC_KEYS`, set `QR_ACTIVE_KID=k2`, reprint, then remove `k1`.

## Design decisions that differ from the brief (and why)

1. **Carts live in Firestore, not Cloudflare KV.** KV is eventually consistent and
   its free tier allows 1,000 writes a day — not enough for carts, and not safe for
   locks. Carts are Firestore docs with a TTL; the stock "lock" is the Firestore
   transaction at checkout. KV is used only as a fast replay guard for checkout
   tokens (one write per sale).
2. **Guests never see batch documents.** Batches carry purchase price. Guests get
   `nearestExpiry` and `nextBatchNumber` on the inventory doc instead.
3. **Plain anonymous users get no stock access.** Only a QR-scoped guest or a
   signed-in customer can read stock, so a scraper cannot read every store by
   signing in anonymously. Pre-login browsing (Phase 3) will be served from a
   cached edge endpoint.
4. **Operator queries must filter by `vendorId`** (plus `storeId`) so rules can
   prove access; the composite indexes are built that way.
5. **IRN only for B2B.** E-invoicing does not apply to B2C; B2C bills carry the UPI
   dynamic QR with GST break-up.
6. **Rate limiting** uses the Workers Rate Limiting binding (per location),
   with an in-memory fallback for local dev.

## Single business vs marketplace

The model is multi-vendor (`vendorId` everywhere), which also serves a single
dedicated business: create one vendor document, and all stores, staff and stock
hang off it. Adding outside sellers later needs no schema change.

## Phase 2: how a sale is committed

`commitSale` (Cloud Function) is the only place stock leaves a store. One Firestore
transaction reads store, vendor, cart, products, inventory docs, FEFO batches and the
`counters/{vendorId}_{FY}` doc; the shared `planSale()` decides batch allocations, tax
and the next invoice number; then batches, inventory, ledger lines, order, invoice,
counter and cart are written together. PDFs (A4 + 80 mm) and the test-mode IRN are
added right after the transaction and never undo a sale if they fail.

| Rule | Where it is enforced |
|---|---|
| Price comes from `store_inventory`, never the client | `planSale` |
| Cannot sell above MRP | `planSale`, `setStorePrice` |
| Expired / recalled batches never sold; earliest expiry first | `allocateFefo` |
| Last unit can't be sold twice | Firestore transaction |
| GST rate comes from `hsn_master` | `upsertProduct` |
| Walk-in cart billed once | cart `CONSUMED` in the transaction + KV replay guard on the checkout token |
| Staff only bill their stores; only the owner changes prices / catalogue | function checks + rules |

The web app talks to the backend through one `DataClient` interface with two
implementations: `FirebaseDataClient` (production) and `DemoDataClient` (in-browser,
same planners). The storefront uses a second Firebase app instance so a walk-in
session never signs a cashier out on a shared device.
