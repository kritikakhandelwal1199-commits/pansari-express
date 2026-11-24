# Pansari Express — handoff for Claude

Owner: **Rahul** (Jaipur; advocate + developer). Address him as Rahul. One dedicated business
(multi-store kirana: jadibuti/pregnancy herbs, pooja, shaadi samagri, dry fruits, home goods) —
NOT a subscription SaaS. Rahul is the super admin; the shop owner is a `seller`.

Live demo (GitHub Pages, demo mode): https://khandelwalroxy123-gif.github.io/pansari-express/
Repo: https://github.com/khandelwalroxy123-gif/pansari-express (push to `main` → tests + redeploy, ~2 min)

## Spec
Original brief = "MASTER SYSTEM PROMPT: Hyperlocal quick-commerce & offline QR store" (Next.js +
Expo + Firebase + Cloudflare; 6 roles; API-hold mode with mock adapters; 4 phases).

| Phase | Scope | Status |
|---|---|---|
| 1 | Monorepo, Firestore schema/indexes, firestore.rules + storage.rules, Cloudflare Worker (ID-token/App Check verify, HMAC store QR, Turnstile, rate limits, checkout tokens), adapters (Payment/Geo/Auth/GST + PDFs), role + QR-session functions | DONE |
| 2 | Seller portal, POS counter, walk-in QR storefront, FEFO stock + ledger, product-wise CGST/SGST/IGST billing, invoices + GSTR-1 summary | DONE |
| 3 | Customer web + Expo (NativeWind) app: OTP login, addresses, zone check, 10-min delivery cart/checkout, order tracking, invoice history, wallet; embedded support chatbot (local intent engine, escalation → `support_tickets`) for all roles | NEXT |
| 4 | Super admin (roles UI via `setUserRole`, zones editor, HSN master, audit), staff picker app (picking queue, inward, cycle count), rider app (KYC, shift, POD, COD ledger), compliance portal (KYC/listing review, recalls) | TODO |

## Layout
```
packages/shared     types/schema (COL), roles/claims, GST engine, GSTIN check, invoice no. (FY, ≤16 chars),
                    amount in words, geo, HMAC tokens, edge signing, stock planners (planSale/planInward/
                    planAdjust, FEFO), GSTR-1 summary, demo seed data
services/adapters   PaymentAdapter, GeoAdapter, AuthAdapter (+ firebase-auth), GstAdapter (INV-01, IRN, PDFs)
edge/worker         Cloudflare Worker routes: /v1/qr/resolve|sign|session, /v1/checkout/token|redeem
functions           v2: setUserRole, completeGuestUpgrade, qrSessionClaim, upsertProduct, reviewProduct,
                    setStorePrice, inwardStock, adjustStock, commitSale, getInvoicePdf, bootstrapBusiness,
                    audit triggers. build.mjs → functions/deploy/ (clean package for Google build)
apps/web            Next.js 16 static export: /, /login, /seller/*, /pos, /store?s=<id>&token=
                    lib/data: DataClient interface → FirebaseDataClient | DemoDataClient (same planners)
firebase/tests      rules tests (need Firestore emulator + Java)
preview/web         single-file artifact build of apps/web (in-memory router shims)
deploy.ps1/.cmd     Windows full deploy (Blaze): Firebase project, secrets, worker, hosting, functions
.github/workflows   pages.yml (demo → GitHub Pages), firebase-free.yml (Spark: rules+indexes+hosting)
```

## Key decisions (keep them)
- Roles only in custom claims; rules + functions + worker never trust Firestore role fields.
- Price/GST/stock/orders/invoices are server-written only. `commitSale` = one transaction
  (FEFO batches, ledger, order, invoice, FY counter, cart CONSUMED). Price ≤ MRP enforced.
- GST slab comes from `hsn_master`, never from client. Counter/QR sales are intra-state (POS = store);
  online uses delivery state. IRN only for B2B (mock, local key); B2C gets UPI dynamic QR.
- Walk-in guest = anonymous user + claims `{role:'temp_qr_guest', scopedStoreId, qrExp}` (2 h).
  Carts in Firestore `temp_carts` (TTL), not KV (KV free tier 1k writes/day); KV only replays guard.
- Guests never read batch docs (purchase price); they see `nearestExpiry`/`nextBatchNumber`.
- Operator queries must filter `vendorId` (+ `storeId`) so rules can prove access.
- Money = integer paise everywhere. All UI copy plain, sentence case.
- API hold: payments/IRN/Turnstile are mocks; guest in-app pay uses `simulateOutcome`.

## Run / verify
```bash
npm ci
npm run build -w @pansari/shared && npm run build -w @pansari/adapters
npm test            # 54 tests (shared 26, adapters 9, worker 8, functions 7, web flows 4)
npm run typecheck
npm run dev -w @pansari/web     # NEXT_PUBLIC_DATA_MODE=demo by default; OTP 123456
npm run test:rules              # needs Java; emulator download may be blocked in sandboxes
```
GitHub Pages build uses `NEXT_PUBLIC_BASE_PATH=/pansari-express`; use `toAppPath()` for in-app links
built from absolute URLs. After UI changes, a Playwright walkthrough (owner login → receive stock →
POS B2B bill → store QR → guest cart → checkout QR → POS redeem → second redeem blocked → guest bill)
is the best check.

## Gotchas learned
- `.gitignore` once had `lib/` and hid `apps/web/lib` + `functions/src/lib` — keep it `functions/lib/`.
- Next app-router `layout.tsx`/`page.tsx` must not export extra symbols (shared bits live in components/).
- Windows PowerShell 5.1: keep .ps1 ASCII, call interactive CLIs (firebase/wrangler login) directly.
- Not deployed yet: real Firebase backend (needs Blaze + Rahul's sign-ins) and the Cloudflare worker.

## Next step
Start **Phase 3**: create `apps/mobile` (Expo + NativeWind, customer app first) and customer web routes in
`apps/web` (`/shop`, cart, checkout, `/orders`), plus Cloud Functions `placeOrder` (ONLINE channel via
`planSale`, delivery address state as place of supply, zone/ETA via GeoAdapter, mock payment) and the
chatbot widget. Extend DataClient + DemoDataClient for each feature so the demo keeps working.
