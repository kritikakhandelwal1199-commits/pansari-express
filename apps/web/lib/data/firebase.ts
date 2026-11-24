/**
 * FirebaseDataClient — production data layer.
 * Reads go straight to Firestore (guarded by firestore.rules); every write that
 * touches money, tax or stock goes through a Cloud Function; QR / checkout
 * tokens go through the Cloudflare edge worker.
 *
 * The walk-in storefront uses a SECOND Firebase app instance ("guest") so an
 * anonymous shopper session never signs a cashier out on a shared device.
 */
import { initializeApp, getApps, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  linkWithPhoneNumber,
  onIdTokenChanged,
  RecaptchaVerifier,
  signInAnonymously,
  signInWithPhoneNumber,
  signOut,
  type Auth,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { COL, inventoryDocId, isRole, randomId, TEMP_CART_TTL_SECONDS, type BatchState, type InvoiceComputation } from '@pansari/shared';
import type { AdjustInput, AppUser, DataClient, GuestCart, HsnRow, InventoryRow, InvoiceRow, InwardInput, LedgerRow, ProductInfo, ProductInput, SaleInput, SaleResult, StoreInfo } from './types';
import { DataError } from './types';

export interface FirebaseClientConfig {
  firebase: FirebaseOptions;
  functionsRegion: string;
  edgeUrl: string;
  useEmulators: boolean;
}

interface Ctx {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  fns: Functions;
}

const ms = (t: unknown): number | null => (t instanceof Timestamp ? t.toMillis() : null);

function connect(cfg: FirebaseClientConfig, name?: string): Ctx {
  const existing = getApps().find((a) => a.name === (name ?? '[DEFAULT]'));
  const app = existing ?? initializeApp(cfg.firebase, name);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const fns = getFunctions(app, cfg.functionsRegion);
  if (cfg.useEmulators && !existing) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectFunctionsEmulator(fns, '127.0.0.1', 5001);
    auth.settings.appVerificationDisabledForTesting = true;
  }
  return { app, auth, db, fns };
}

async function toAppUser(u: User, force = false): Promise<AppUser> {
  const r = await u.getIdTokenResult(force);
  const c = r.claims as Record<string, unknown>;
  const isAnonymous = u.isAnonymous;
  const claimRole = c.role;
  const role: AppUser['role'] = claimRole === 'temp_qr_guest' ? (isAnonymous ? 'temp_qr_guest' : 'customer') : isRole(claimRole) ? claimRole : isAnonymous ? 'anonymous' : 'customer';
  return {
    uid: u.uid,
    phone: u.phoneNumber,
    displayName: u.displayName,
    role,
    vendorId: typeof c.vendorId === 'string' ? c.vendorId : undefined,
    storeIds: Array.isArray(c.storeIds) ? (c.storeIds as string[]) : undefined,
    scopedStoreId: typeof c.scopedStoreId === 'string' ? c.scopedStoreId : undefined,
    qrExp: typeof c.qrExp === 'number' ? c.qrExp : undefined,
    isAnonymous,
  };
}

function fnError(e: unknown): never {
  const err = e as { message?: string; code?: string; details?: Record<string, unknown> };
  throw new DataError(err.message ?? 'Request failed', (err.details?.code as string | undefined) ?? err.code, err.details);
}

function storeFrom(id: string, d: DocumentData): StoreInfo {
  return {
    storeId: id,
    vendorId: d.vendorId,
    name: d.name,
    type: d.type,
    addressLine: d.addressLine ?? '',
    city: d.city ?? '',
    pincode: d.pincode ?? '',
    stateCode: d.stateCode,
    upiVpa: d.upiVpa ?? null,
    acceptsWalkInQr: d.acceptsWalkInQr !== false,
    qrKeyVersion: Number(d.qrKeyVersion ?? 1),
  };
}

function productFrom(id: string, d: DocumentData): ProductInfo {
  return {
    productId: id,
    name: d.name,
    nameHi: d.nameHi ?? null,
    category: d.category,
    brand: d.brand ?? null,
    barcode: d.barcode ?? null,
    unit: d.unit,
    netQuantity: d.netQuantity ?? '',
    hsnCode: d.hsnCode,
    gstSlab: d.gstSlab,
    taxType: d.taxType,
    mrp: d.mrp,
    manufacturerName: d.manufacturerName ?? null,
    countryOfOrigin: d.countryOfOrigin ?? 'India',
    fssaiRequired: d.fssaiRequired === true,
    complianceStatus: d.complianceStatus,
    complianceNote: d.complianceNote ?? null,
    isPublished: d.isPublished === true,
  };
}

function invoiceFrom(id: string, d: DocumentData): InvoiceRow {
  return {
    invoiceId: id,
    invoiceNo: d.invoiceNo,
    kind: d.kind,
    storeId: d.storeId,
    orderId: d.orderId,
    issuedMs: ms(d.issuedAt) ?? 0,
    grandTotal: Number(d.grandTotal ?? 0),
    paymentMethod: d.paymentMethod ?? 'CASH',
    buyer: d.buyer,
    sellerSnapshot: d.sellerSnapshot,
    computation: JSON.parse(d.computationJson) as InvoiceComputation,
    irn: d.irn ?? null,
    ackNo: d.ackNo ?? null,
  };
}

const b64ToBlob = (b64: string) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'application/pdf' });
};

export class FirebaseDataClient implements DataClient {
  readonly mode = 'firebase' as const;
  private staff: Ctx;
  private guest: Ctx;
  private pending = new Map<string, ConfirmationResult>();
  private me: AppUser | null = null;
  private productCache = new Map<string, ProductInfo>();

  constructor(private cfg: FirebaseClientConfig) {
    this.staff = connect(cfg);
    this.guest = connect(cfg, 'guest');
    onIdTokenChanged(this.staff.auth, async (u) => {
      this.me = u ? await toAppUser(u) : null;
    });
  }

  private verifier(auth: Auth) {
    if (typeof document !== 'undefined' && !document.getElementById('recaptcha-container')) {
      const el = document.createElement('div');
      el.id = 'recaptcha-container';
      document.body.appendChild(el);
    }
    return new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
  }

  private call<I, O>(ctx: Ctx, name: string) {
    const fn = httpsCallable<I, O>(ctx.fns, name);
    return async (data: I) => {
      try {
        return (await fn(data)).data;
      } catch (e) {
        fnError(e);
      }
    };
  }

  private async edge<T>(ctx: Ctx, path: string, body?: unknown, method: 'GET' | 'POST' = 'POST'): Promise<T> {
    const headers: Record<string, string> = {};
    const u = ctx.auth.currentUser;
    if (u) headers.Authorization = `Bearer ${await u.getIdToken()}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${this.cfg.edgeUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string; message?: string };
    if (!res.ok) throw new DataError(out.message && out.message !== out.error ? out.message : humanEdgeError(out.error), out.error);
    return out;
  }

  private user(): AppUser {
    if (!this.me) throw new DataError('Sign in first', 'UNAUTHENTICATED');
    return this.me;
  }

  /* ---------------------------------------------- staff auth */
  onAuthChange(cb: (u: AppUser | null) => void) {
    return onIdTokenChanged(this.staff.auth, async (u) => {
      this.me = u ? await toAppUser(u) : null;
      cb(this.me);
    });
  }
  async sendOtp(phone: string) {
    try {
      const r = await signInWithPhoneNumber(this.staff.auth, phone.replace(/\s+/g, ''), this.verifier(this.staff.auth));
      const id = randomId(8);
      this.pending.set(id, r);
      return { verificationId: id };
    } catch (e) {
      fnError(e);
    }
  }
  async verifyOtp(verificationId: string, code: string) {
    const r = this.pending.get(verificationId);
    if (!r) throw new DataError('Request a new OTP');
    try {
      const cred = await r.confirm(code);
      this.pending.delete(verificationId);
      this.me = await toAppUser(cred.user, true);
      return this.me;
    } catch (e) {
      fnError(e);
    }
  }
  signOut() {
    return signOut(this.staff.auth);
  }

  async bootstrap() {
    const out = await this.call<{ loadSample: boolean }, { stores: number; products: number }>(this.staff, 'bootstrapBusiness')({ loadSample: true });
    const u = this.staff.auth.currentUser;
    if (u) this.me = await toAppUser(u, true);
    return out;
  }

  /* ---------------------------------------------- catalogue */
  async listStores() {
    const u = this.user();
    if (u.role === 'super_admin') return (await getDocs(collection(this.staff.db, COL.stores))).docs.map((d) => storeFrom(d.id, d.data()));
    if (!u.vendorId) return [];
    if (u.role === 'seller' && !(u.storeIds?.length)) {
      return (await getDocs(query(collection(this.staff.db, COL.stores), where('vendorId', '==', u.vendorId)))).docs.map((d) => storeFrom(d.id, d.data()));
    }
    const snaps = await Promise.all((u.storeIds ?? []).map((id) => getDoc(doc(this.staff.db, COL.stores, id))));
    return snaps.filter((s) => s.exists()).map((s) => storeFrom(s.id, s.data()!));
  }
  async getStore(storeId: string) {
    const s = await getDoc(doc(this.staff.db, COL.stores, storeId));
    return s.exists() ? storeFrom(s.id, s.data()) : null;
  }
  async listHsn() {
    return (await getDocs(collection(this.staff.db, COL.hsnMaster))).docs.map((d) => ({ hsnCode: d.id, description: d.get('description'), gstSlab: d.get('gstSlab') }) as HsnRow);
  }
  async listProducts() {
    const u = this.user();
    const q = u.role === 'super_admin' ? collection(this.staff.db, COL.products) : query(collection(this.staff.db, COL.products), where('vendorId', '==', u.vendorId ?? '-'));
    const list = (await getDocs(q)).docs.map((d) => productFrom(d.id, d.data()));
    list.forEach((p) => this.productCache.set(p.productId, p));
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }
  upsertProduct(input: ProductInput) {
    return this.call<ProductInput, { productId: string; gstSlab: number; sentForReview: boolean }>(this.staff, 'upsertProduct')(input);
  }
  async reviewProduct(productId: string, decision: 'APPROVED' | 'REJECTED', note?: string) {
    await this.call(this.staff, 'reviewProduct')({ productId, decision, note });
  }

  /* ---------------------------------------------- inventory */
  private async ensureProducts() {
    if (this.productCache.size === 0) await this.listProducts();
  }
  private invRow(d: DocumentData, product: ProductInfo): InventoryRow {
    return {
      storeId: d.storeId,
      productId: d.productId,
      product,
      sellingPrice: d.sellingPrice,
      mrp: d.mrp,
      onHand: d.onHand,
      reorderThreshold: d.reorderThreshold,
      aisleBinCode: d.aisleBinCode ?? '',
      isListed: d.isListed === true,
      lowStock: d.lowStock === true,
      nearestExpiryMs: ms(d.nearestExpiry),
      nextBatchNumber: d.nextBatchNumber ?? null,
    };
  }
  async listInventory(storeId: string) {
    const u = this.user();
    await this.ensureProducts();
    const store = await this.getStore(storeId);
    const snap = await getDocs(query(collection(this.staff.db, COL.storeInventory), where('vendorId', '==', store?.vendorId ?? u.vendorId ?? '-'), where('storeId', '==', storeId)));
    return snap.docs
      .map((d) => d.data())
      .filter((d) => this.productCache.has(d.productId))
      .map((d) => this.invRow(d, this.productCache.get(d.productId)!))
      .sort((a, b) => a.product.name.localeCompare(b.product.name));
  }
  async listBatches(storeId: string, productId: string): Promise<BatchState[]> {
    const store = await this.getStore(storeId);
    const snap = await getDocs(query(collection(this.staff.db, COL.storeInventory, inventoryDocId(storeId, productId), COL.batches), where('vendorId', '==', store?.vendorId ?? '-'), where('storeId', '==', storeId)));
    return snap.docs.map((d) => {
      const x = d.data();
      return { batchId: d.id, batchNumber: x.batchNumber, mfgMs: ms(x.mfgDate), expiryMs: ms(x.expiryDate), receivedMs: ms(x.receivedAt) ?? 0, qty: x.qty, recalled: x.recalled === true, purchasePrice: x.purchasePrice, mrp: x.mrp };
    });
  }
  async setStorePrice(storeId: string, productId: string, sellingPrice: number) {
    await this.call(this.staff, 'setStorePrice')({ storeId, productId, sellingPrice });
  }
  async updateShelf(storeId: string, productId: string, patch: { aisleBinCode: string; reorderThreshold: number; isListed: boolean }) {
    try {
      await updateDoc(doc(this.staff.db, COL.storeInventory, inventoryDocId(storeId, productId)), { ...patch, updatedAt: serverTimestamp() });
    } catch (e) {
      fnError(e);
    }
  }
  inwardStock(input: InwardInput) {
    return this.call<InwardInput, { onHand: number; warning: string | null }>(this.staff, 'inwardStock')(input);
  }
  adjustStock(input: AdjustInput) {
    return this.call<AdjustInput, { onHand: number }>(this.staff, 'adjustStock')(input);
  }
  async listLedger(storeId: string, max = 200) {
    await this.ensureProducts();
    const store = await this.getStore(storeId);
    const snap = await getDocs(query(collection(this.staff.db, COL.stockLedger), where('vendorId', '==', store?.vendorId ?? '-'), where('storeId', '==', storeId), orderBy('at', 'desc'), limit(max)));
    return snap.docs.map((d) => {
      const x = d.data();
      return { id: d.id, storeId: x.storeId, productId: x.productId, productName: this.productCache.get(x.productId)?.name ?? x.productId, batchId: x.batchId, movement: x.movement, qtyDelta: x.qtyDelta, balanceAfter: x.balanceAfter, refType: x.refType, refId: x.refId, reason: x.reason ?? null, byUid: x.byUid, atMs: ms(x.at) ?? 0 } as LedgerRow;
    });
  }

  /* ---------------------------------------------- billing */
  commitSale(input: SaleInput) {
    return this.call<SaleInput, SaleResult>(this.staff, 'commitSale')(input);
  }
  async listInvoices(opts: { fromMs: number; toMs: number; storeId?: string }) {
    const u = this.user();
    const base = collection(this.staff.db, COL.invoices);
    const range = [where('issuedAt', '>=', Timestamp.fromMillis(opts.fromMs)), where('issuedAt', '<=', Timestamp.fromMillis(Math.min(opts.toMs, Date.now() + 86_400_000))), orderBy('issuedAt', 'desc'), limit(1000)] as const;
    const vendor = u.vendorId ?? '-';
    const storeFilter = opts.storeId ? [opts.storeId] : u.role === 'staff' ? u.storeIds ?? [] : null;
    const q = storeFilter ? query(base, where('vendorId', '==', vendor), where('storeId', 'in', storeFilter.slice(0, 30)), ...range) : query(base, where('vendorId', '==', vendor), ...range);
    return (await getDocs(q)).docs.map((d) => invoiceFrom(d.id, d.data()));
  }
  async invoicePdf(invoiceId: string, format: 'A4' | 'THERMAL_80MM') {
    const out = await this.call<{ invoiceId: string; format: string }, { base64: string }>(this.staff, 'getInvoicePdf')({ invoiceId, format });
    return b64ToBlob(out.base64);
  }
  async signStoreQr(storeId: string) {
    return this.edge<{ url: string; token: string }>(this.staff, '/v1/qr/sign', { storeId });
  }
  async redeemCheckout(token: string) {
    return this.edge<{ cartId: string; storeId: string; guestUid: string }>(this.staff, '/v1/checkout/redeem', { token: token.trim() });
  }
  async getCart(cartId: string): Promise<GuestCart | null> {
    const ctx = this.staff.auth.currentUser ? this.staff : this.guest;
    const s = await getDoc(doc(ctx.db, COL.tempCarts, cartId));
    if (!s.exists()) return null;
    const d = s.data();
    return { cartId, storeId: d.storeId, items: d.items ?? [], status: d.status, expiresAtMs: ms(d.expiresAt) ?? 0, guestUid: d.guestUid };
  }

  /* ---------------------------------------------- walk-in guest */
  onGuestChange(cb: (u: AppUser | null) => void) {
    return onIdTokenChanged(this.guest.auth, async (u) => cb(u ? await toAppUser(u) : null));
  }
  async resolveStoreQr(storeId: string, token: string) {
    await this.edge(this.guest, `/v1/qr/resolve?storeId=${encodeURIComponent(storeId)}&token=${encodeURIComponent(token)}`, undefined, 'GET');
    const s = await getDoc(doc(this.guest.db, COL.stores, storeId));
    if (!s.exists()) throw new DataError('Store not found');
    return storeFrom(s.id, s.data());
  }
  async startGuestSession(storeId: string, token: string, turnstileToken: string) {
    if (!this.guest.auth.currentUser) await signInAnonymously(this.guest.auth);
    await this.edge(this.guest, '/v1/qr/session', { storeId, token, turnstileToken });
    return toAppUser(this.guest.auth.currentUser!, true);
  }
  async guestInventory(storeId: string) {
    const db = this.guest.db;
    const store = await getDoc(doc(db, COL.stores, storeId));
    const vendorId = store.get('vendorId');
    const [inv, prods] = await Promise.all([
      getDocs(query(collection(db, COL.storeInventory), where('storeId', '==', storeId), where('isListed', '==', true))),
      getDocs(query(collection(db, COL.products), where('vendorId', '==', vendorId), where('isPublished', '==', true), where('complianceStatus', '==', 'APPROVED'))),
    ]);
    const pmap = new Map(prods.docs.map((d) => [d.id, productFrom(d.id, d.data())]));
    return inv.docs
      .map((d) => d.data())
      .filter((d) => pmap.has(d.productId) && d.sellingPrice > 0)
      .map((d) => this.invRow(d, pmap.get(d.productId)!))
      .sort((a, b) => a.product.name.localeCompare(b.product.name));
  }
  async saveGuestCart(storeId: string, items: { productId: string; qty: number }[], cartId?: string): Promise<GuestCart> {
    const u = this.guest.auth.currentUser;
    if (!u) throw new DataError('Scan the store QR to start shopping');
    const clean = items.filter((x) => x.qty > 0).map((x) => ({ productId: x.productId, qty: x.qty }));
    if (cartId) {
      const cur = await this.getCart(cartId);
      if (cur && cur.status === 'OPEN' && cur.expiresAtMs > Date.now() + 15_000) {
        await updateDoc(doc(this.guest.db, COL.tempCarts, cartId), { items: clean });
        return { ...cur, items: clean };
      }
    }
    const id = randomId(12).replace(/[^A-Za-z0-9_-]/g, '');
    const store = await getDoc(doc(this.guest.db, COL.stores, storeId));
    const expiresAtMs = Date.now() + (TEMP_CART_TTL_SECONDS - 30) * 1000; // stay inside the 10-minute rule despite clock skew
    await setDoc(doc(this.guest.db, COL.tempCarts, id), { cartId: id, storeId, vendorId: store.get('vendorId'), guestUid: u.uid, items: clean, status: 'OPEN', createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(expiresAtMs) });
    return { cartId: id, storeId, items: clean, status: 'OPEN', expiresAtMs, guestUid: u.uid };
  }
  async createCheckoutToken(cartId: string) {
    const out = await this.edge<{ token: string; expiresAt: number }>(this.guest, '/v1/checkout/token', { cartId });
    await updateDoc(doc(this.guest.db, COL.tempCarts, cartId), { status: 'CHECKOUT_PENDING' }).catch(() => undefined);
    return { token: out.token, expiresAtMs: out.expiresAt * 1000 };
  }
  guestCommitSale(input: SaleInput) {
    return this.call<SaleInput, SaleResult>(this.guest, 'commitSale')(input);
  }
  async guestInvoice(invoiceId: string) {
    const s = await getDoc(doc(this.guest.db, COL.invoices, invoiceId)).catch(() => null);
    return s?.exists() ? invoiceFrom(s.id, s.data()) : null;
  }
  async guestInvoices() {
    const u = this.guest.auth.currentUser;
    if (!u) return [];
    const snap = await getDocs(query(collection(this.guest.db, COL.invoices), where('guestUid', '==', u.uid), orderBy('issuedAt', 'desc'), limit(20)));
    return snap.docs.map((d) => invoiceFrom(d.id, d.data()));
  }
  async guestInvoicePdf(invoiceId: string) {
    const out = await this.call<{ invoiceId: string; format: string }, { base64: string }>(this.guest, 'getInvoicePdf')({ invoiceId, format: 'A4' });
    return b64ToBlob(out.base64);
  }
  async sendGuestLinkOtp(phone: string) {
    const u = this.guest.auth.currentUser;
    if (!u?.isAnonymous) throw new DataError('Only a walk-in session can be saved to an account');
    try {
      const r = await linkWithPhoneNumber(u, phone.replace(/\s+/g, ''), this.verifier(this.guest.auth));
      const id = randomId(8);
      this.pending.set(id, r);
      return { verificationId: id };
    } catch (e) {
      fnError(e);
    }
  }
  async confirmGuestLink(verificationId: string, code: string) {
    const r = this.pending.get(verificationId);
    if (!r) throw new DataError('Request a new OTP');
    try {
      const cred = await r.confirm(code);
      this.pending.delete(verificationId);
      await this.call(this.guest, 'completeGuestUpgrade')({});
      return toAppUser(cred.user, true);
    } catch (e) {
      fnError(e);
    }
  }
}

function humanEdgeError(code?: string): string {
  switch (code) {
    case 'QR_BAD_SIGNATURE':
    case 'QR_MALFORMED':
      return 'This QR code is not genuine';
    case 'QR_REVOKED':
      return 'This poster has been replaced — ask the shop for the new QR';
    case 'QR_EXPIRED':
      return 'This QR code has expired';
    case 'CHECKOUT_ALREADY_REDEEMED':
      return 'This checkout QR was already used';
    case 'NOT_YOUR_STORE':
      return 'This cart belongs to another store';
    case 'RATE_LIMITED':
      return 'Too many attempts — wait a minute';
    case 'TURNSTILE_FAILED':
      return 'Human check failed, please try again';
    default:
      return code ? code.replace(/_/g, ' ').toLowerCase() : 'Request failed';
  }
}
