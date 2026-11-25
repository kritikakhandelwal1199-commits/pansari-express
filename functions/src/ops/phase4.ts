/**
 * Phase 4 callables: super admin (users, zones, HSN master), riders (profile,
 * shift, assignment, COD cash), compliance (KYC review, recalls).
 *
 * Pure rules live in @pansari/shared (ops/riders.ts, ops/compliance.ts) and are
 * the same ones the demo client runs, so behaviour matches the preview.
 * The rider's pick-up / start / deliver steps go through advanceOrder.
 */
import { FieldValue, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import {
  ASSIGNABLE_STATUSES,
  checkAssignRider,
  COL,
  ComplianceError,
  inventoryDocId,
  normaliseVehicleNo,
  planCodDeposit,
  planRecall,
  productsAffectedByHsn,
  RIDER_KYC_DOCS,
  RIDER_VEHICLES,
  RiderError,
  rollupKyc,
  validateHsn,
  validateZone,
  VENDOR_KYC_DOCS,
  type KycDocType,
  type KycStatus,
  type OrderStatus,
  type RiderState,
} from '@pansari/shared';
import { adminAuth, db, writeAudit } from '../lib/admin.js';
import { batchFromDoc, caller, id, invRef, msToTs, operatesStore, str, type Caller } from '../lib/model.js';

function ruleErr(e: unknown): never {
  if (e instanceof RiderError || e instanceof ComplianceError) throw new HttpsError('failed-precondition', e.message, { code: e.code });
  throw e;
}
function requireRole(c: Caller, ...roles: Caller['role'][]) {
  if (!roles.includes(c.role)) throw new HttpsError('permission-denied', 'You do not have access to this');
}
export function riderState(d: DocumentSnapshot): RiderState {
  return {
    uid: d.id,
    kycStatus: (d.get('kycStatus') as KycStatus) ?? 'PENDING',
    isOnline: d.get('isOnline') === true,
    homeStoreId: (d.get('homeStoreId') as string | null) ?? null,
    codCashInHand: Number(d.get('codCashInHand') ?? 0),
    activeOrderIds: (d.get('activeOrderIds') as string[] | undefined) ?? [],
  };
}

/* ------------------------------------------------------------------ */
/* Super admin                                                          */
/* ------------------------------------------------------------------ */

/** Staff, riders and admins (everyone with a role claim), plus recent customers. */
export const listUsers = onCall(async (req) => {
  const c = caller(req);
  requireRole(c, 'super_admin');
  const out: { uid: string; phone: string | null; displayName: string | null; role: string; vendorId: string | null; storeIds: string[]; homeStoreId: string | null }[] = [];
  let pageToken: string | undefined;
  do {
    const page = await adminAuth.listUsers(1000, pageToken);
    for (const u of page.users) {
      if (u.providerData.length === 0) continue; // anonymous walk-in sessions
      const cl = (u.customClaims ?? {}) as Record<string, unknown>;
      out.push({ uid: u.uid, phone: u.phoneNumber ?? null, displayName: u.displayName ?? null, role: typeof cl.role === 'string' && cl.role !== 'temp_qr_guest' ? cl.role : 'customer', vendorId: (cl.vendorId as string) ?? null, storeIds: (cl.storeIds as string[]) ?? [], homeStoreId: null });
    }
    pageToken = page.pageToken;
  } while (pageToken && out.length < 5000);
  const riderIds = out.filter((u) => u.role === 'rider').map((u) => u.uid);
  for (let i = 0; i < riderIds.length; i += 100) {
    const snaps = await db.getAll(...riderIds.slice(i, i + 100).map((r) => db.collection(COL.riders).doc(r)));
    for (const s of snaps) {
      const u = out.find((x) => x.uid === s.id);
      if (u && s.exists) u.homeStoreId = (s.get('homeStoreId') as string | null) ?? null;
    }
  }
  return out;
});

export const saveZone = onCall(async (req) => {
  const c = caller(req);
  requireRole(c, 'super_admin');
  const d = req.data ?? {};
  const stores = await db.collection(COL.stores).where('acceptsOnline', '==', true).get();
  let z;
  try {
    z = validateZone(
      { zoneId: d.zoneId, name: d.name, geometryJson: String(d.geometryJson ?? ''), storeIds: Array.isArray(d.storeIds) ? d.storeIds.map(String) : [], baseDeliveryFee: Number(d.baseDeliveryFee), freeDeliveryAbove: Number(d.freeDeliveryAbove), surgeMultiplierBps: Number(d.surgeMultiplierBps), isActive: d.isActive === true },
      stores.docs.filter((s) => s.get('isActive') === true).map((s) => s.id),
    );
  } catch (e) {
    ruleErr(e);
  }
  const ref = d.zoneId ? db.collection(COL.zones).doc(id(d.zoneId, 'zoneId')) : db.collection(COL.zones).doc();
  const before = await ref.get();
  const row = { zoneId: ref.id, name: z.name, geometryJson: z.geometryJson, storeIds: z.storeIds, baseDeliveryFee: z.baseDeliveryFee, freeDeliveryAbove: z.freeDeliveryAbove, surgeMultiplierBps: z.surgeMultiplierBps, isActive: z.isActive };
  await ref.set({ ...row, updatedAt: FieldValue.serverTimestamp() });
  await writeAudit({ actorUid: c.uid, actorRole: 'super_admin', action: before.exists ? 'zones.update' : 'zones.create', target: { collection: COL.zones, id: ref.id }, before: before.exists ? { ...before.data(), geometryJson: undefined } : null, after: { ...row, geometryJson: undefined }, ip: req.rawRequest.ip ?? null });
  return row;
});

/** Adds / edits a tax-master row and re-rates every product whose most specific HSN match changes. */
export const upsertHsn = onCall({ timeoutSeconds: 120 }, async (req) => {
  const c = caller(req);
  requireRole(c, 'super_admin');
  let h;
  try {
    h = validateHsn({ hsnCode: req.data?.hsnCode, description: req.data?.description, gstSlab: Number(req.data?.gstSlab) });
  } catch (e) {
    ruleErr(e);
  }
  const ref = db.collection(COL.hsnMaster).doc(h.hsnCode);
  const before = await ref.get();
  await ref.set({ hsnCode: h.hsnCode, description: h.description, gstSlab: h.gstSlab, cessRate: Number(before.get('cessRate') ?? 0), updatedBy: c.uid, updatedAt: FieldValue.serverTimestamp() });
  const master = (await db.collection(COL.hsnMaster).get()).docs.map((m) => ({ hsnCode: m.id, gstSlab: Number(m.get('gstSlab')) }));
  // products under this code: hsnCode starts with it
  const prods = await db.collection(COL.products).where('hsnCode', '>=', h.hsnCode).where('hsnCode', '<', `${h.hsnCode}`).get();
  const changes = productsAffectedByHsn(prods.docs.map((p) => ({ productId: p.id, hsnCode: String(p.get('hsnCode')), gstSlab: Number(p.get('gstSlab')) })), master);
  for (let i = 0; i < changes.length; i += 400) {
    const b = db.batch();
    for (const ch of changes.slice(i, i + 400)) b.update(db.collection(COL.products).doc(ch.productId), { gstSlab: ch.to, updatedAt: FieldValue.serverTimestamp() });
    await b.commit();
  }
  await writeAudit({ actorUid: c.uid, actorRole: 'super_admin', action: before.exists ? 'hsn_master.update' : 'hsn_master.create', target: { collection: COL.hsnMaster, id: h.hsnCode }, before: before.exists ? before.data() : null, after: { ...h, productsUpdated: changes.length } });
  return { productsUpdated: changes.length };
});

/* ------------------------------------------------------------------ */
/* Riders                                                               */
/* ------------------------------------------------------------------ */

export const saveRiderProfile = onCall(async (req) => {
  const c = caller(req);
  requireRole(c, 'rider');
  const name = str(req.data?.name, 60, 'name');
  if (name.length < 2) throw new HttpsError('invalid-argument', 'Enter your name');
  const vehicleType = req.data?.vehicleType;
  if (!(RIDER_VEHICLES as readonly string[]).includes(vehicleType)) throw new HttpsError('invalid-argument', 'Choose your vehicle');
  const vehicleNumber = vehicleType === 'BICYCLE' ? null : normaliseVehicleNo(req.data?.vehicleNumber);
  if (vehicleType !== 'BICYCLE' && !vehicleNumber) throw new HttpsError('invalid-argument', 'Enter the vehicle number as on the RC, e.g. RJ14 CK 4821');
  await db.collection(COL.riders).doc(c.uid).set({ uid: c.uid, name, vehicleType, vehicleNumber }, { merge: true });
  await adminAuth.updateUser(c.uid, { displayName: name });
  return { ok: true };
});

export const setRiderShift = onCall(async (req) => {
  const c = caller(req);
  requireRole(c, 'rider');
  const online = req.data?.online === true;
  const loc = req.data?.location;
  const location = loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng) && Math.abs(loc.lat) <= 90 && Math.abs(loc.lng) <= 180 ? { lat: Number(loc.lat), lng: Number(loc.lng) } : null;
  await db.runTransaction(async (tx) => {
    const ref = db.collection(COL.riders).doc(c.uid);
    const r = await tx.get(ref);
    if (!r.exists) throw new HttpsError('failed-precondition', 'Ask the admin to set up your rider account');
    const s = riderState(r);
    if (online && s.kycStatus !== 'VERIFIED') throw new HttpsError('failed-precondition', 'Your documents must be verified before you can go on shift', { code: 'KYC_NOT_VERIFIED' });
    if (!online && s.activeOrderIds.length) throw new HttpsError('failed-precondition', 'Finish your deliveries before going off shift', { code: 'HAS_ORDERS' });
    tx.update(ref, { isOnline: online, lastSeenAt: FieldValue.serverTimestamp(), ...(location ? { lastLocation: location } : {}) });
  });
  return { ok: true };
});

export const assignRider = onCall(async (req) => {
  const c = caller(req);
  const orderId = id(req.data?.orderId, 'orderId');
  const riderUid = req.data?.riderUid ? id(req.data.riderUid, 'riderUid') : null;
  let prev: string | null = null;
  try {
    await db.runTransaction(async (tx) => {
      const orderRef = db.collection(COL.orders).doc(orderId);
      const o = await tx.get(orderRef);
      if (!o.exists) throw new HttpsError('not-found', 'Order not found');
      const storeId = String(o.get('storeId'));
      if (!operatesStore(c, storeId, String(o.get('vendorId')))) throw new HttpsError('permission-denied', 'You do not operate this store');
      const status = o.get('status') as OrderStatus;
      if (!ASSIGNABLE_STATUSES.includes(status)) throw new RiderError('BAD_STATUS', 'A rider can be assigned only after you accept the order and before it leaves the store');
      prev = (o.get('riderUid') as string | null) ?? null;
      const prevRef = prev ? db.collection(COL.riders).doc(prev) : null;
      const nextRef = riderUid ? db.collection(COL.riders).doc(riderUid) : null;
      const [prevSnap, nextSnap] = await Promise.all([prevRef ? tx.get(prevRef) : null, nextRef ? tx.get(nextRef) : null]);
      if (nextRef) {
        if (!nextSnap?.exists || nextSnap.get('vendorId') !== o.get('vendorId')) throw new HttpsError('not-found', 'Rider not found');
        const user = await adminAuth.getUser(riderUid!).catch(() => null);
        if (user?.customClaims?.role !== 'rider') throw new HttpsError('failed-precondition', 'This person is no longer a rider');
        const pay = o.get('payment') as { method: string; status: string };
        checkAssignRider(riderState(nextSnap), { orderId, storeId, status, paymentMethod: pay.method, paymentStatus: pay.status, grandTotal: Number((o.get('totals') as { grandTotal: number }).grandTotal), riderUid: prev });
      }
      if (prevRef && prev !== riderUid && prevSnap?.exists) tx.update(prevRef, { activeOrderIds: FieldValue.arrayRemove(orderId) });
      if (nextRef) tx.update(nextRef, { activeOrderIds: FieldValue.arrayUnion(orderId) });
      tx.update(orderRef, { riderUid, updatedAt: FieldValue.serverTimestamp() });
    });
  } catch (e) {
    ruleErr(e);
  }
  await writeAudit({ actorUid: c.uid, actorRole: c.role === 'anonymous' ? 'system' : c.role, action: riderUid ? 'order.assign_rider' : 'order.unassign_rider', target: { collection: COL.orders, id: orderId }, before: { riderUid: prev }, after: { riderUid } });
  return { ok: true };
});

/** The store counted the rider's COD cash and confirms the amount received. */
export const receiveCodCash = onCall(async (req) => {
  const c = caller(req);
  const storeId = id(req.data?.storeId, 'storeId');
  const riderUid = id(req.data?.riderUid, 'riderUid');
  const amount = Number(req.data?.amount);
  const store = await db.collection(COL.stores).doc(storeId).get();
  if (!store.exists) throw new HttpsError('not-found', 'Store not found');
  const vendorId = String(store.get('vendorId'));
  if (!operatesStore(c, storeId, vendorId)) throw new HttpsError('permission-denied', 'You do not operate this store');
  let left = 0;
  try {
    left = await db.runTransaction(async (tx) => {
      const ref = db.collection(COL.riders).doc(riderUid);
      const r = await tx.get(ref);
      if (!r.exists || r.get('vendorId') !== vendorId || r.get('homeStoreId') !== storeId) throw new HttpsError('failed-precondition', 'This rider does not work from this store');
      const plan = planCodDeposit(Number(r.get('codCashInHand') ?? 0), amount);
      tx.update(ref, { codCashInHand: plan.codCashInHand });
      tx.create(db.collection(COL.riderCash).doc(), { riderUid, vendorId, storeId, kind: 'DEPOSIT', amount: -amount, balanceAfter: plan.codCashInHand, orderId: null, confirmedBy: c.uid, at: FieldValue.serverTimestamp() });
      return plan.codCashInHand;
    });
  } catch (e) {
    ruleErr(e);
  }
  await writeAudit({ actorUid: c.uid, actorRole: c.role === 'anonymous' ? 'system' : c.role, action: 'rider.cod_deposit', target: { collection: COL.riders, id: riderUid }, after: { amount, storeId, balanceAfter: left } });
  return { codCashInHand: left };
});

/* ------------------------------------------------------------------ */
/* KYC                                                                  */
/* ------------------------------------------------------------------ */

async function rollupOwner(tx: Transaction | null, ownerUid: string, ownerType: 'VENDOR' | 'RIDER', vendorId: string | null, override?: { id: string; status: KycStatus }): Promise<KycStatus> {
  const q = ownerType === 'RIDER' ? db.collection(COL.kycDocuments).where('ownerUid', '==', ownerUid).where('ownerType', '==', 'RIDER') : db.collection(COL.kycDocuments).where('ownerType', '==', 'VENDOR').where('vendorId', '==', vendorId);
  const docs = (tx ? await tx.get(q) : await q.get()).docs.map((d) => ({ docType: d.get('docType') as KycDocType, status: d.id === override?.id ? override.status : (d.get('status') as KycStatus), createdMs: d.get('createdAt')?.toMillis?.() ?? 0 }));
  return rollupKyc(docs, ownerType === 'RIDER' ? RIDER_KYC_DOCS : VENDOR_KYC_DOCS);
}

/** New upload → owner goes to UNDER_REVIEW (or stays PENDING if documents are missing); rider goes off shift. */
export const onKycUploaded = onDocumentCreated(`${COL.kycDocuments}/{docId}`, async (event) => {
  const d = event.data;
  if (!d) return;
  const ownerType = d.get('ownerType') as 'VENDOR' | 'RIDER';
  const status = await rollupOwner(null, String(d.get('ownerUid')), ownerType, (d.get('vendorId') as string | null) ?? null);
  if (ownerType === 'RIDER') await db.collection(COL.riders).doc(String(d.get('ownerUid'))).set({ kycStatus: status, ...(status !== 'VERIFIED' ? { isOnline: false } : {}) }, { merge: true });
  else await db.collection(COL.vendors).doc(String(d.get('vendorId'))).update({ kycStatus: status, updatedAt: FieldValue.serverTimestamp() });
});

export const reviewKyc = onCall(async (req) => {
  const c = caller(req);
  requireRole(c, 'compliance', 'super_admin');
  const docId = id(req.data?.docId, 'docId');
  const decision = req.data?.decision;
  if (decision !== 'VERIFIED' && decision !== 'REJECTED') throw new HttpsError('invalid-argument', 'decision must be VERIFIED or REJECTED');
  const note = str(req.data?.note, 200, 'note', decision === 'REJECTED');
  if (decision === 'REJECTED' && note.length < 3) throw new HttpsError('invalid-argument', 'Write why it was rejected so they can upload again');
  const out = await db.runTransaction(async (tx) => {
    const ref = db.collection(COL.kycDocuments).doc(docId);
    const k = await tx.get(ref);
    if (!k.exists) throw new HttpsError('not-found', 'Document not found');
    if (k.get('status') !== 'PENDING') throw new HttpsError('failed-precondition', 'This document was already reviewed');
    const ownerType = k.get('ownerType') as 'VENDOR' | 'RIDER';
    const ownerUid = String(k.get('ownerUid'));
    const vendorId = (k.get('vendorId') as string | null) ?? null;
    const ownerStatus = await rollupOwner(tx, ownerUid, ownerType, vendorId, { id: docId, status: decision });
    tx.update(ref, { status: decision, reviewerUid: c.uid, reviewNote: note || null, reviewedAt: FieldValue.serverTimestamp() });
    if (ownerType === 'RIDER') tx.set(db.collection(COL.riders).doc(ownerUid), { kycStatus: ownerStatus, ...(ownerStatus !== 'VERIFIED' ? { isOnline: false } : {}) }, { merge: true });
    else if (vendorId) tx.update(db.collection(COL.vendors).doc(vendorId), { kycStatus: ownerStatus, updatedAt: FieldValue.serverTimestamp() });
    return { ownerStatus, docType: k.get('docType'), ownerUid };
  });
  await writeAudit({ actorUid: c.uid, actorRole: c.role as 'compliance', action: `kyc.${decision === 'VERIFIED' ? 'verify' : 'reject'}`, target: { collection: COL.kycDocuments, id: docId }, before: { status: 'PENDING' }, after: { status: decision, note: note || null, ...out } });
  return { ownerStatus: out.ownerStatus };
});

/* ------------------------------------------------------------------ */
/* Recalls                                                              */
/* ------------------------------------------------------------------ */

const SALE_MOVES = ['ONLINE_SALE', 'OFFLINE_QR_SALE', 'POS_WALKIN_SALE', 'ORDER_CANCEL_RESTOCK'];

export const createRecall = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async (req) => {
  const c = caller(req);
  requireRole(c, 'compliance', 'super_admin');
  const productId = id(req.data?.productId, 'productId');
  const reason = str(req.data?.reason, 300, 'reason');
  if (reason.length < 5) throw new HttpsError('invalid-argument', 'Write the recall reason (what is wrong and who asked for it)');
  const batchNumbers: string[] = Array.isArray(req.data?.batchNumbers) ? req.data.batchNumbers.slice(0, 50).map((b: unknown) => String(b).trim().toUpperCase()).filter(Boolean) : [];
  const recallRef = db.collection(COL.recalls).doc();
  const prodRef = db.collection(COL.products).doc(productId);
  const pre = await prodRef.get();
  if (!pre.exists) throw new HttpsError('not-found', 'Product not found');
  const vendorId = String(pre.get('vendorId'));
  const storeIds = (await db.collection(COL.stores).where('vendorId', '==', vendorId).get()).docs.map((s) => s.id);

  let result: { unitsRemoved: number; stores: { storeId: string; unitsRemoved: number }[]; matched: string[]; batchNumbers: string[] };
  try {
    result = await db.runTransaction(async (tx) => {
      const nowMs = Date.now();
      const invSnaps = await tx.getAll(...storeIds.map((s) => invRef(s, productId)));
      const stores = [];
      for (const inv of invSnaps) {
        if (!inv.exists) continue;
        const storeId = String(inv.get('storeId'));
        const batches = (await tx.get(invRef(storeId, productId).collection(COL.batches))).docs.map(batchFromDoc);
        stores.push({ storeId, reorderThreshold: Number(inv.get('reorderThreshold') ?? 0), batches });
      }
      const plan = planRecall(productId, batchNumbers, stores, nowMs);
      for (const sp of plan.stores) {
        const ir = invRef(sp.storeId, productId);
        for (const w of sp.batchWrites) tx.update(ir.collection(COL.batches).doc(w.batchId), { qty: 0, recalled: true });
        tx.update(ir, { onHand: sp.inventory.onHand, lowStock: sp.inventory.lowStock, nearestExpiry: msToTs(sp.inventory.nearestExpiryMs), nextBatchNumber: sp.inventory.nextBatchNumber, updatedAt: FieldValue.serverTimestamp() });
        for (const l of sp.ledger) tx.create(db.collection(COL.stockLedger).doc(), { storeId: sp.storeId, vendorId, productId, batchId: l.batchId, movement: l.movement, qtyDelta: l.qtyDelta, balanceAfter: l.balanceAfter, refType: 'RECALL', refId: recallRef.id, reason, byUid: c.uid, at: FieldValue.serverTimestamp() });
      }
      if (plan.wholeProduct) tx.update(prodRef, { complianceStatus: 'RECALLED', isPublished: false, complianceNote: reason, updatedAt: FieldValue.serverTimestamp() });
      const numbers = plan.wholeProduct ? [] : [...new Set(plan.stores.flatMap((s) => s.batchWrites.map((w) => w.batchNumber.trim().toUpperCase())))];
      tx.create(recallRef, { productId, productName: String(pre.get('name')), vendorId, batchNumbers: numbers, matchedBatchIds: plan.matchedBatchIds, reason, initiatedBy: c.uid, status: 'ACTIVE', unitsRemoved: plan.unitsRemoved, createdAt: FieldValue.serverTimestamp(), completedAt: null });
      return { unitsRemoved: plan.unitsRemoved, stores: plan.stores.map((s) => ({ storeId: s.storeId, unitsRemoved: s.unitsRemoved })), matched: plan.matchedBatchIds, batchNumbers: numbers };
    });
  } catch (e) {
    ruleErr(e);
  }

  // Traceability (outside the transaction): units already sold from these batches, and open orders holding them.
  let unitsSold = 0;
  for (let i = 0; i < result.matched.length; i += 30) {
    const q = await db.collection(COL.stockLedger).where('vendorId', '==', vendorId).where('batchId', 'in', result.matched.slice(i, i + 30)).get();
    for (const l of q.docs) if (SALE_MOVES.includes(String(l.get('movement')))) unitsSold -= Number(l.get('qtyDelta') ?? 0);
  }
  const matched = new Set(result.matched);
  const open = await db.collection(COL.orders).where('vendorId', '==', vendorId).where('status', 'in', ['PLACED', 'ACCEPTED', 'PICKING', 'PACKED', 'HANDED_TO_RIDER', 'OUT_FOR_DELIVERY']).get();
  const openOrderIds = open.docs.filter((o) => ((o.get('lines') as { batchAllocations: { batchId: string }[] }[]) ?? []).some((l) => l.batchAllocations.some((a) => matched.has(a.batchId)))).map((o) => o.id);
  await writeAudit({ actorUid: c.uid, actorRole: c.role as 'compliance', action: 'recall.create', target: { collection: COL.recalls, id: recallRef.id }, after: { productId, batchNumbers: result.batchNumbers, unitsRemoved: result.unitsRemoved, unitsSold, openOrderIds } });
  return { recallId: recallRef.id, unitsRemoved: result.unitsRemoved, stores: result.stores, unitsSold: Math.round(unitsSold * 1000) / 1000, openOrderIds };
});

export const completeRecall = onCall(async (req) => {
  const c = caller(req);
  requireRole(c, 'compliance', 'super_admin');
  const recallId = id(req.data?.recallId, 'recallId');
  const ref = db.collection(COL.recalls).doc(recallId);
  const r = await ref.get();
  if (!r.exists) throw new HttpsError('not-found', 'Recall not found');
  if (r.get('status') === 'COMPLETED') return { ok: true };
  await ref.update({ status: 'COMPLETED', completedAt: FieldValue.serverTimestamp() });
  await writeAudit({ actorUid: c.uid, actorRole: c.role as 'compliance', action: 'recall.complete', target: { collection: COL.recalls, id: recallId }, before: { status: 'ACTIVE' }, after: { status: 'COMPLETED' } });
  return { ok: true };
});

/** Batch ids marked recalled for the given products in a store (dispatch guard). */
export async function recalledBatchIds(tx: Transaction, storeId: string, productIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const p of productIds) {
    const q = await tx.get(db.collection(COL.storeInventory).doc(inventoryDocId(storeId, p)).collection(COL.batches).where('recalled', '==', true));
    q.docs.forEach((d) => out.add(d.id));
  }
  return out;
}
