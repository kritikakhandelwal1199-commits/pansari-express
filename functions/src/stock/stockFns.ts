/**
 * Catalogue, pricing and stock movements. Every function runs in a Firestore
 * transaction and writes a stock_ledger entry for each quantity change.
 */
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { COL, GST_SLABS, inventoryDocId, isValidHsn, planAdjust, planInward, UQC, type Uqc } from '@pansari/shared';
import { db, writeAudit } from '../lib/admin.js';
import { batchFromDoc, batchesCol, caller, id, invRef, msToTs, paise, parseIstDate, requireOperator, str, toHttps } from '../lib/model.js';

async function storeOf(storeId: string) {
  const s = await db.collection(COL.stores).doc(storeId).get();
  if (!s.exists) throw new HttpsError('not-found', 'Store not found');
  return { vendorId: String(s.get('vendorId')), name: String(s.get('name')) };
}

function searchTokens(...parts: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const w of parts.join(' ').toLowerCase().split(/[^a-z0-9ऀ-ॿ]+/)) {
    if (w.length < 2) continue;
    for (let i = 2; i <= Math.min(w.length, 12); i++) out.add(w.slice(0, i));
  }
  return [...out].slice(0, 60);
}

/* ------------------------------------------------------------------ */
/* upsertProduct — seller creates/edits; GST slab comes from hsn_master */
/* ------------------------------------------------------------------ */
export const upsertProduct = onCall(async (req) => {
  const c = caller(req);
  if (c.role !== 'seller' || !c.claims.vendorId) throw new HttpsError('permission-denied', 'Only the shop owner can edit the catalogue');
  const d = (req.data ?? {}) as Record<string, unknown>;
  const vendorId = c.claims.vendorId;
  const hsnCode = str(d.hsnCode, 8, 'HSN code');
  if (!isValidHsn(hsnCode)) throw new HttpsError('invalid-argument', 'HSN must be 4, 6 or 8 digits');
  const unit = str(d.unit, 3, 'unit') as Uqc;
  if (!(UQC as readonly string[]).includes(unit)) throw new HttpsError('invalid-argument', 'Unknown unit');
  const taxType = d.taxType === 'EXCLUSIVE' ? 'EXCLUSIVE' : 'INCLUSIVE';
  const mrp = paise(d.mrp, 'MRP', 1);

  // Tax rate is never taken from the client: look it up in the master (try 8 → 6 → 4 digits).
  const candidates = [hsnCode, hsnCode.slice(0, 6), hsnCode.slice(0, 4)].filter((h, i, a) => isValidHsn(h) && a.indexOf(h) === i);
  let master: FirebaseFirestore.DocumentSnapshot | null = null;
  for (const h of candidates) {
    const m = await db.collection(COL.hsnMaster).doc(h).get();
    if (m.exists) {
      master = m;
      break;
    }
  }
  if (!master) throw new HttpsError('failed-precondition', `HSN ${hsnCode} is not in the tax master yet — ask the admin to add it with its GST rate`);
  const gstSlab = Number(master.get('gstSlab'));
  if (!(GST_SLABS as readonly number[]).includes(gstSlab)) throw new HttpsError('internal', 'Tax master has an invalid slab');

  const productId = d.productId ? id(d.productId, 'productId') : db.collection(COL.products).doc().id;
  const ref = db.collection(COL.products).doc(productId);
  const name = str(d.name, 120, 'name');
  const brand = str(d.brand, 60, 'brand', false) || null;
  const fields = {
    productId,
    vendorId,
    name,
    nameHi: str(d.nameHi, 120, 'Hindi name', false) || null,
    category: str(d.category, 30, 'category'),
    brand,
    barcode: str(d.barcode, 32, 'barcode', false) || null,
    unit,
    netQuantity: str(d.netQuantity, 30, 'net quantity'),
    hsnCode,
    gstSlab,
    cessRate: Number(master.get('cessRate') ?? 0),
    taxType,
    mrp,
    manufacturerName: str(d.manufacturerName, 120, 'manufacturer', false) || null,
    manufacturerAddress: str(d.manufacturerAddress, 240, 'manufacturer address', false) || null,
    countryOfOrigin: str(d.countryOfOrigin, 40, 'country of origin', false) || 'India',
    customerCareDetails: str(d.customerCareDetails, 200, 'customer care', false) || null,
    fssaiRequired: d.fssaiRequired === true,
    isVeg: typeof d.isVeg === 'boolean' ? d.isVeg : null,
    searchTokens: searchTokens(name, brand, str(d.nameHi, 120, 'Hindi name', false)),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const result = await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (cur.exists && cur.get('vendorId') !== vendorId) throw new HttpsError('permission-denied', 'Not your product');
    const material = !cur.exists || ['name', 'hsnCode', 'mrp', 'netQuantity', 'manufacturerName', 'unit', 'taxType'].some((k) => cur.get(k) !== (fields as Record<string, unknown>)[k]);
    tx.set(
      ref,
      {
        ...fields,
        images: cur.exists ? cur.get('images') ?? [] : [],
        complianceStatus: material ? 'PENDING_REVIEW' : cur.get('complianceStatus'),
        complianceNote: material ? null : cur.get('complianceNote') ?? null,
        isPublished: material ? false : cur.get('isPublished') === true,
        ...(cur.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    );
    return { created: !cur.exists, sentForReview: material };
  });
  await writeAudit({ actorUid: c.uid, actorRole: 'seller', action: result.created ? 'product.create' : 'product.update', target: { collection: COL.products, id: productId }, after: { name, hsnCode, gstSlab, mrp } });
  return { productId, gstSlab, ...result };
});

/* ------------------------------------------------------------------ */
/* reviewProduct — compliance / super admin approve listings           */
/* ------------------------------------------------------------------ */
export const reviewProduct = onCall(async (req) => {
  const c = caller(req);
  if (c.role !== 'compliance' && c.role !== 'super_admin') throw new HttpsError('permission-denied', 'Compliance only');
  const productId = id(req.data?.productId, 'productId');
  const decision = req.data?.decision;
  if (decision !== 'APPROVED' && decision !== 'REJECTED') throw new HttpsError('invalid-argument', 'decision must be APPROVED or REJECTED');
  const note = str(req.data?.note, 300, 'note', decision === 'REJECTED');
  const ref = db.collection(COL.products).doc(productId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Product not found');
  if (snap.get('complianceStatus') === 'RECALLED') throw new HttpsError('failed-precondition', 'This product is under recall — it cannot be re-approved here');
  await ref.update({ complianceStatus: decision, complianceNote: note || null, isPublished: decision === 'APPROVED', updatedAt: FieldValue.serverTimestamp() });
  await writeAudit({ actorUid: c.uid, actorRole: c.role as 'compliance', action: `product.${decision.toLowerCase()}`, target: { collection: COL.products, id: productId }, after: { note } });
  return { ok: true };
});

/* ------------------------------------------------------------------ */
/* setStorePrice — owner sets the shelf price (≤ MRP) per store         */
/* ------------------------------------------------------------------ */
export const setStorePrice = onCall(async (req) => {
  const c = caller(req);
  const storeId = id(req.data?.storeId, 'storeId');
  const productId = id(req.data?.productId, 'productId');
  const sellingPrice = paise(req.data?.sellingPrice, 'selling price', 1);
  const store = await storeOf(storeId);
  requireOperator(c, storeId, store.vendorId, { sellerOnly: true });
  try {
    return await db.runTransaction(async (tx) => {
      const p = await tx.get(db.collection(COL.products).doc(productId));
      if (!p.exists || p.get('vendorId') !== store.vendorId) throw new HttpsError('not-found', 'Product not found');
      const mrp = req.data?.mrp === undefined ? Number(p.get('mrp')) : paise(req.data.mrp, 'MRP', 1);
      if (sellingPrice > mrp) throw new HttpsError('invalid-argument', 'Selling price cannot be above MRP');
      const ref = invRef(storeId, productId);
      const inv = await tx.get(ref);
      const before = inv.exists ? Number(inv.get('sellingPrice')) : null;
      if (inv.exists) {
        tx.update(ref, { sellingPrice, mrp, productName: p.get('name'), updatedAt: FieldValue.serverTimestamp() });
      } else {
        tx.set(ref, { storeId, vendorId: store.vendorId, productId, productName: p.get('name'), sellingPrice, mrp, onHand: 0, reorderThreshold: 5, aisleBinCode: '', isListed: true, lowStock: true, nearestExpiry: null, nextBatchNumber: null, updatedAt: FieldValue.serverTimestamp() });
      }
      return { ok: true, before, after: sellingPrice };
    });
  } catch (e) {
    toHttps(e);
  }
});

/* ------------------------------------------------------------------ */
/* inwardStock — receive a supplier batch                              */
/* ------------------------------------------------------------------ */
export const inwardStock = onCall(async (req) => {
  const c = caller(req);
  const d = (req.data ?? {}) as Record<string, unknown>;
  const storeId = id(d.storeId, 'storeId');
  const productId = id(d.productId, 'productId');
  const store = await storeOf(storeId);
  requireOperator(c, storeId, store.vendorId);
  const input = {
    productId,
    batchNumber: str(d.batchNumber, 20, 'batch number'),
    mfgMs: parseIstDate(d.mfgDate, false),
    expiryMs: parseIstDate(d.expiryDate, true),
    qty: Number(d.qty),
    purchasePrice: paise(d.purchasePrice, 'purchase price'),
    mrp: paise(d.mrp, 'MRP', 1),
    reference: str(d.reference, 40, 'bill / PO number'),
  };
  try {
    return await db.runTransaction(async (tx) => {
      const product = await tx.get(db.collection(COL.products).doc(productId));
      if (!product.exists || product.get('vendorId') !== store.vendorId) throw new HttpsError('not-found', 'Product not found');
      const ref = invRef(storeId, productId);
      const inv = await tx.get(ref);
      const all = (await tx.get(batchesCol(storeId, productId))).docs.map(batchFromDoc);
      const newRef = batchesCol(storeId, productId).doc();
      const plan = planInward(input, { nowMs: Date.now(), unit: product.get('unit'), reorderThreshold: inv.exists ? Number(inv.get('reorderThreshold')) : 5, batches: all, newBatchId: newRef.id });
      const bRef = plan.isNewBatch ? newRef : batchesCol(storeId, productId).doc(plan.batch.batchId);
      if (plan.isNewBatch) {
        tx.set(bRef, {
          batchId: bRef.id,
          storeId,
          vendorId: store.vendorId,
          productId,
          batchNumber: plan.batch.batchNumber,
          mfgDate: msToTs(plan.batch.mfgMs),
          expiryDate: msToTs(plan.batch.expiryMs),
          purchasePrice: plan.batch.purchasePrice,
          mrp: plan.batch.mrp,
          qty: plan.batch.qty,
          receivedAt: FieldValue.serverTimestamp(),
          receivedBy: c.uid,
          recalled: false,
        });
      } else {
        tx.update(bRef, { qty: plan.batch.qty });
      }
      const derived = { onHand: plan.inventory.onHand, lowStock: plan.inventory.lowStock, nearestExpiry: msToTs(plan.inventory.nearestExpiryMs), nextBatchNumber: plan.inventory.nextBatchNumber, updatedAt: FieldValue.serverTimestamp() };
      if (inv.exists) tx.update(ref, derived);
      else tx.set(ref, { storeId, vendorId: store.vendorId, productId, productName: product.get('name'), sellingPrice: 0, mrp: plan.mrp, reorderThreshold: 5, aisleBinCode: '', isListed: false, ...derived });
      tx.create(db.collection(COL.stockLedger).doc(), {
        storeId,
        vendorId: store.vendorId,
        productId,
        batchId: bRef.id,
        movement: 'INWARD_PO',
        qtyDelta: plan.ledger.qtyDelta,
        balanceAfter: plan.ledger.balanceAfter,
        refType: 'PURCHASE',
        refId: input.reference,
        reason: null,
        byUid: c.uid,
        at: FieldValue.serverTimestamp(),
      });
      const currentPrice = inv.exists ? Number(inv.get('sellingPrice')) : 0;
      return {
        batchId: bRef.id,
        onHand: plan.inventory.onHand,
        warning: currentPrice > plan.mrp ? `Shelf price is above this batch's MRP (${plan.mrp / 100}). Lower the price before selling it.` : !inv.exists ? 'Set a selling price before this item can be sold.' : null,
      };
    });
  } catch (e) {
    toHttps(e);
  }
});

/* ------------------------------------------------------------------ */
/* adjustStock — returns, damage write-offs, cycle counts              */
/* ------------------------------------------------------------------ */
export const adjustStock = onCall(async (req) => {
  const c = caller(req);
  const d = (req.data ?? {}) as Record<string, unknown>;
  const storeId = id(d.storeId, 'storeId');
  const productId = id(d.productId, 'productId');
  const batchId = id(d.batchId, 'batchId');
  const movement = d.movement;
  if (movement !== 'CUSTOMER_RETURN' && movement !== 'DAMAGED_WRITE_OFF' && movement !== 'CYCLE_COUNT_ADJUSTMENT') throw new HttpsError('invalid-argument', 'Unknown adjustment');
  const store = await storeOf(storeId);
  requireOperator(c, storeId, store.vendorId);
  try {
    return await db.runTransaction(async (tx) => {
      const product = await tx.get(db.collection(COL.products).doc(productId));
      const ref = invRef(storeId, productId);
      const inv = await tx.get(ref);
      if (!product.exists || !inv.exists) throw new HttpsError('not-found', 'Item not stocked here');
      const all = (await tx.get(batchesCol(storeId, productId))).docs.map(batchFromDoc);
      const plan = planAdjust(
        { productId, batchId, movement, qty: d.qty === undefined ? undefined : Number(d.qty), countedQty: d.countedQty === undefined ? undefined : Number(d.countedQty), reason: str(d.reason, 200, 'reason') },
        { nowMs: Date.now(), unit: product.get('unit'), reorderThreshold: Number(inv.get('reorderThreshold')), batches: all },
      );
      tx.update(batchesCol(storeId, productId).doc(batchId) as DocumentReference, { qty: plan.batch.qty });
      tx.update(ref, { onHand: plan.inventory.onHand, lowStock: plan.inventory.lowStock, nearestExpiry: msToTs(plan.inventory.nearestExpiryMs), nextBatchNumber: plan.inventory.nextBatchNumber, updatedAt: FieldValue.serverTimestamp() });
      tx.create(db.collection(COL.stockLedger).doc(), {
        storeId,
        vendorId: store.vendorId,
        productId,
        batchId,
        movement,
        qtyDelta: plan.ledger.qtyDelta,
        balanceAfter: plan.ledger.balanceAfter,
        refType: 'ADJUSTMENT',
        refId: inventoryDocId(storeId, productId),
        reason: str(d.reason, 200, 'reason'),
        byUid: c.uid,
        at: FieldValue.serverTimestamp(),
      });
      return { onHand: plan.inventory.onHand, qtyDelta: plan.ledger.qtyDelta };
    });
  } catch (e) {
    toHttps(e);
  }
});
