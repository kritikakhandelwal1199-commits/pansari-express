# Pansari Express — handoff for Claude

Owner: **Rahul** (Jaipur; advocate + developer). Address him as Rahul. One dedicated business
(multi-store kirana: jadibuti/pregnancy herbs, pooja, shaadi samagri, dry fruits, home goods) —
NOT a subscription SaaS. Rahul is the super admin; the shop owner is a `seller`.

Live demo (GitHub Pages, demo mode): https://kritikakhandelwal1199-commits.github.io/pansari-express/ (before the
repo transfer it was khandelwalroxy123-gif.github.io/pansari-express/)
Repo: https://github.com/kritikakhandelwal1199-commits/pansari-express (transferred from
khandelwalroxy123-gif; push to `main` → tests + redeploy, ~2 min)

## Spec
Original brief = "MASTER SYSTEM PROMPT: Hyperlocal quick-commerce & offline QR store" (Next.js +
Expo + Firebase + Cloudflare; 6 roles; API-hold mode with mock adapters; 4 phases).

| Phase | Scope | Status |
|---|---|---|
| 1 | Monorepo, Firestore schema/indexes, firestore.rules + storage.rules, Cloudflare Worker (ID-token/App Check verify, HMAC store QR, Turnstile, rate limits, checkout tokens), adapters (Payment/Geo/Auth/GST + PDFs), role + QR-session functions | DONE |
| 2 | Seller portal, POS counter, walk-in QR storefront, FEFO stock + ledger, product-wise CGST/SGST/IGST billing, invoices + GSTR-1 summary | DONE |
| 3 | Customer web `/shop` + Expo app `apps/mobile`: OTP login, addresses, zone check, delivery fee, UPI/card(mock)/wallet/COD, tracking + delivery OTP, invoice at dispatch, wallet refunds; seller `/seller/orders` + `/seller/support`; chatbot (shared/support/chatbot.ts) on all surfaces → tickets | DONE |
| 4c | Rider payouts (owner records UPI/bank/cash payout → earnings down), proof-of-delivery photo (rider, viewable by customer + store), live rider tracking (rider app pings every 30 s while carrying; customer/store see distance + ETA + mini map; demo estimates position along the route), hygiene checklists (daily / cool storage °C / pest / expiry sweep; staff submit, compliance reviews, "no check today" list) — web + phone | DONE |
| 4b | Native phone screens for every role (owner, staff picker with camera scan, rider, compliance, admin) | DONE (demo mode) |
| 4 | `/admin` (people & roles by phone, zones editor + SVG map + address check, GST/HSN master that re-rates products, listing review, audit log), `/staff` picker app (bin-sorted pick list with FEFO batch numbers, barcode/camera tick, rider assign, receive stock, shelf count), `/rider` app (KYC upload, shift, collect → start → deliver with code, COD cash + earnings), `/compliance` (KYC review, listing review, batch/whole-product recalls, audit); seller `/seller/riders` (receive COD cash) + `/seller/kyc` | DONE (web, phone-first) |

## Layout
```
packages/client     DataClient interface (types.ts) + DemoDataClient (demo.ts) + FirebaseDataClient (firebase.ts, import
                    '@pansari/client/firebase'; options makeAuth + verifier let the phone app plug in RN persistence
                    and a WebView reCAPTCHA); source-only package used by web + mobile
packages/shared     ops/riders.ts (assign/step/COD/KYC roll-up), ops/picking.ts (pick list, scan match, count variance),
                    ops/extras.ts (planPayout, checkPod, trackEstimate/simulateRiderPosition/validPing, HYGIENE_QUESTIONS/
                    validateHygiene/missingDailyChecks); ops/compliance.ts (planRecall, recalledInOrder, HSN validate/resolve/re-rate, zone validate);
                    types/schema (COL), roles/claims, GST engine, GSTIN check, invoice no. (FY, ≤16 chars),
                    amount in words, geo, HMAC tokens, edge signing, stock planners (planSale/planInward/
                    planAdjust, FEFO), GSTR-1 summary, demo seed data (incl. DEMO_ZONES),
                    orders/online.ts (status machine, delivery fee SAC 996813 @18%, cancel→restock, COD/wallet rules, OTP hash),
                    support/chatbot.ts (Hinglish intent engine → actions)
services/adapters   PaymentAdapter, GeoAdapter, AuthAdapter (+ firebase-auth), GstAdapter (INV-01, IRN, PDFs)
edge/worker         Cloudflare Worker routes: /v1/qr/resolve|sign|session, /v1/checkout/token|redeem
functions           v2: setUserRole, completeGuestUpgrade, qrSessionClaim, upsertProduct, reviewProduct,
                    setStorePrice, inwardStock, adjustStock, commitSale, getInvoicePdf, bootstrapBusiness,
                    placeOrder, cancelOrder, advanceOrder, topUpWallet, createSupportTicket, setTicketStatus,
                    audit triggers; Phase 4 in src/ops/phase4.ts: listUsers, saveZone, upsertHsn, saveRiderProfile,
                    setRiderShift, assignRider, receiveCodCash, onKycUploaded (trigger), reviewKyc, createRecall,
                    completeRecall; setUserRole also takes {phone, displayName, homeStoreId}; advanceOrder has the
                    rider branch; src/ops/extras.ts: payRider, attachPod, trackRider. build.mjs → functions/deploy/ (clean package for Google build)
apps/web            Next.js 16 static export: /, /login, /shop (+/cart, /orders, /orders/view?id=, /account),
                    /seller/* (incl. /orders, /support, /riders, /kyc), /pos, /store?s=<id>&token=,
                    /admin/*, /compliance/*, /staff (+/pick?id=, /receive, /count), /rider (+/cash, /kyc)
                    components/portal.tsx (PortalShell, `narrow` = phone app), components/phase4.tsx (KycUploader,
                    KycReviewQueue, ListingReview, AuditTable, RiderPicker), components/staff.tsx (ProductFinder)
                    lib/data: types/demo/firebase re-export @pansari/client; /recaptcha page = human check for the
                    phone app's OTP (posts the token to the WebView)
apps/mobile         Expo SDK 58 + Expo Router + NativeWind app for EVERY role: customer tabs at /, /owner, /staff
                    (+ /pick/[id]), /rider, /compliance, /admin; login lands by role (lib/roles.ts); shared bits in
                    components/role.tsx (RoleGate, StoreProvider, Picker sheet, Scanner, KycUploader, pickPhoto),
                    components/ops.tsx (RiderPicker, ProductFinder), components/review.tsx (KYC queue, listings,
                    audit). eas.json: preview (demo APK) / live / production. NOT a root workspace (own lockfile,
                    file: links to packages); metro.config.js watches packages + forces tslib ES build (pdf-lib);
                    lib/polyfills.ts = Web Crypto for Hermes. lib/live.tsx: EXPO_PUBLIC_DATA_MODE=firebase → same
                    FirebaseDataClient (firebase JS SDK, AsyncStorage persistence, RecaptchaHost WebView →
                    <EXPO_PUBLIC_WEB_URL>/recaptcha/). deploy.ps1 writes apps/mobile/.env; root .easignore uploads it.
firebase/tests      rules tests (need Firestore emulator + Java)
preview/web         single-file artifact build of apps/web (in-memory router shims)
deploy.ps1/.cmd     Windows full deploy (Blaze): Firebase project, secrets, worker, hosting, functions
.github/workflows   pages.yml (demo → GitHub Pages), rules.yml (rules tests on emulators), firebase-free.yml (Spark: rules+indexes+hosting)
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
- Online orders: stock reserved FEFO at placeOrder; prices + GST frozen in `computationJson`; invoice
  number issued only at dispatch (OUT_FOR_DELIVERY) so cancels before dispatch need no credit note.
  Customer cancels until ACCEPTED; operator until PACKED. Paid → refund to wallet instantly.
  Delivery OTP: hash on order, plain copy in `order_secrets/{orderId}` (customer-readable only).
- Public reads: approved products + listed store_inventory rows (browse before login). Tickets are
  created only via the createSupportTicket function (it routes vendorId/storeId).
- Riders (Phase 4): rider role has no vendor/store claims; `riders/{uid}` holds `homeStoreId` + `vendorId`
  (set by setUserRole, required for riders). Store assigns a rider ACCEPTED..PACKED (verified, on shift,
  ≤3 orders, COD cash ≤ ₹5,000). Rider steps via advanceOrder: PACKED→HANDED_TO_RIDER (invoice issued here)
  →OUT_FOR_DELIVERY→DELIVERED (OTP). Once the rider has the bag the store can't move it. Store-delivery
  without a rider still works (PACKED→OUT_FOR_DELIVERY). COD cash → `rider_cash_ledger` COLLECT; store confirms
  DEPOSIT via receiveCodCash. Flat ₹30/drop into earningsBalance (payouts not built).
- KYC: rider = DL + RC + masked Aadhaar (uploader must tick "masked"; rules enforce maskedConfirmed);
  vendor = GSTIN cert + FSSAI + PAN + cancelled cheque. Newest upload per type counts (rollupKyc).
  Not VERIFIED → rider forced off shift. Rules block going off shift while carrying orders.
- Recalls: planRecall sets matching batches qty 0 + recalled, RECALL_REMOVAL ledger, whole-product recall
  also unpublishes (RECALLED; reviewProduct refuses to re-approve). Dispatch is blocked for orders holding a
  recalled batch (store must cancel → restock goes into the recalled batch, not on hand).
- Extras: payouts are records only (API hold — no payout provider); `payouts` written by payRider. POD photo at
  storage pod/{riderUid}/{orderId}/…, linked by attachPod (order.podPath); storage rule reads the order via
  firestore.get so customer + store staff can view (deploy grants the storage agent Firestore read). Rider location
  = direct write to riders/{uid}.lastLocation (rules allow); customers read it only through trackRider. Hygiene
  checks = direct Firestore writes to compliance_checks (rules validate keys/kind); compliance updates review fields.
- First-time setup (bootstrapBusiness, BOOTSTRAP_PHONE = $OwnerPhone in deploy.ps1) makes the caller
  super_admin (Rahul); he adds the shop owner etc. in Admin → People & roles. deploy-state.json holds
  secrets — gitignored + easignored.
- Delivery area = all of Jaipur: DEMO_ZONES Z1 north (S1) / Z2 south (S2) split at lat 26.88 inside JAIPUR_BOUNDS;
  JAIPUR_MAX_DELIVERY_METERS 15 km (demo, live client, placeOrder). Outside example: 305001 Ajmer.
- Maps: components/map.tsx = Leaflet + OSM tiles (no key, browser-only dynamic import, CSS pins). Used by
  RiderTracker, admin zones (click map to check delivery), and /seller/map (Delivery map: open orders + riders).
- Demo history: DemoDataClient.ensureHistory() runs real demo flows once per browser (state.historyV1) and
  spreads timestamps over 3 days (delivered rider/store orders, COD hand-in, payout, refund, B2B bill, ticket,
  hygiene, one order on the road now, new orders waiting). DataProvider awaits it in demo mode only.
- Live pitch data: scripts/seed-live-demo.mjs (test phone logins 99999 0000x / 123456 + real flows). Rahul must
  run it himself in Cloud Shell (fixed-code logins are an access decision); remove with --remove-demo.
  RAN on live 26 Nov 2026 with Rahul's go-ahead: 8 demo logins +9199999 0000[1-8] / 123456 are ACTIVE — remove
  them (--remove-demo) before real customers. Rahul's number is super_admin (bootstrap flag set).
- HSN master edits re-rate products by most specific match (8→6→4 digits); frozen online orders keep
  their computation. Zones/HSN written by callables; the audit triggers skip service-account writes.

## Run / verify
```bash
npm ci
npm run build -w @pansari/shared && npm run build -w @pansari/adapters
npm test            # 102 tests (shared 56, adapters 9, worker 8, functions 7, web flows 22)
npm run typecheck
npm run dev -w @pansari/web     # NEXT_PUBLIC_DATA_MODE=demo by default; OTP 123456
npm run test:rules              # needs Java; emulator download may be blocked in sandboxes
```
GitHub Pages build uses `NEXT_PUBLIC_BASE_PATH=/pansari-express`; use `toAppPath()` for in-app links
built from absolute URLs. After UI changes, a Playwright walkthrough (owner login → receive stock →
POS B2B bill → store QR → guest cart → checkout QR → POS redeem → second redeem blocked → guest bill)
is the best check. Phase 3 flow: /shop guest → login "Customer · Priya" → COD order → owner /seller/orders
accept → pack → send out (invoice) → deliver with OTP → customer sees invoice; wallet order → cancel → refund.
Phase 4 flow (demo accounts on /login, each lands in its own app): Rider · Vikram → Go on shift; Customer
· Priya → COD order; Picker · Sunita (/staff) → Accept → assign Vikram → scan 8901234500048 + tick → packed;
Vikram → collected → start → deliver with code; Shop owner → Riders & cash → receive cash; Rider · Arjun
→ upload 3 docs (tick masked); Compliance · Meera → verify, recall DH-2609; Super admin → add rider by
phone, new zone, HSN 0802 → 5%. Script used: Python Playwright against `next build` output served at
/pansari-express (0 console errors on 25 Nov 2026).
Mobile: `cd apps/mobile && npx tsc --noEmit && EXPO_OFFLINE=1 npx expo export --platform android` (also
`--platform web` + serve dist-web to click through it in a browser). `npx expo install` needs EXPO_OFFLINE=1 in sandboxes.

## Gotchas learned
- `.gitignore` once had `lib/` and hid `apps/web/lib` + `functions/src/lib` — keep it `functions/lib/`.
- Next app-router `layout.tsx`/`page.tsx` must not export extra symbols (shared bits live in components/).
- Windows PowerShell 5.1: keep .ps1 ASCII, call interactive CLIs (firebase/wrangler login) directly.
- LIVE since 26 Nov 2026: Firebase project `pansari-express` (Blaze, billing acct 017144-BF784E-0FDE57, UPI autopay,
  ₹100 budget alert), https://pansari-express.web.app — 35 functions in asia-south1, Phone + Anonymous auth,
  SMS region = India only, Storage bucket pansari-express.firebasestorage.app (US-EAST1 no-cost tier).
  Deployed from Google Cloud Shell with scripts/deploy-cloudshell.sh (secrets in ~/.pansari-pansari-express.env there).
  Redeploy: Cloud Shell → cd ~/pansari-express && git pull && npx firebase deploy --only functions,hosting --force.
  Cloudflare worker (walk-in QR) NOT deployed yet — QR checkout needs it.
- Region gotcha: setGlobalOptions must run before any function module loads → functions/src/lib/options.ts is
  the FIRST import in index.ts (ESM `export … from` is hoisted; it once sent 20 functions to us-central1).
- Demo state key stays `pansari-demo-v3`; `migrate()` in demo.ts fills Phase 4 fields into older saved
  states — add new fields there (and to seed) rather than bumping the key.
- Rules tests run in CI (.github/workflows/rules.yml, Java + emulators) on every rules/test change —
  23/23 green on 25 Nov 2026. Listed store_inventory rows are public by design; tests check unlisted rows.

## Next step
Phase 4 is done on the web (phone-first pages work in a phone browser). Remaining:
1. (done) Rules tests run in GitHub Actions (rules.yml) — all 23 pass.
2. (done) Native Expo screens for every role. Mobile click-through: `expo export --platform web`, serve
   with an SPA fallback, Playwright at 390×844 (rider on shift → Priya COD → Sunita accept/assign/pick
   → Vikram collect/start/deliver → owner receives cash) — 0 errors on 25 Nov 2026.
3. (done) Live mode for the phone app (firebase JS SDK + WebView reCAPTCHA) and EAS profiles. Not yet
   tried against a real project — first live APK build is in docs/GO-LIVE.md step 4.
4. (done) Payouts, POD photo, live rider tracking, hygiene checklists — web + phone. Next ideas: payout
   provider (RazorpayX) when APIs are unlocked; background location (expo-task-manager) for riders.
5. (done) Firebase deployed. Remaining: Rahul's first sign-in → First-time setup → add people; Cloudflare worker
   for walk-in QR; live APK (eas build --profile live, needs apps/mobile/.env from Cloud Shell).
