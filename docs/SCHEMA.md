# Firestore schema

TypeScript definitions: `packages/shared/src/schema.ts` (authoritative).
Money is integer **paise**. "Server" = written only by Cloud Functions.

| Collection | Doc id | Purpose | Client writes |
|---|---|---|---|
| `users` | uid | Profile, saved addresses (state code drives place of supply) | Owner: name, email, addresses |
| `vendors` | vendorId | Legal business: GSTIN, PAN, FSSAI, state, invoice prefix, KYC | Server |
| `stores` | storeId | Public store card, location, zone, UPI id, `qrKeyVersion` | Super admin (audited) |
| `zones` | zoneId | GeoJSON polygon (as JSON string), stores served, fees, surge | Super admin (audited) |
| `hsn_master` | hsnCode | Global HSN → GST slab + cess | Super admin (audited, slab validated) |
| `products` | productId | Catalogue, HSN, slab, tax type, MRP, Legal Metrology fields, compliance status | Server |
| `store_inventory` | `{storeId}_{productId}` | Per-store price, on-hand, reorder threshold, aisle/bin, low-stock + expiry flags | Operators: `aisleBinCode`, `reorderThreshold`, `isListed` |
| `store_inventory/*/batches` | batchId | FEFO batches: batch no, mfg/expiry, purchase price, qty | Server |
| `stock_ledger` | auto | Every stock movement (`INWARD_PO`, `ONLINE_SALE`, `OFFLINE_QR_SALE`, `POS_WALKIN_SALE`, `CUSTOMER_RETURN`, `DAMAGED_WRITE_OFF`, `CYCLE_COUNT_ADJUSTMENT`, transfers, recalls) | Server |
| `temp_carts` | cartId | Walk-in cart: ids + qty only, 10-minute TTL | Scoped guest |
| `orders` | orderId | Online / QR / POS orders, lines with batch allocation, totals, payment, rider | Server |
| `invoices` | invoiceId | Immutable GST invoice: number, FY, seller snapshot, buyer, computation, IRN, QR, PDF paths | Server |
| `counters` | `{vendorId}_{FY}` | Invoice serial per financial year | Server (no client access) |
| `riders` | uid | Vehicle, KYC, shift, location, COD cash, earnings | Rider: `isOnline` (KYC verified), `lastLocation`, `lastSeenAt` |
| `kyc_documents` | auto | GSTIN / FSSAI / PAN / DL / RC uploads | Seller / rider create (PENDING) |
| `support_tickets` | auto | Chatbot escalations with transcript | Creator; compliance/admin update status |
| `compliance_checks` | auto | Hygiene / cold-chain checklists | Store operators create; compliance reviews |
| `recalls` | auto | Batch recalls | Server |
| `payouts` | auto | Seller / rider payouts | Server |
| `audit_logs` | auto | Immutable audit trail | None |
| `platform_config` | `public` / others | App config | Super admin |

## Invoice numbering

`{prefix}/{yy-yy}/{serial}` e.g. `PX/26-27/000123` — max 16 characters, unique per
financial year (1 April–31 March, decided in IST). The serial comes from
`counters/{vendorId}_{FY}` inside the same transaction that writes the invoice, so
there are no gaps or duplicates.

## Indexes

See `firestore.indexes.json`. Operator-facing queries start with `vendorId`
because the rules need it to prove access. TTL is enabled on `temp_carts.expiresAt`;
large JSON fields are excluded from indexing.
