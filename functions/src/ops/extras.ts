/**
 * Phase 4 extras: rider payouts, proof-of-delivery photo, live tracking for customers.
 * Hygiene checklists are written straight to Firestore (compliance_checks rules validate them);
 * the rider's location ping is a direct write to riders/{uid}.lastLocation (rules allow it).
 */
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { checkPod, COL, ExtrasError, planPayout, TRACKABLE, trackEstimate, type OrderStatus } from '@pansari/shared';
import { db, writeAudit } from '../lib/admin.js';
import { caller, id, operatesStore, str, tsToMs } from '../lib/model.js';

function extrasErr(e: unknown): never {
  if (e instanceof ExtrasError) throw new HttpsError('failed-precondition', e.message, { code: e.code });
  throw e;
}

/** Shop owner (or super admin) records a payout of the rider's earnings. Money moves outside the app. */
export const payRider = onCall(async (req) => {
  const c = caller(req);
  const riderUid = id(req.data?.riderUid, 'riderUid');
  const amount = Number(req.data?.amount);
  const method = String(req.data?.method ?? '');
  const reference = str(req.data?.reference ?? '', 60, 'reference', false);
  let out: { earningsBalance: number; vendorId: string; method: string; reference: string } | null = null;
  try {
    out = await db.runTransaction(async (tx) => {
      const ref = db.collection(COL.riders).doc(riderUid);
      const r = await tx.get(ref);
      if (!r.exists) throw new HttpsError('not-found', 'Rider not found');
      const vendorId = String(r.get('vendorId') ?? '');
      if (!(c.role === 'super_admin' || (c.role === 'seller' && c.claims.vendorId === vendorId))) throw new HttpsError('permission-denied', 'Only the shop owner or admin pays riders');
      const plan = planPayout(Number(r.get('earningsBalance') ?? 0), amount, method, reference);
      tx.update(ref, { earningsBalance: plan.earningsBalance });
      tx.create(db.collection(COL.payouts).doc(), { riderUid, riderName: r.get('name') ?? null, vendorId, amount, method: plan.method, reference: plan.reference, paidBy: c.uid, at: FieldValue.serverTimestamp() });
      return { earningsBalance: plan.earningsBalance, vendorId, method: plan.method, reference: plan.reference };
    });
  } catch (e) {
    extrasErr(e);
  }
  await writeAudit({ actorUid: c.uid, actorRole: c.role as 'seller', action: 'rider.payout', target: { collection: COL.riders, id: riderUid }, after: { amount, method: out!.method, reference: out!.reference, earningsBalance: out!.earningsBalance } });
  return { earningsBalance: out!.earningsBalance };
});

/** After uploading pod/{riderUid}/{orderId}/{file}, the rider links it to the order. */
export const attachPod = onCall(async (req) => {
  const c = caller(req);
  if (c.role !== 'rider') throw new HttpsError('permission-denied', 'Only the rider adds a delivery photo');
  const orderId = id(req.data?.orderId, 'orderId');
  const path = String(req.data?.storagePath ?? '');
  if (!path.startsWith(`pod/${c.uid}/${orderId}/`) || path.length > 200 || path.includes('..')) throw new HttpsError('invalid-argument', 'Bad photo path');
  const ref = db.collection(COL.orders).doc(orderId);
  const o = await ref.get();
  if (!o.exists) throw new HttpsError('not-found', 'Order not found');
  const hist = (o.get('statusHistory') as { status: OrderStatus; at: number }[] | undefined) ?? [];
  const deliveredMs = [...hist].reverse().find((h) => h.status === 'DELIVERED')?.at ?? null;
  try {
    checkPod(c.uid, { riderUid: (o.get('riderUid') as string | null) ?? null, status: o.get('status') as OrderStatus, deliveredMs }, Date.now());
  } catch (e) {
    extrasErr(e);
  }
  await ref.update({ podPath: path, podAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  await writeAudit({ actorUid: c.uid, actorRole: 'rider', action: 'order.pod', target: { collection: COL.orders, id: orderId }, after: { podPath: path } });
  return { ok: true };
});

/** Customer (or the store) gets the rider's last position while the order is with the rider. */
export const trackRider = onCall(async (req) => {
  const c = caller(req);
  const orderId = id(req.data?.orderId, 'orderId');
  const o = await db.collection(COL.orders).doc(orderId).get();
  if (!o.exists) throw new HttpsError('not-found', 'Order not found');
  const mine = o.get('customerUid') === c.uid;
  if (!mine && !operatesStore(c, String(o.get('storeId')), String(o.get('vendorId'))) && c.role !== 'super_admin') throw new HttpsError('permission-denied', 'Not allowed');
  const riderUid = o.get('riderUid') as string | null;
  if (!riderUid || !TRACKABLE.includes(o.get('status') as OrderStatus)) return null;
  const r = await db.collection(COL.riders).doc(riderUid).get();
  const loc = r.get('lastLocation') as { lat: number; lng: number } | null;
  const at = tsToMs(r.get('lastSeenAt'));
  const dest = (o.get('deliveryAddress') as { location: { lat: number; lng: number } } | null)?.location;
  if (!loc || !at || !dest) return null;
  return trackEstimate({ ...loc, atMs: at }, dest, Date.now());
});
