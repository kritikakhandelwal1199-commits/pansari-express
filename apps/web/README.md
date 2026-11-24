# apps/web — seller portal, POS counter, walk-in storefront

Next.js (App Router) + TypeScript + Tailwind v4 + shadcn-style components + Framer Motion.

| Route | Who | What |
|---|---|---|
| `/` | anyone | Landing, entry points |
| `/login` | staff | Phone OTP (demo: one-tap accounts, OTP 123456) |
| `/seller` | owner, staff, admin | Today's sales, low stock, expiring batches |
| `/seller/products` | owner (edit), admin (approve) | Catalogue; GST slab from the HSN master |
| `/seller/inventory` | owner, staff | Stock per store, receive batches, adjust, shelf/bin, price |
| `/seller/ledger` | owner, staff | Every stock movement with running balance |
| `/seller/invoices` | owner, staff | Bills, A4/80 mm PDFs, GSTR-1 summary, HSN CSV |
| `/seller/qr` | owner | Printable signed store posters |
| `/pos` | owner, staff | Barcode/USB scan, cash/UPI/card, B2B GSTIN, walk-in QR checkout |
| `/store?s=<storeId>&token=` | walk-in customer | Scoped shelf with aisle + expiry, pay in-app or at counter, save bill to phone |

`NEXT_PUBLIC_DATA_MODE=demo` runs everything in the browser; `firebase` uses the real
backend — see `.env.example`. Tests: `npm test -w @pansari/web`.
