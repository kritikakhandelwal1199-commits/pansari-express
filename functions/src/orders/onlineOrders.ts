/**
 * Online delivery orders (Phase 3).
 *
 *   placeOrder     customer → reserves stock FEFO, freezes prices + GST, takes payment (mock / wallet / COD)
 *   cancelOrder    customer, until the store starts picking → restock same batches, refund to wallet
 *   advanceOrder   store operator → ACCEPTED, PICKING, PACKED, OUT_FOR_DELIVERY (issues the tax invoice),
 *                  DELIVERED (needs the customer's 4-digit code), CANCELLED / REJECTED (restock + refund)
 *   topUpWallet    customer, mock UPI while payments are on API hold
 *   createSupportTicket  any signed-in user (chatbot escalation)
 *
 * Every stock / money change happens in one Firestore transaction using the same
 * shared planners as the counter (planSale, planCancelRestock), so the demo and
 * production behave the same.
 */
import { FieldValue, Timestamp, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import {
  canTransition,
  checkOnlinePayment,
  COL,
  customerCanCancel,
  deliveryCharge,
  financialYear,
  formatInvoiceNo,
  hashDeliveryOtp,
  isDispatch,
  newDeliveryOtp,
  ONLINE_PAYMENT_METHODS,
  operatorCanCancel,
  OrderError,
  planCancelRestock,
  planSale,
  randomId,
  refundOnCancel,
  WALLET_TOPUP_MAX,
  type InvoiceComputation,
  type OrderStatus,
  type PlannedLine,
  type SaleCharge,
  type SaleSnapshot,
} from '@pansari/shared';
import { LocalGeoProvider } from '@pansari/adapters';
import { db, writeAudit } from '../lib/admin.js';
import { caller, id, inventoryFromDoc, invRef, msToTs, operatesStore, productTaxFromDoc, readBatches, str, toHttps, type Caller } from '../lib/model.js';
import { finaliseInvoice } from '../sales/commitSale.js';

const PAYMENTS_MODE = defineString('PAYMENTS_MODE', { default: 'mock' });
const geo = new LocalGeoProvider({ maxDistanceMeters: 7000 });

const STATUSES: OrderStatus[] = ['ACCEPTED', 'PICKING', 'PACKED', 'HANDED_TO_RIDER', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REJECTED'];

function requireCustomer(c: Caller) {
  if (c.role !== 'customer' || c.isAnonymous) throw new HttpsError('permission-denied', 'Sign in with your mobile number to order');
}

function orderErr(e: unknown): never {
  if (e instanceof OrderError) throw new HttpsError('failed-precondition', e.message, { code: e.code });
  toHttps(e);
}

async function saleSnapshot(tx: Transaction, store: DocumentSnapshot, productIds: string[], nowMs: number): Promise<SaleSnapshot> {
  const vendorId = String(store.get('vendorId'));
  const vendor = await tx.get(db.collection(COL.vendors).doc(vendorId));
  if (!vendor.exists) throw new HttpsError('failed-precondition', 'Vendor profile missing');
  const prodSnaps = productIds.length ? await tx.getAll(...productIds.map((p) => db.collection(COL.products).doc(p))) : [];
  const invSnaps = productIds.length ? await tx.getAll(...productIds.map((p) => invRef(store.id, p))) : [];
  const batches: SaleSnapshot['batches'] = {};
  for (const p of productIds) batches[p] = await readBatches(tx, store.id, p);
  return {
    nowMs,
    store: {
      storeId: store.id,
      vendorId,
      name: String(store.get('name')),
      stateCode: String(store.get('stateCode')),
      addressLine: String(store.get('addressLine') ?? ''),
      city: String(store.get('city') ?? ''),
      pincode: String(store.get('pincode') ?? ''),
      gstin: store.get('gstin') ?? null,
      fssaiLicenseNo: store.get('fssaiLicenseNo') ?? null,
      isActive: store.get('isActive') === true && store.get('acceptsOnline') === true,
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
    counterLastSeq: 0, // online orders take an invoice number at dispatch, not here
  };
}

async function serviceability(location: { lat: number; lng: number }) {
  const [zones, stores] = await Promise.all([db.collection(COL.zones).where('isActive', '==', true).get(), db.collection(COL.stores).where('acceptsOnline', '==', true).get()]);
  const zoneDocs = zones.docs.map((z) => ({ zoneId: z.id, name: String(z.get('name')), geometryJson: String(z.get('geometryJson')), storeIds: (z.get('storeIds') as string[]) ?? [], isActive: true, fees: { baseDeliveryFee: Number(z.get('baseDeliveryFee') ?? 0), freeDeliveryAbove: Number(z.get('freeDeliveryAbove') ?? 0), surgeMultiplierBps: Number(z.get('surgeMultiplierBps') ?? 10_000) } }));
  const r = geo.checkServiceability(location, zoneDocs, stores.docs.map((s) => ({ storeId: s.id, name: String(s.get('name')), location: s.get('location'), isActive: s.get('isActive') === true, acceptsOnline: true })));
  const fees = zoneDocs.find((z) => z.zoneId === r.zone?.zoneId)?.fees ?? null;
  return { ...r, fees };
}

function walletWrite(tx: Transaction, uid: string, balanceBefore: number, amount: number, kind: 'TOPUP' | 'ORDER_DEBIT' | 'REFUND', refId: string | null, note: string) {
  const after = balanceBefore + amount;
  if (after < 0) throw new HttpsError('failed-precondition', 'Wallet balance is not enough');
  tx.set(db.collection(COL.users).doc(uid), { walletBalance: after, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  tx.create(db.collection(COL.walletTxns).doc(), { uid, kind, amount, balanceAfter: after, refId, note, at: FieldValue.serverTimestamp() });
  return after;
}

/* ------------------------------------------------------------------ */
/* placeOrder                                                           */
/* ------------------------------------------------------------------ */
export const placeOrder = onCall({ timeoutSeconds: 60, memory: '512MiB' }, async (req) => {
  const c = caller(req);
  requireCustomer(c);
  const d = (req.data ?? {}) as { addressId?: string; storeId?: string; items?: { productId: string; qty: number }[]; paymentMethod?: string; simulateOutcome?: 'success' | 'fail' };
  const addressId = id(d.addressId, 'addressId');
  const storeIdQuoted = id(d.storeId, 'storeId');
  const method = d.paymentMethod as (typeof ONLINE_PAYMENT_METHODS)[number];
  if (!ONLINE_PAYMENT_METHODS.includes(method)) throw new HttpsError('invalid-argument', 'Choose a payment method');
  if (!Array.isArray(d.items) || d.items.length === 0 || d.items.length > 60) throw new HttpsError('invalid-argument', 'Your cart is empty');
  const items = d.items.map((i) => ({ productId: id(i?.productId, 'productId'), qty: Number(i?.qty) }));

  const userRef = db.collection(COL.users).doc(c.uid);
  const user = await userRef.get();
  const addr = ((user.get('addresses') as { id: string; location: { lat: number; lng: number }; stateCode: string; line1: string; city: string; pincode: string }[] | undefined) ?? []).find((a) => a.id === addressId);
  if (!addr) throw new HttpsError('invalid-argument', 'Choose a delivery address');
  const svc = await serviceability(addr.location);
  if (!svc.serviceable || !svc.store || !svc.fees) throw new HttpsError('failed-precondition', 'Sorry, we do not deliver to this address yet', { code: 'NOT_SERVICEABLE' });
  if (svc.store.storeId !== storeIdQuoted) throw new HttpsError('failed-precondition', 'Your address is served by another store — your cart was refreshed', { code: 'STORE_CHANGED' });

  // API hold: online payment is simulated; the live flow will confirm via the gateway webhook.
  let providerRef: string | null = null;
  if (method === 'UPI_INTENT' || method === 'CARD') {
    if (PAYMENTS_MODE.value() !== 'mock') throw new HttpsError('failed-precondition', 'Online payment needs the live gateway webhook flow');
    if (d.simulateOutcome === 'fail') throw new HttpsError('aborted', 'Payment declined (test mode). Nothing was charged.', { code: 'PAYMENT_DECLINED' });
    providerRef = `MOCK-${randomId(8)}`;
  }

  const storeRef = db.collection(COL.stores).doc(svc.store.storeId);
  const orderRef = db.collection(COL.orders).doc();
  const otp = newDeliveryOtp();
  const otpHash = await hashDeliveryOtp(orderRef.id, otp);

  let out: { grand: number; storeId: string; vendorId: string };
  try {
    out = await db.runTransaction(async (tx) => {
      const nowMs = Date.now();
      const store = await tx.get(storeRef);
      const u = await tx.get(userRef);
      const balance = Number(u.get('walletBalance') ?? 0);
      const productIds = [...new Set(items.map((i) => i.productId))];
      const snap = await saleSnapshot(tx, store, productIds, nowMs);
      const name = (u.get('displayName') as string | null) ?? null;
      const base = { channel: 'ONLINE' as const, items, payment: { method, status: 'PENDING' as const, providerRef }, buyer: { name, address: `${addr.line1}, ${addr.city} ${addr.pincode}`, placeOfSupplyStateCode: addr.stateCode }, customerUid: c.uid, actorUid: c.uid };
      const pre = planSale(base, snap);
      const charges: SaleCharge[] = deliveryCharge(pre.computation.totals.grandTotal, svc.fees!);
      const plan = planSale({ ...base, charges }, snap);
      const grand = plan.computation.totals.grandTotal;
      checkOnlinePayment(method, pre.computation.totals.grandTotal, grand, balance);

      for (const b of plan.batchWrites) tx.update(invRef(store.id, b.productId).collection(COL.batches).doc(b.batchId), { qty: b.qty });
      for (const w of plan.inventoryWrites) tx.update(invRef(store.id, w.productId), { onHand: w.onHand, lowStock: w.lowStock, nearestExpiry: msToTs(w.nearestExpiryMs), nextBatchNumber: w.nextBatchNumber, updatedAt: FieldValue.serverTimestamp() });
      for (const l of plan.ledger) tx.create(db.collection(COL.stockLedger).doc(), { storeId: store.id, vendorId: snap.store.vendorId, productId: l.productId, batchId: l.batchId, movement: l.movement, qtyDelta: l.qtyDelta, balanceAfter: l.balanceAfter, refType: 'ORDER', refId: orderRef.id, reason: null, byUid: c.uid, at: FieldValue.serverTimestamp() });
      if (method === 'WALLET') walletWrite(tx, c.uid, balance, -grand, 'ORDER_DEBIT', orderRef.id, `Order ${orderRef.id}`);
      const t = plan.computation.totals;
      tx.create(orderRef, {
        orderId: orderRef.id,
        channel: 'ONLINE',
        storeId: store.id,
        vendorId: snap.store.vendorId,
        customerUid: c.uid,
        customerPhone: (req.auth?.token.phone_number as string | undefined) ?? null,
        customerName: name,
        guestUid: null,
        lines: plan.lines,
        charges: charges.map((x) => ({ code: x.code, name: x.name, amount: x.amount })),
        computationJson: JSON.stringify(plan.computation),
        sellerSnapshot: plan.sellerSnapshot,
        buyer: plan.buyer,
        totals: { taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, cess: t.cess, roundOff: t.roundOff, grandTotal: t.grandTotal, totalTax: t.totalTax },
        payment: { method, status: method === 'COD' ? 'PENDING' : 'PAID', providerRef },
        status: 'PLACED',
        statusHistory: [{ status: 'PLACED', at: nowMs, by: c.uid }],
        deliveryAddress: addr,
        etaMinutes: svc.etaMinutes,
        riderUid: null,
        deliveryOtpHash: otpHash,
        invoiceId: null,
        invoiceNo: null,
        cancelReason: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.create(db.collection(COL.orderSecrets).doc(orderRef.id), { customerUid: c.uid, deliveryOtp: otp, createdAt: FieldValue.serverTimestamp() });
      return { grand, storeId: store.id, vendorId: snap.store.vendorId };
    });
  } catch (e) {
    orderErr(e);
  }
  await writeAudit({ actorUid: c.uid, actorRole: 'customer', action: 'order.place', target: { collection: COL.orders, id: orderRef.id }, after: { total: out.grand, method, storeId: out.storeId } });
  return { orderId: orderRef.id, grandTotal: out.grand, etaMinutes: svc.etaMinutes };
});

/* ------------------------------------------------------------------ */
/* cancel helpers                                                       */
/* ------------------------------------------------------------------ */
async function cancelInTx(tx: Transaction, order: DocumentSnapshot, status: 'CANCELLED' | 'REJECTED', reason: string, byUid: string) {
  const storeId = String(order.get('storeId'));
  const vendorId = String(order.get('vendorId'));
  const lines = (order.get('lines') as PlannedLine[]) ?? [];
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const batches: Record<string, Awaited<ReturnType<typeof readBatches>>> = {};
  const thresholds: Record<string, number> = {};
  const invSnaps = productIds.length ? await tx.getAll(...productIds.map((p) => invRef(storeId, p))) : [];
  for (const s of invSnaps) thresholds[String(s.get('productId'))] = Number(s.get('reorderThreshold') ?? 0);
  // restock needs every allocated batch, including ones that are now at qty 0
  for (const l of lines) {
    const refs = l.batchAllocations.map((a) => invRef(storeId, l.productId).collection(COL.batches).doc(a.batchId));
    const all = refs.length ? await tx.getAll(...refs) : [];
    const existing = await readBatches(tx, storeId, l.productId);
    const map = new Map(existing.map((b) => [b.batchId, b]));
    for (const s of all) if (s.exists && !map.has(s.id)) map.set(s.id, { batchId: s.id, batchNumber: String(s.get('batchNumber')), mfgMs: null, expiryMs: (s.get('expiryDate') as Timestamp | null)?.toMillis() ?? null, receivedMs: 0, qty: Number(s.get('qty') ?? 0), recalled: s.get('recalled') === true, purchasePrice: 0, mrp: Number(s.get('mrp') ?? 0) });
    batches[l.productId] = [...map.values()];
  }
  const userRef = db.collection(COL.users).doc(String(order.get('customerUid')));
  const user = await tx.get(userRef);

  const r = planCancelRestock(lines, { nowMs: Date.now(), batches, reorderThreshold: thresholds });
  for (const b of r.batchWrites) tx.update(invRef(storeId, b.productId).collection(COL.batches).doc(b.batchId), { qty: b.qty });
  for (const w of r.inventoryWrites) tx.update(invRef(storeId, w.productId), { onHand: w.onHand, lowStock: w.lowStock, nearestExpiry: msToTs(w.nearestExpiryMs), nextBatchNumber: w.nextBatchNumber, updatedAt: FieldValue.serverTimestamp() });
  for (const l of r.ledger) tx.create(db.collection(COL.stockLedger).doc(), { storeId, vendorId, productId: l.productId, batchId: l.batchId, movement: l.movement, qtyDelta: l.qtyDelta, balanceAfter: l.balanceAfter, refType: 'ORDER', refId: order.id, reason, byUid, at: FieldValue.serverTimestamp() });

  const payment = order.get('payment') as { method: string; status: string; providerRef: string | null };
  const grand = Number((order.get('totals') as { grandTotal: number }).grandTotal);
  const refund = refundOnCancel(payment as never, grand);
  if (refund > 0) walletWrite(tx, userRef.id, Number(user.get('walletBalance') ?? 0), refund, 'REFUND', order.id, `Refund for ${order.id}`);
  tx.update(order.ref, {
    status,
    cancelReason: reason,
    'payment.status': refund > 0 ? 'REFUNDED' : payment.status,
    statusHistory: FieldValue.arrayUnion({ status, at: Date.now(), by: byUid }),
    updatedAt: FieldValue.serverTimestamp(),
  });
  tx.delete(db.collection(COL.orderSecrets).doc(order.id));
  return refund;
}

/* ------------------------------------------------------------------ */
/* cancelOrder — customer                                               */
/* ------------------------------------------------------------------ */
export const cancelOrder = onCall(async (req) => {
  const c = caller(req);
  requireCustomer(c);
  const orderId = id(req.data?.orderId, 'orderId');
  const reason = str(req.data?.reason ?? 'Cancelled by customer', 140, 'reason') || 'Cancelled by customer';
  let refunded = 0;
  try {
    refunded = await db.runTransaction(async (tx) => {
      const order = await tx.get(db.collection(COL.orders).doc(orderId));
      if (!order.exists || order.get('customerUid') !== c.uid) throw new HttpsError('not-found', 'Order not found');
      if (!customerCanCancel(order.get('status'))) throw new HttpsError('failed-precondition', 'The store has started packing this order, so it cannot be cancelled here. Use Help to contact the shop.', { code: 'TOO_LATE' });
      return cancelInTx(tx, order, 'CANCELLED', reason, c.uid);
    });
  } catch (e) {
    toHttps(e);
  }
  await writeAudit({ actorUid: c.uid, actorRole: 'customer', action: 'order.cancel', target: { collection: COL.orders, id: orderId }, after: { refunded } });
  return { refunded };
});

/* ------------------------------------------------------------------ */
/* advanceOrder — store operator                                        */
/* ------------------------------------------------------------------ */
export const advanceOrder = onCall({ timeoutSeconds: 60, memory: '512MiB' }, async (req) => {
  const c = caller(req);
  const orderId = id(req.data?.orderId, 'orderId');
  const to = req.data?.to as OrderStatus;
  if (!STATUSES.includes(to)) throw new HttpsError('invalid-argument', 'Unknown status');
  const otp = typeof req.data?.otp === 'string' ? req.data.otp.slice(0, 8) : '';
  const reason = typeof req.data?.reason === 'string' ? req.data.reason.trim().slice(0, 140) : '';
  const orderRef = db.collection(COL.orders).doc(orderId);

  type Fin = Parameters<typeof finaliseInvoice>;
  const box: { v: { invoiceId: string; invoiceNo: string; comp: InvoiceComputation; seller: Fin[3]; buyer: Fin[4]; storeName: string; method: Fin[7]; vendorId: string } | null } = { v: null };
  let status: OrderStatus = to;
  try {
    await db.runTransaction(async (tx) => {
      box.v = null;
      const order = await tx.get(orderRef);
      if (!order.exists) throw new HttpsError('not-found', 'Order not found');
      const storeId = String(order.get('storeId'));
      const vendorId = String(order.get('vendorId'));
      if (!operatesStore(c, storeId, vendorId)) throw new HttpsError('permission-denied', 'You do not operate this store');
      const from = order.get('status') as OrderStatus;
      if (!canTransition(from, to)) throw new HttpsError('failed-precondition', `Cannot move an order from ${from} to ${to}`, { code: 'BAD_TRANSITION' });

      if (to === 'CANCELLED' || to === 'REJECTED') {
        if (!operatorCanCancel(from)) throw new HttpsError('failed-precondition', 'Too late to cancel');
        if (reason.length < 3) throw new HttpsError('invalid-argument', 'Write a short reason for the customer');
        await cancelInTx(tx, order, to, reason, c.uid);
        return;
      }
      const patch: Record<string, unknown> = { status: to, statusHistory: FieldValue.arrayUnion({ status: to, at: Date.now(), by: c.uid }), updatedAt: FieldValue.serverTimestamp() };
      if (to === 'DELIVERED') {
        if (!otp || (await hashDeliveryOtp(orderId, otp)) !== order.get('deliveryOtpHash')) throw new HttpsError('failed-precondition', 'Wrong delivery code — ask the customer for the 4-digit code', { code: 'BAD_OTP' });
        if ((order.get('payment') as { method: string }).method === 'COD') patch['payment.status'] = 'PAID';
        tx.delete(db.collection(COL.orderSecrets).doc(orderId));
      }
      if (isDispatch(to) && !order.get('invoiceId')) {
        const nowMs = Date.now();
        const fy = financialYear(new Date(nowMs));
        const counterRef = db.collection(COL.counters).doc(`${vendorId}_${fy}`);
        const [counter, vendor, store] = await Promise.all([tx.get(counterRef), tx.get(db.collection(COL.vendors).doc(vendorId)), tx.get(db.collection(COL.stores).doc(storeId))]);
        const seq = (counter.exists ? Number(counter.get('lastSeq')) : 0) + 1;
        const invoiceNo = formatInvoiceNo(String(vendor.get('invoicePrefix') ?? 'INV'), fy, seq);
        const comp = JSON.parse(String(order.get('computationJson'))) as InvoiceComputation;
        const invoiceRef = db.collection(COL.invoices).doc(orderId);
        const payment = order.get('payment') as { method: string };
        tx.create(invoiceRef, {
          invoiceId: invoiceRef.id,
          invoiceNo,
          financialYear: fy,
          seq,
          kind: comp.kind,
          vendorId,
          storeId,
          orderId,
          customerUid: order.get('customerUid'),
          guestUid: null,
          sellerSnapshot: order.get('sellerSnapshot'),
          buyer: order.get('buyer'),
          supplyType: comp.supplyType,
          computationJson: JSON.stringify(comp),
          grandTotal: comp.totals.grandTotal,
          paymentMethod: payment.method,
          irn: null,
          ackNo: null,
          ackDate: null,
          signedQr: null,
          upiQrPayload: null,
          pdfPaths: { a4: null, thermal: null },
          issuedAt: Timestamp.fromMillis(nowMs),
          issuedBy: c.uid,
        });
        tx.set(counterRef, { vendorId, financialYear: fy, lastSeq: seq, updatedAt: FieldValue.serverTimestamp() });
        patch.invoiceId = invoiceRef.id;
        patch.invoiceNo = invoiceNo;
        box.v = { invoiceId: invoiceRef.id, invoiceNo, comp, seller: order.get('sellerSnapshot') as Fin[3], buyer: order.get('buyer') as Fin[4], storeName: String(store.get('name')), method: payment.method as Fin[7], vendorId };
      }
      tx.update(orderRef, patch);
    });
  } catch (e) {
    toHttps(e);
  }
  const inv = box.v;
  if (inv) {
    try {
      await finaliseInvoice(inv.invoiceId, inv.invoiceNo, inv.comp, inv.seller, inv.buyer, inv.storeName, null, inv.method, orderId, inv.vendorId, { online: true });
    } catch (e) {
      logger.error('invoice.finalise.failed', { invoiceId: inv.invoiceId, err: e instanceof Error ? e.message : String(e) });
    }
  }
  await writeAudit({ actorUid: c.uid, actorRole: c.role === 'anonymous' ? 'system' : c.role, action: `order.${to.toLowerCase()}`, target: { collection: COL.orders, id: orderId }, after: { status, invoiceNo: inv?.invoiceNo ?? null } });
  return { status, invoiceNo: inv?.invoiceNo ?? null };
});

/* ------------------------------------------------------------------ */
/* topUpWallet — mock UPI while payments are on API hold                */
/* ------------------------------------------------------------------ */
export const topUpWallet = onCall(async (req) => {
  const c = caller(req);
  requireCustomer(c);
  const amount = Number(req.data?.amount);
  if (!Number.isSafeInteger(amount) || amount < 1000 || amount > WALLET_TOPUP_MAX) throw new HttpsError('invalid-argument', 'Add between ₹10 and ₹10,000');
  if (PAYMENTS_MODE.value() !== 'mock') throw new HttpsError('failed-precondition', 'Wallet top-up needs the live gateway webhook flow');
  if (req.data?.simulateOutcome === 'fail') throw new HttpsError('aborted', 'Payment declined (test mode). Nothing was charged.', { code: 'PAYMENT_DECLINED' });
  const ref = `MOCK-${randomId(8)}`;
  const balance = await db.runTransaction(async (tx) => {
    const u = await tx.get(db.collection(COL.users).doc(c.uid));
    return walletWrite(tx, c.uid, Number(u.get('walletBalance') ?? 0), amount, 'TOPUP', ref, 'Added by UPI (test mode)');
  });
  await writeAudit({ actorUid: c.uid, actorRole: 'customer', action: 'wallet.topup', target: { collection: COL.users, id: c.uid }, after: { amount, ref } });
  return { balance };
});

/* ------------------------------------------------------------------ */
/* createSupportTicket — chatbot escalation, any signed-in user          */
/* ------------------------------------------------------------------ */
const CATEGORIES = ['ORDER', 'PAYMENT', 'INVOICE', 'DAMAGED_ITEM', 'STOCK', 'KYC', 'OTHER'];
export const createSupportTicket = onCall(async (req) => {
  const c = caller(req);
  const d = req.data ?? {};
  const category = CATEGORIES.includes(d.category) ? d.category : 'OTHER';
  const subject = str(d.subject, 140, 'subject');
  const orderId = d.orderId ? id(d.orderId, 'orderId') : null;
  let storeId: string | null = d.storeId ? id(d.storeId, 'storeId') : null;
  let vendorId: string | null = null;
  if (orderId) {
    const o = await db.collection(COL.orders).doc(orderId).get();
    const mine = o.exists && (o.get('customerUid') === c.uid || o.get('guestUid') === c.uid || operatesStore(c, String(o.get('storeId')), String(o.get('vendorId'))));
    if (!mine) throw new HttpsError('permission-denied', 'Not your order');
    storeId = String(o.get('storeId'));
    vendorId = String(o.get('vendorId'));
  } else if (storeId) {
    const s = await db.collection(COL.stores).doc(storeId).get();
    vendorId = s.exists ? String(s.get('vendorId')) : null;
    if (!vendorId) storeId = null;
  }
  const transcript = (Array.isArray(d.transcript) ? d.transcript : []).slice(-30).map((m: { from?: string; text?: unknown; at?: unknown }) => ({ from: m.from === 'bot' ? 'bot' : 'user', text: String(m.text ?? '').slice(0, 500), at: Number(m.at) || Date.now() }));
  const ref = await db.collection(COL.supportTickets).add({
    createdBy: c.uid,
    creatorRole: c.role,
    subject,
    category,
    orderId,
    storeId,
    vendorId,
    transcript,
    attachmentPaths: [],
    priority: category === 'DAMAGED_ITEM' || category === 'PAYMENT' ? 'HIGH' : 'NORMAL',
    status: 'OPEN',
    assignedTo: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ticketId: ref.id };
});

/** Operators update ticket status (seller/staff of the ticket's vendor, or super admin). */
export const setTicketStatus = onCall(async (req) => {
  const c = caller(req);
  const ticketId = id(req.data?.ticketId, 'ticketId');
  const status = req.data?.status;
  if (!['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(status)) throw new HttpsError('invalid-argument', 'Bad status');
  const ref = db.collection(COL.supportTickets).doc(ticketId);
  const t = await ref.get();
  if (!t.exists) throw new HttpsError('not-found', 'Ticket not found');
  const ok = c.role === 'super_admin' || (t.get('vendorId') && t.get('storeId') && operatesStore(c, String(t.get('storeId')), String(t.get('vendorId')))) || (c.role === 'seller' && t.get('vendorId') === c.claims.vendorId);
  if (!ok) throw new HttpsError('permission-denied', 'Not allowed');
  await ref.update({ status, assignedTo: c.uid, updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});
