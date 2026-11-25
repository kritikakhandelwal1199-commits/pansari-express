/**
 * commitSale — the single place where stock leaves a store.
 *
 * Channels handled here (Phase 2):
 *   POS_WALKIN  cashier bills items at the counter
 *   OFFLINE_QR  a walk-in QR cart, either redeemed by the cashier (cash / UPI at
 *               the counter) or paid in-app by the guest (simulated in API hold mode)
 *
 * One Firestore transaction reads store, vendor, cart, products, inventory,
 * batches and the invoice counter, plans the sale with the shared planner, and
 * writes batches, inventory, ledger, order, invoice, counter and cart together —
 * so the last unit can never be sold twice and invoice numbers never skip.
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { COL, financialYear, paiseToRupees, planSale, randomId, type InvoiceComputation, type PaymentMethod, type SaleSnapshot } from '@pansari/shared';
import { MockGstProvider } from '@pansari/adapters';
import { db, writeAudit } from '../lib/admin.js';
import { caller, id, inventoryFromDoc, invRef, isGuestOf, msToTs, operatesStore, productTaxFromDoc, readBatches, str, toHttps } from '../lib/model.js';

/** "mock" while payments are on API hold. */
const PAYMENTS_MODE = defineString('PAYMENTS_MODE', { default: 'mock' });
const MOCK_IRP_KEY = defineString('MOCK_IRP_KEY', { default: 'mock-irp-local-signing-key-change-me-0123' });

interface CommitInput {
  storeId: string;
  channel: 'POS_WALKIN' | 'OFFLINE_QR';
  items?: { productId: string; qty: number }[];
  tempCartId?: string;
  payment: { method: PaymentMethod; providerRef?: string | null };
  buyer?: { name?: string | null; gstin?: string | null; address?: string | null };
  /** Guest in-app payment while on API hold: the simulated outcome. */
  simulateOutcome?: 'success' | 'fail';
}

export const commitSale = onCall({ timeoutSeconds: 60, memory: '512MiB' }, async (req) => {
  const c = caller(req);
  const d = (req.data ?? {}) as CommitInput;
  const storeId = id(d.storeId, 'storeId');
  const channel = d.channel;
  if (channel !== 'POS_WALKIN' && channel !== 'OFFLINE_QR') throw new HttpsError('invalid-argument', 'Unsupported channel');
  const method = d.payment?.method;
  if (!['CASH', 'UPI_QR', 'UPI_INTENT', 'CARD'].includes(method)) throw new HttpsError('invalid-argument', 'Payment method must be CASH, UPI or CARD');

  const storeSnap = await db.collection(COL.stores).doc(storeId).get();
  if (!storeSnap.exists) throw new HttpsError('not-found', 'Store not found');
  const vendorId = String(storeSnap.get('vendorId'));

  const isCashier = operatesStore(c, storeId, vendorId);
  const isGuest = isGuestOf(c, storeId);
  if (!isCashier && !isGuest) throw new HttpsError('permission-denied', 'Not allowed to bill at this store');
  if (isGuest && (channel !== 'OFFLINE_QR' || !d.tempCartId)) throw new HttpsError('permission-denied', 'Guests can only pay for their own walk-in cart');
  if (channel === 'OFFLINE_QR' && !d.tempCartId) throw new HttpsError('invalid-argument', 'tempCartId is required for QR sales');
  if (channel === 'POS_WALKIN' && (!Array.isArray(d.items) || d.items.length === 0)) throw new HttpsError('invalid-argument', 'Add items to the bill');

  // Payment: cashier attests cash/UPI received at the counter. Guest in-app payment
  // is simulated until a live gateway is connected (verified by webhook then).
  let providerRef: string | null = d.payment.providerRef ? str(d.payment.providerRef, 64, 'payment reference') : null;
  if (isGuest) {
    if (method === 'CASH') throw new HttpsError('invalid-argument', 'Pay cash at the counter instead');
    if (PAYMENTS_MODE.value() !== 'mock') throw new HttpsError('failed-precondition', 'In-app payment needs the live gateway webhook flow');
    if (d.simulateOutcome === 'fail') throw new HttpsError('aborted', 'Payment declined (simulated)', { code: 'PAYMENT_DECLINED' });
    providerRef = `MOCK-${randomId(8)}`;
  }

  const orderRef = db.collection(COL.orders).doc();
  const invoiceRef = db.collection(COL.invoices).doc(orderRef.id);

  let result;
  try {
    result = await db.runTransaction(async (tx) => {
      const nowMs = Date.now();
      const store = await tx.get(storeSnap.ref);
      const vendor = await tx.get(db.collection(COL.vendors).doc(vendorId));
      if (!vendor.exists) throw new HttpsError('failed-precondition', 'Vendor profile missing');

      // Items: from the request (counter) or from the cart (QR) — never both.
      let items = d.items ?? [];
      let guestUid: string | null = null;
      let cartRef: FirebaseFirestore.DocumentReference | null = null;
      if (channel === 'OFFLINE_QR') {
        cartRef = db.collection(COL.tempCarts).doc(id(d.tempCartId, 'tempCartId'));
        const cart = await tx.get(cartRef);
        if (!cart.exists) throw new HttpsError('not-found', 'Cart not found');
        if (cart.get('storeId') !== storeId) throw new HttpsError('permission-denied', 'Cart belongs to another store');
        if (!['OPEN', 'CHECKOUT_PENDING'].includes(cart.get('status'))) throw new HttpsError('failed-precondition', 'This cart was already billed', { code: 'CART_CONSUMED' });
        const exp = cart.get('expiresAt') as Timestamp;
        // Cashier may bill a just-expired cart the customer is standing at the counter with (5 min grace).
        if (exp.toMillis() + (isCashier ? 5 * 60_000 : 0) < nowMs) throw new HttpsError('deadline-exceeded', 'Cart expired — scan the store QR again');
        if (isGuest && cart.get('guestUid') !== c.uid) throw new HttpsError('permission-denied', 'Not your cart');
        guestUid = String(cart.get('guestUid'));
        items = (cart.get('items') as { productId: string; qty: number }[]) ?? [];
      }

      const productIds = [...new Set(items.map((i) => String(i.productId)))];
      if (productIds.length > 60) throw new HttpsError('invalid-argument', 'Too many items');
      const prodSnaps = productIds.length ? await tx.getAll(...productIds.map((p) => db.collection(COL.products).doc(p))) : [];
      const invSnaps = productIds.length ? await tx.getAll(...productIds.map((p) => invRef(storeId, p))) : [];
      const batches: SaleSnapshot['batches'] = {};
      for (const p of productIds) batches[p] = await readBatches(tx, storeId, p);

      const fy = financialYear(new Date(nowMs));
      const counterRef = db.collection(COL.counters).doc(`${vendorId}_${fy}`);
      const counter = await tx.get(counterRef);

      const snapshot: SaleSnapshot = {
        nowMs,
        store: {
          storeId,
          vendorId,
          name: String(store.get('name')),
          stateCode: String(store.get('stateCode')),
          addressLine: String(store.get('addressLine') ?? ''),
          city: String(store.get('city') ?? ''),
          pincode: String(store.get('pincode') ?? ''),
          gstin: store.get('gstin') ?? null,
          fssaiLicenseNo: store.get('fssaiLicenseNo') ?? null,
          isActive: store.get('isActive') === true,
        },
        vendor: {
          vendorId,
          legalName: String(vendor.get('legalName')),
          tradeName: String(vendor.get('tradeName')),
          gstin: vendor.get('gstin') ?? null,
          fssaiLicenseNo: vendor.get('fssaiLicenseNo') ?? null,
          stateCode: String(vendor.get('stateCode')),
          invoicePrefix: String(vendor.get('invoicePrefix') ?? 'INV'),
          registeredAddress: String(vendor.get('registeredAddress') ?? ''),
        },
        products: Object.fromEntries(prodSnaps.filter((s) => s.exists && s.get('vendorId') === vendorId).map((s) => [s.id, productTaxFromDoc(s)])),
        inventory: Object.fromEntries(invSnaps.filter((s) => s.exists).map((s) => [String(s.get('productId')), inventoryFromDoc(s)])),
        batches,
        counterLastSeq: counter.exists ? Number(counter.get('lastSeq')) : 0,
      };

      const plan = planSale(
        {
          channel,
          items,
          payment: { method, status: 'PAID', providerRef },
          buyer: d.buyer ? { name: d.buyer.name ?? null, gstin: d.buyer.gstin ?? null, address: d.buyer.address ?? null } : undefined,
          customerUid: null,
          guestUid,
          actorUid: c.uid,
        },
        snapshot,
      );

      // ---- writes
      for (const b of plan.batchWrites) tx.update(invRef(storeId, b.productId).collection(COL.batches).doc(b.batchId), { qty: b.qty });
      for (const w of plan.inventoryWrites) {
        tx.update(invRef(storeId, w.productId), { onHand: w.onHand, lowStock: w.lowStock, nearestExpiry: msToTs(w.nearestExpiryMs), nextBatchNumber: w.nextBatchNumber, updatedAt: FieldValue.serverTimestamp() });
      }
      for (const l of plan.ledger) {
        tx.create(db.collection(COL.stockLedger).doc(), { storeId, vendorId, productId: l.productId, batchId: l.batchId, movement: l.movement, qtyDelta: l.qtyDelta, balanceAfter: l.balanceAfter, refType: 'ORDER', refId: orderRef.id, reason: null, byUid: c.uid, at: FieldValue.serverTimestamp() });
      }
      const t = plan.computation.totals;
      tx.create(orderRef, {
        orderId: orderRef.id,
        channel,
        storeId,
        vendorId,
        customerUid: null,
        guestUid,
        lines: plan.lines,
        totals: { taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, cess: t.cess, roundOff: t.roundOff, grandTotal: t.grandTotal },
        payment: { method, status: 'PAID', providerRef },
        status: 'COMPLETED',
        deliveryAddress: null,
        riderUid: null,
        deliveryOtpHash: null,
        invoiceId: invoiceRef.id,
        cashierUid: isCashier ? c.uid : null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.create(invoiceRef, {
        invoiceId: invoiceRef.id,
        invoiceNo: plan.invoiceNo,
        financialYear: plan.financialYear,
        seq: plan.seq,
        kind: plan.computation.kind,
        vendorId,
        storeId,
        orderId: orderRef.id,
        customerUid: null,
        guestUid,
        sellerSnapshot: plan.sellerSnapshot,
        buyer: plan.buyer,
        supplyType: plan.computation.supplyType,
        computationJson: JSON.stringify(plan.computation),
        grandTotal: t.grandTotal,
        paymentMethod: method,
        irn: null,
        ackNo: null,
        ackDate: null,
        signedQr: null,
        upiQrPayload: null,
        pdfPaths: { a4: null, thermal: null },
        issuedAt: Timestamp.fromMillis(nowMs),
        issuedBy: c.uid,
      });
      tx.set(counterRef, { vendorId, financialYear: plan.financialYear, lastSeq: plan.seq, updatedAt: FieldValue.serverTimestamp() });
      if (cartRef) tx.update(cartRef, { status: 'CONSUMED' });
      return { plan, storeName: snapshot.store.name, upiVpa: (store.get('upiVpa') as string | null) ?? null };
    });
  } catch (e) {
    toHttps(e);
  }

  const { plan } = result;
  // Post-issue work is outside the transaction; failures here never undo the sale.
  try {
    await finaliseInvoice(invoiceRef.id, plan.invoiceNo, plan.computation, plan.sellerSnapshot, plan.buyer, result.storeName, result.upiVpa, method, orderRef.id, vendorId);
  } catch (e) {
    logger.error('invoice.finalise.failed', { invoiceId: invoiceRef.id, err: e instanceof Error ? e.message : String(e) });
  }
  await writeAudit({ actorUid: c.uid, actorRole: c.role === 'anonymous' ? 'system' : c.role, action: 'sale.commit', target: { collection: COL.orders, id: orderRef.id }, after: { invoiceNo: plan.invoiceNo, total: plan.computation.totals.grandTotal, channel } });

  return {
    orderId: orderRef.id,
    invoiceId: invoiceRef.id,
    invoiceNo: plan.invoiceNo,
    kind: plan.computation.kind,
    grandTotal: plan.computation.totals.grandTotal,
    totalTax: plan.computation.totals.totalTax,
    paymentRef: providerRef,
  };
});

export async function finaliseInvoice(
  invoiceId: string,
  invoiceNo: string,
  comp: InvoiceComputation,
  seller: { legalName: string; tradeName: string; gstin: string | null; fssaiLicenseNo: string | null; address: string; stateCode: string },
  buyer: { name: string | null; gstin: string | null; address: string | null; placeOfSupplyStateCode: string },
  storeName: string,
  upiVpa: string | null,
  method: PaymentMethod,
  orderId: string,
  vendorId: string,
  opts: { online?: boolean } = {},
) {
  const gst = new MockGstProvider({ mockSigningKey: MOCK_IRP_KEY.value() });
  const issuedAt = new Date();
  const update: Record<string, unknown> = {};
  let qrPayload: string | null = null;
  let qrCaption = '';
  let irn: string | null = null;
  let ackNo: string | null = null;
  let ackDate: string | null = null;

  if (comp.kind === 'B2B' && seller.gstin) {
    const payload = gst.buildEInvoice({
      computation: comp,
      docType: 'INV',
      docNo: invoiceNo,
      docDate: issuedAt,
      seller: { legalName: seller.legalName, tradeName: seller.tradeName, gstin: seller.gstin, addr1: seller.address.slice(0, 100), location: storeName.slice(0, 50), pincode: (/\b[1-9]\d{5}\b/.exec(seller.address)?.[0] ?? '302001'), stateCode: seller.stateCode },
      buyer: { legalName: buyer.name ?? 'Registered buyer', gstin: buyer.gstin!, addr1: buyer.address ?? 'Counter sale', location: storeName.slice(0, 50), pincode: (/\b[1-9]\d{5}\b/.exec(buyer.address ?? '')?.[0] ?? (/\b[1-9]\d{5}\b/.exec(seller.address)?.[0] ?? '302001')), stateCode: buyer.gstin!.slice(0, 2) },
    });
    const reg = await gst.register(payload);
    irn = reg.Irn;
    ackNo = reg.AckNo;
    ackDate = reg.AckDt;
    qrPayload = reg.SignedQRCode;
    qrCaption = 'Signed e-invoice QR (test mode)';
    Object.assign(update, { irn, ackNo, ackDate, signedQr: reg.SignedQRCode, einvoiceJson: JSON.stringify(payload), irnIsMock: reg.isMock });
  } else if (upiVpa && seller.gstin && !opts.online) {
    qrPayload = gst.b2cUpiQr({ sellerGstin: seller.gstin, payeeVpa: upiVpa, payeeName: seller.tradeName, invoiceNo, invoiceDate: issuedAt, computation: comp });
    qrCaption = 'UPI QR with GST break-up';
    update.upiQrPayload = qrPayload;
  }

  const model = {
    invoiceNo,
    invoiceDate: issuedAt,
    seller: { ...seller, storeName },
    buyer: { name: buyer.name, gstin: buyer.gstin, address: buyer.address },
    computation: comp,
    orderRef: orderId,
    paymentMode: { CASH: 'Cash', UPI_QR: 'UPI', UPI_INTENT: 'UPI', CARD: 'Card', COD: 'Cash on delivery', WALLET: 'Pansari wallet' }[method],
    irn,
    ackNo,
    ackDate,
    qrPayload,
    qrCaption,
    isMockIrn: !!irn,
  };
  const bucket = getStorage().bucket();
  const [a4, thermal] = await Promise.all([gst.renderPdf(model, 'A4'), gst.renderPdf(model, 'THERMAL_80MM')]);
  const paths = { a4: `invoices/${vendorId}/${invoiceId}-a4.pdf`, thermal: `invoices/${vendorId}/${invoiceId}-80mm.pdf` };
  await Promise.all([
    bucket.file(paths.a4).save(Buffer.from(a4), { contentType: 'application/pdf', resumable: false }),
    bucket.file(paths.thermal).save(Buffer.from(thermal), { contentType: 'application/pdf', resumable: false }),
  ]);
  update.pdfPaths = paths;
  await db.collection(COL.invoices).doc(invoiceId).update(update);
  logger.info('invoice.issued', { invoiceNo, total: paiseToRupees(comp.totals.grandTotal) });
}

/* ------------------------------------------------------------------ */
/* getInvoicePdf — returns the PDF bytes (base64) to an authorised user */
/* ------------------------------------------------------------------ */
export const getInvoicePdf = onCall(async (req) => {
  const c = caller(req);
  const invoiceId = id(req.data?.invoiceId, 'invoiceId');
  const format = req.data?.format === 'A4' ? 'a4' : 'thermal';
  const inv = await db.collection(COL.invoices).doc(invoiceId).get();
  if (!inv.exists) throw new HttpsError('not-found', 'Invoice not found');
  const vendorId = String(inv.get('vendorId'));
  const storeId = String(inv.get('storeId'));
  const allowed =
    operatesStore(c, storeId, vendorId) ||
    c.role === 'compliance' ||
    c.role === 'super_admin' ||
    (c.role === 'customer' && inv.get('customerUid') === c.uid) ||
    (c.role === 'temp_qr_guest' && inv.get('guestUid') === c.uid);
  if (!allowed) throw new HttpsError('permission-denied', 'Not your invoice');
  const path = (inv.get('pdfPaths') as { a4: string | null; thermal: string | null } | undefined)?.[format];
  if (!path) throw new HttpsError('unavailable', 'The PDF is still being prepared, try again in a moment');
  const [buf] = await getStorage().bucket().file(path).download();
  return { fileName: `${String(inv.get('invoiceNo')).replace(/\//g, '-')}-${format}.pdf`, base64: buf.toString('base64') };
});
