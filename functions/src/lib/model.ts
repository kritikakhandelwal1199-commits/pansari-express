/** Firestore ↔ planner-state conversion and shared authorisation helpers. */
import { Timestamp, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { COL, inventoryDocId, isRole, StockError, type BatchState, type InventoryState, type PansariClaims, type ProductTax, type Role } from '@pansari/shared';
import { db } from './admin.js';

export const tsToMs = (t: unknown): number | null => (t instanceof Timestamp ? t.toMillis() : null);
export const msToTs = (ms: number | null): Timestamp | null => (ms === null ? null : Timestamp.fromMillis(ms));

/** "2027-09-30" → end of that day in IST (expiry) or start of day (mfg). */
export function parseIstDate(v: unknown, endOfDay: boolean): number | null {
  if (v === null || v === undefined || v === '') return null;
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  if (!m) throw new HttpsError('invalid-argument', 'Dates must be YYYY-MM-DD');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = endOfDay ? Date.UTC(y, mo - 1, d, 18, 29, 59) : Date.UTC(y, mo - 1, d, 0, 0, 0) - 330 * 60 * 1000;
  if (Number.isNaN(ms)) throw new HttpsError('invalid-argument', 'Invalid date');
  return ms;
}

export function batchFromDoc(d: DocumentSnapshot): BatchState {
  return {
    batchId: d.id,
    batchNumber: String(d.get('batchNumber')),
    mfgMs: tsToMs(d.get('mfgDate')),
    expiryMs: tsToMs(d.get('expiryDate')),
    receivedMs: tsToMs(d.get('receivedAt')) ?? 0,
    qty: Number(d.get('qty') ?? 0),
    recalled: d.get('recalled') === true,
    purchasePrice: Number(d.get('purchasePrice') ?? 0),
    mrp: Number(d.get('mrp') ?? 0),
  };
}

export function inventoryFromDoc(d: DocumentSnapshot): InventoryState {
  return {
    productId: String(d.get('productId')),
    productName: String(d.get('productName') ?? ''),
    sellingPrice: Number(d.get('sellingPrice') ?? 0),
    mrp: Number(d.get('mrp') ?? 0),
    onHand: Number(d.get('onHand') ?? 0),
    reorderThreshold: Number(d.get('reorderThreshold') ?? 0),
    aisleBinCode: String(d.get('aisleBinCode') ?? ''),
    isListed: d.get('isListed') === true,
  };
}

export function productTaxFromDoc(d: DocumentSnapshot): ProductTax {
  return {
    productId: d.id,
    name: String(d.get('name')),
    hsnCode: String(d.get('hsnCode')),
    gstSlab: Number(d.get('gstSlab')) as ProductTax['gstSlab'],
    cessRate: Number(d.get('cessRate') ?? 0),
    taxType: d.get('taxType') === 'EXCLUSIVE' ? 'EXCLUSIVE' : 'INCLUSIVE',
    unit: d.get('unit'),
    complianceStatus: d.get('complianceStatus'),
  };
}

export const invRef = (storeId: string, productId: string) => db.collection(COL.storeInventory).doc(inventoryDocId(storeId, productId));
export const batchesCol = (storeId: string, productId: string) => invRef(storeId, productId).collection(COL.batches);

export async function readBatches(tx: Transaction, storeId: string, productId: string): Promise<BatchState[]> {
  const q = await tx.get(batchesCol(storeId, productId).where('qty', '>', 0));
  return q.docs.map(batchFromDoc);
}

/* ------------------------------------------------------------------ */
/* Authorisation                                                        */
/* ------------------------------------------------------------------ */

export interface Caller {
  uid: string;
  role: Role | 'anonymous';
  claims: PansariClaims;
  isAnonymous: boolean;
}

export function caller(req: CallableRequest): Caller {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first');
  const t = req.auth.token as Record<string, unknown>;
  const provider = (t.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
  const isAnonymous = provider === 'anonymous';
  const r = t.role;
  const role: Caller['role'] = r === 'temp_qr_guest' ? (isAnonymous ? 'temp_qr_guest' : 'customer') : isRole(r) ? r : isAnonymous ? 'anonymous' : 'customer';
  return {
    uid: req.auth.uid,
    role,
    isAnonymous,
    claims: {
      role: isRole(r) ? r : undefined,
      vendorId: typeof t.vendorId === 'string' ? t.vendorId : undefined,
      storeIds: Array.isArray(t.storeIds) ? (t.storeIds as string[]) : undefined,
      scopedStoreId: typeof t.scopedStoreId === 'string' ? t.scopedStoreId : undefined,
      qrExp: typeof t.qrExp === 'number' ? t.qrExp : undefined,
    },
  };
}

export function operatesStore(c: Caller, storeId: string, vendorId: string, opts: { sellerOnly?: boolean } = {}): boolean {
  if (!c.claims.vendorId || c.claims.vendorId !== vendorId) return false;
  const ids = c.claims.storeIds ?? [];
  if (c.role === 'seller') return ids.length === 0 || ids.includes(storeId);
  if (c.role === 'staff' && !opts.sellerOnly) return ids.includes(storeId);
  return false;
}

export function requireOperator(c: Caller, storeId: string, vendorId: string, opts: { sellerOnly?: boolean } = {}): void {
  if (!operatesStore(c, storeId, vendorId, opts)) throw new HttpsError('permission-denied', opts.sellerOnly ? 'Only the shop owner can do this' : 'You do not operate this store');
}

export function isGuestOf(c: Caller, storeId: string): boolean {
  return c.role === 'temp_qr_guest' && c.claims.scopedStoreId === storeId && (c.claims.qrExp ?? 0) > Date.now() / 1000;
}

export function toHttps(e: unknown): never {
  if (e instanceof HttpsError) throw e;
  if (e instanceof StockError) throw new HttpsError(e.code === 'OUT_OF_STOCK' || e.code === 'NOT_FOR_SALE' ? 'failed-precondition' : 'invalid-argument', e.message, { code: e.code, productId: e.productId, available: e.available });
  if (e instanceof Error && e.name === 'GstValidationError') throw new HttpsError('invalid-argument', e.message);
  throw e;
}

export const str = (v: unknown, max: number, field: string, required = true): string => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpsError('invalid-argument', `${field} is required`);
    return '';
  }
  if (typeof v !== 'string' || v.length > max) throw new HttpsError('invalid-argument', `${field} is invalid`);
  return v.trim();
};

export const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const id = (v: unknown, field: string): string => {
  if (typeof v !== 'string' || !ID.test(v)) throw new HttpsError('invalid-argument', `${field} is invalid`);
  return v;
};
export const paise = (v: unknown, field: string, min = 0): number => {
  if (!Number.isSafeInteger(v) || (v as number) < min) throw new HttpsError('invalid-argument', `${field} must be a whole number of paise ≥ ${min}`);
  return v as number;
};
