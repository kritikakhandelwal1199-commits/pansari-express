# Pansari Express — hyperlocal quick commerce + offline QR store

Multi-store kirana platform (jadibuti, pooja, shaadi, dry fruits, home goods) with:
online quick delivery, walk-in **scan-the-store-QR** shopping without an app, one
unified stock ledger for online + counter sales, and product-wise Indian GST billing.

This repository contains **Phases 1–3**: foundation, seller portal + POS + walk-in QR storefront,
and the customer delivery app (web + Expo phone app) with the support chatbot.

| Phase | Scope | Status |
|---|---|---|
| 1 | Folder architecture, Firestore schema + indexes, `firestore.rules` / `storage.rules`, Cloudflare Worker (token checks, HMAC QR, Turnstile, rate limits), Service Adapter Layer (Payment, Geo, OTP, GST + invoice PDF), identity functions | Done |
| 2 | Seller portal, POS counter, walk-in QR storefront, stock management (FEFO, ledger), product-wise CGST/SGST/IGST billing, GSTR-1 summary | **Done** |
| 3 | Customer web shop (`/shop`) + Expo phone app (`apps/mobile`): OTP login, addresses, zone check, cart with delivery fee, UPI/card (test)/wallet/COD checkout, order tracking with delivery code, GST invoice at dispatch, wallet with instant refunds; seller online-orders queue; support chatbot on every screen with escalation to tickets | **Done** |
| 4 | Super admin, picker/staff app, rider app, compliance portal | — |

## Live demo

Every push to `main` tests the code and publishes the web app in **demo mode** to GitHub Pages
(`.github/workflows/pages.yml`): `https://<github-user>.github.io/pansari-express/`.
Demo mode runs entirely in the browser with sample data — OTP 123456, one-tap staff accounts on
the sign-in page. Open the POS in one tab and **Seller portal → Store QR → Open as a customer** in another.

Firebase:
* **Free (Spark) plan** — Firestore rules + indexes and Hosting: run the *Deploy to Firebase (free plan parts)*
  workflow (setup notes inside `.github/workflows/firebase-free.yml`).
* **Full backend** (Cloud Functions for billing, stock, invoices) needs the Blaze plan — run `deploy.cmd` on Windows (see DEPLOY.md).

## Layout

```
packages/shared      Types, roles, GST engine, GSTIN check, amount-in-words, FY invoice numbers,
                     geo math, HMAC QR tokens, edge request signing (used everywhere)
services/adapters    Service Adapter Layer — PaymentAdapter, GeoAdapter, AuthAdapter, GstAdapter
                     (mock providers + A4 / 80 mm invoice PDFs)
edge/worker          Cloudflare Worker: Firebase ID token + App Check verification, signed store QR,
                     walk-in session, counter checkout tokens, Turnstile, rate limiting
functions            Firebase Cloud Functions v2: setUserRole, qrSessionClaim, completeGuestUpgrade,
                     audit triggers
firebase/tests       Security-rules tests (Firestore emulator)
firestore.rules      Zero-trust database rules       storage.rules   Storage rules
firestore.indexes.json                                firebase.json   Emulator + deploy config
packages/client      DataClient interface + in-memory demo backend, shared by web and phone
apps/web             Next.js app: customer shop (/shop), seller portal (/seller), POS (/pos), walk-in storefront (/store?s=)
apps/mobile          Expo (React Native + NativeWind) customer app — own package-lock, see apps/mobile/README.md
preview/web          Builds a single-file demo of apps/web for sharing
docs/                ARCHITECTURE.md, SCHEMA.md
```

## Run it locally

Requirements: Node 22+, Java 17+ (for Firebase emulators).

```bash
npm install
npm run build -w @pansari/shared        # other packages import the built shared code
npm test                                # unit tests: shared, adapters, worker, functions
npm run typecheck
npm run test:rules                      # starts the Firestore emulator and runs the rules tests
```

Edge worker (local):

```bash
cd edge/worker
cp .dev.vars.example .dev.vars          # dev-only secrets
npx wrangler dev
```

Functions (emulator):

```bash
cp functions/.secret.local.example functions/.secret.local
npm run build -w functions
npm run emulators
```

Make yourself the first super admin (once): see `functions/scripts/bootstrapSuperAdmin.ts`.

## Run the web app

```bash
npm install
npm run build -w @pansari/shared && npm run build -w @pansari/adapters
cp apps/web/.env.example apps/web/.env.local     # NEXT_PUBLIC_DATA_MODE=demo works with no backend
npm run dev -w @pansari/web                       # http://localhost:3000
```

* **Demo mode** (`NEXT_PUBLIC_DATA_MODE=demo`) runs the whole app in the browser with sample data,
  using the same stock/billing planners as the Cloud Functions. OTP is 123456; one-tap demo
  accounts are on the sign-in page. Open the POS in one tab and the store QR link in another
  to try the walk-in flow end to end.
* **Firebase mode** (`NEXT_PUBLIC_DATA_MODE=firebase`) talks to Firestore, Cloud Functions and the
  edge worker. Locally: `npm run emulators`, then seed with
  `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GCLOUD_PROJECT=demo-pansari npm run seed -w functions`,
  and run the worker with `npx wrangler dev` in `edge/worker`.

## API hold mode — what is simulated

| Adapter | Mock behaviour | Swap later for |
|---|---|---|
| Payment | UPI intent / UPI QR (real `upi://pay` links), card **tokens** only (never card numbers), COD/cash; success / fail / random / manual toggles; signed webhooks; refunds | Razorpay / Cashfree / PhonePe PG |
| Geo | Haversine distance, GeoJSON point-in-polygon zones, ETA, local pincode gazetteer, OpenStreetMap tiles | Paid geocoding / routing |
| Auth (OTP) | Firebase test numbers `+91 9999999999 → 123456`, Auth emulator, or the in-memory mock | Live Firebase phone auth (SMS) |
| GST | Real tax maths; e-invoice INV-01 JSON (schema v1.1); IRN = SHA-256 computed locally; invoice + QR signed with a **local test key**; B2C UPI dynamic QR; A4 + thermal PDFs | GSP / IRP API |
| Turnstile | `TURNSTILE_MODE=mock` accepts `mock-turnstile-pass` | `live` with your Turnstile secret (free) |

## Before going live

- **Firebase plan:** Cloud Functions need the Blaze (pay-as-you-go) plan; it has a free monthly quota, but a billing account must be attached.
- **Cloudflare:** create the KV namespace, put the IDs in `wrangler.toml`, set secrets (`QR_HMAC_KEYS`, `EDGE_SHARED_SECRET`, `TURNSTILE_SECRET`), switch `TURNSTILE_MODE=live`, `APP_CHECK_MODE=enforce`.
- **Same secrets on both sides:** `QR_HMAC_KEYS` and `EDGE_SHARED_SECRET` must match in the worker and in Firebase Secret Manager.
- **Firestore TTL:** enable the TTL policy on `temp_carts.expiresAt` (declared in `firestore.indexes.json`; confirm it in the console).
- **Tax data:** HSN codes and GST rates in samples and tests are illustrative. Have your CA confirm the HSN/rate for every SKU before billing.
- **E-invoicing:** IRN applies only to B2B invoices and only once turnover crosses the notified threshold; B2C bills use the UPI dynamic QR instead.
- **In-app payment for walk-in guests** is simulated (`PAYMENTS_MODE=mock`): the guest chooses success/failure. A live gateway must confirm payments by webhook before this goes live.
- **Place of supply:** counter and walk-in QR sales are billed intra-state (goods handed over at the store), even to a buyer with another state's GSTIN; online deliveries use the delivery state.
- **Maps:** the public OpenStreetMap tile server is for light use. Move to a self-hosted or paid tile source for production traffic.
