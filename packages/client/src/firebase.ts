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
  type ApplicationVerifier,
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
import { connectStorageEmulator, getDownloadURL, getStorage, ref as storageRef, uploadBytes, type FirebaseStorage } from 'firebase/storage';
import { buildPickList, COL, JAIPUR_MAX_DELIVERY_METERS, inventoryDocId, isRole, isValidPincode, kycFileName, randomId, RIDER_KYC_DOCS, TEMP_CART_TTL_SECONDS, VENDOR_KYC_DOCS, type BatchState, type HsnInput, type InvoiceComputation, type KycStatus, type OrderStatus, type PlannedLine, type RiderVehicle, type ZoneInput, validateHygiene, validPing, type PayoutMethod, type RiderFix } from '@pansari/shared';
import { LocalGeoProvider } from '@pansari/adapters';
import type { Address, AddressInput, AdjustInput, AppUser, CustomerProfile, DataClient, DeliveryCheck, GuestCart, HsnRow, InventoryRow, InvoiceRow, InwardInput, LedgerRow, OrderRow, PlaceOrderInput, ProductInfo, ProductInput, SaleInput, SaleResult, StoreInfo, TicketInput, TicketRow, WalletTxn, AuditRow, KycDocRow, KycUploadInput, PickTask, RecallInput, RecallResult, RecallRow, RiderCashRow, PayoutRow, HygieneInput, HygieneRow, PhotoInput, RiderProfile, RoleInput, UserRow, ZoneRow } from './types';
import { DataError } from './types';

export interface FirebaseClientConfig {
  firebase: FirebaseOptions;
  functionsRegion: string;
  edgeUrl: string;
  useEmulators: boolean;
  /**
   * Phone app: how to create Auth (React Native persistence) and how to prove the
   * OTP request comes from a person (reCAPTCHA shown in a WebView). The web app
   * uses the defaults: getAuth() and an invisible reCAPTCHA in the page.
   */
  makeAuth?: (app: FirebaseApp) => Auth;
  verifier?: (auth: Auth) => ApplicationVerifier;
}

interface Ctx {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  fns: Functions;
  storage: FirebaseStorage;
}

const ms = (t: unknown): number | null => (t instanceof Timestamp ? t.toMillis() : null);

function connect(cfg: FirebaseClientConfig, name?: string): Ctx {
  const existing = getApps().find((a) => a.name === (name ?? '[DEFAULT]'));
  const app = existing ?? initializeApp(cfg.firebase, name);
  const auth = !existing && cfg.makeAuth ? cfg.makeAuth(app) : getAuth(app);
  const db = getFirestore(app);
  const fns = getFunctions(app, cfg.functionsRegion);
  const storage = getStorage(app);
  if (cfg.useEmulators && !existing) {
    connectStorageEmulator(storage, '127.0.0.1', 9199);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectFunctionsEmulator(fns, '127.0.0.1', 5001);
    auth.settings.appVerificationDisabledForTesting = true;
  }
  return { app, auth, db, fns, storage };
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
    location: d.location ?? null,
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

  private verifier(auth: Auth): ApplicationVerifier {
    if (this.cfg.verifier) return this.cfg.verifier(auth);
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
    const init: RequestInit = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
    // One retry on a dropped connection (shop Wi-Fi / mobile data); HTTP errors are not retried.
    const res = await fetch(`${this.cfg.edgeUrl}${path}`, init).catch(async () => {
      await new Promise((r) => setTimeout(r, 800));
      return fetch(`${this.cfg.edgeUrl}${path}`, init);
    });
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
    if (u.role === 'super_admin' || u.role === 'compliance') return (await getDocs(collection(this.staff.db, COL.stores))).docs.map((d) => storeFrom(d.id, d.data()));
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
    const q = u.role === 'super_admin' || u.role === 'compliance' ? collection(this.staff.db, COL.products) : query(collection(this.staff.db, COL.products), where('vendorId', '==', u.vendorId ?? '-'));
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

  /* ---------------------------------------------- customer: delivery */
  private geo = new LocalGeoProvider({ maxDistanceMeters: JAIPUR_MAX_DELIVERY_METERS });
  private uidOrThrow() {
    const u = this.staff.auth.currentUser;
    if (!u || u.isAnonymous) throw new DataError('Sign in with your mobile number', 'UNAUTHENTICATED');
    return u;
  }
  async deliveryStores() {
    const snap = await getDocs(query(collection(this.staff.db, COL.stores), where('acceptsOnline', '==', true), where('isActive', '==', true)));
    return snap.docs.map((d) => storeFrom(d.id, d.data()));
  }
  async shopCatalog(storeId: string) {
    const db = this.staff.db;
    const store = await getDoc(doc(db, COL.stores, storeId));
    if (!store.exists()) throw new DataError('Store not found');
    const [inv, prods] = await Promise.all([
      getDocs(query(collection(db, COL.storeInventory), where('storeId', '==', storeId), where('isListed', '==', true))),
      getDocs(query(collection(db, COL.products), where('vendorId', '==', store.get('vendorId')), where('isPublished', '==', true), where('complianceStatus', '==', 'APPROVED'))),
    ]);
    const pmap = new Map(prods.docs.map((d) => [d.id, productFrom(d.id, d.data())]));
    return inv.docs
      .map((d) => d.data())
      .filter((d) => pmap.has(d.productId) && d.sellingPrice > 0)
      .map((d) => this.invRow(d, pmap.get(d.productId)!))
      .sort((a, b) => a.product.name.localeCompare(b.product.name));
  }
  async checkDelivery(input: { pincode: string; location?: { lat: number; lng: number } | null }): Promise<DeliveryCheck> {
    const empty = { storeId: null, storeName: null, etaMinutes: null, distanceMeters: null, baseDeliveryFee: 0, freeDeliveryAbove: 0, surgeMultiplierBps: 10_000 };
    let p = input.location ?? null;
    if (!p) {
      const g = await this.geo.geocodePincode(input.pincode?.trim());
      if (!g) return { serviceable: false, reason: 'UNKNOWN_PINCODE', ...empty };
      p = g.center;
    }
    const [zones, stores] = await Promise.all([
      getDocs(query(collection(this.staff.db, COL.zones), where('isActive', '==', true))),
      getDocs(query(collection(this.staff.db, COL.stores), where('acceptsOnline', '==', true))),
    ]);
    const zl = zones.docs.map((z) => ({ zoneId: z.id, name: z.get('name'), geometryJson: z.get('geometryJson'), storeIds: z.get('storeIds') ?? [], isActive: true, d: z.data() }));
    const r = this.geo.checkServiceability(p, zl, stores.docs.map((s) => ({ storeId: s.id, name: s.get('name'), location: s.get('location'), isActive: s.get('isActive') === true, acceptsOnline: true })));
    const z = zl.find((x) => x.zoneId === r.zone?.zoneId)?.d;
    return {
      serviceable: r.serviceable,
      reason: r.reason,
      storeId: r.store?.storeId ?? null,
      storeName: r.store?.name ?? null,
      etaMinutes: r.etaMinutes,
      distanceMeters: r.distanceMeters === null ? null : Math.round(r.distanceMeters),
      baseDeliveryFee: Number(z?.baseDeliveryFee ?? 0),
      freeDeliveryAbove: Number(z?.freeDeliveryAbove ?? 0),
      surgeMultiplierBps: Number(z?.surgeMultiplierBps ?? 10_000),
    };
  }
  async myProfile(): Promise<CustomerProfile> {
    const u = this.uidOrThrow();
    const s = await getDoc(doc(this.staff.db, COL.users, u.uid));
    const d = s.exists() ? s.data() : {};
    return { uid: u.uid, phone: u.phoneNumber, displayName: d.displayName || u.displayName || null, addresses: (d.addresses as Address[]) ?? [], walletBalance: Number(d.walletBalance ?? 0) };
  }
  private async writeProfile(patch: { displayName?: string; addresses?: Address[] }) {
    const u = this.uidOrThrow();
    const ref = doc(this.staff.db, COL.users, u.uid);
    const s = await getDoc(ref);
    try {
      if (s.exists()) {
        await updateDoc(ref, { displayName: patch.displayName ?? s.get('displayName') ?? '', addresses: patch.addresses ?? s.get('addresses') ?? [], updatedAt: serverTimestamp() });
      } else {
        await setDoc(ref, { uid: u.uid, displayName: patch.displayName ?? '', phone: u.phoneNumber ?? null, email: null, roleMirror: 'customer', addresses: patch.addresses ?? [], loyaltyPoints: 0, walletBalance: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      }
    } catch (e) {
      fnError(e);
    }
  }
  async saveProfileName(displayName: string) {
    const name = displayName.trim().slice(0, 60);
    if (name.length < 2) throw new DataError('Enter your name');
    await this.writeProfile({ displayName: name });
  }
  async saveAddress(i: AddressInput): Promise<Address> {
    const prof = await this.myProfile();
    if (!i.line1?.trim() || i.line1.trim().length < 4) throw new DataError('Enter house / street');
    if (!isValidPincode(i.pincode)) throw new DataError('Enter a 6-digit pincode');
    const g = await this.geo.geocodePincode(i.pincode.trim());
    if (!g && !i.location) throw new DataError('We could not find this pincode — use "Use my location"');
    if (!i.id && prof.addresses.length >= 10) throw new DataError('You can save up to 10 addresses');
    const addr: Address = { id: i.id ?? `a-${randomId(6).replace(/[^A-Za-z0-9]/g, '')}`, label: (i.label?.trim() || 'Home').slice(0, 20), line1: i.line1.trim().slice(0, 120), ...(i.line2?.trim() ? { line2: i.line2.trim().slice(0, 120) } : {}), city: g?.city ?? 'Jaipur', pincode: i.pincode.trim(), stateCode: g?.stateCode ?? '08', location: i.location ?? g!.center };
    const list = prof.addresses.filter((a) => a.id !== addr.id).concat(addr);
    await this.writeProfile({ addresses: list });
    return addr;
  }
  async deleteAddress(addressId: string) {
    const prof = await this.myProfile();
    await this.writeProfile({ addresses: prof.addresses.filter((a) => a.id !== addressId) });
  }
  placeOrder(input: PlaceOrderInput) {
    return this.call<PlaceOrderInput, { orderId: string; grandTotal: number; etaMinutes: number | null }>(this.staff, 'placeOrder')(input);
  }
  private async orderFrom(id: string, d: DocumentData, withOtp: boolean): Promise<OrderRow> {
    const comp = d.computationJson ? (JSON.parse(d.computationJson) as InvoiceComputation) : null;
    const charges = (d.charges as { code: string; name: string; amount: number }[]) ?? [];
    const grand = Number(d.totals?.grandTotal ?? 0);
    const live = !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(d.status);
    let otp: string | null = null;
    if (withOtp && live) otp = (await getDoc(doc(this.staff.db, COL.orderSecrets, id)).catch(() => null))?.get('deliveryOtp') ?? null;
    const store = await this.getStore(d.storeId).catch(() => null);
    return {
      orderId: id,
      channel: d.channel,
      storeId: d.storeId,
      storeName: store?.name ?? d.storeId,
      status: d.status,
      statusHistory: d.statusHistory ?? [],
      lines: ((d.lines as { productId: string; name: string; qty: number; unit: string; unitPrice: number }[]) ?? []).map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, unit: l.unit as OrderRow['lines'][number]['unit'], unitPrice: l.unitPrice })),
      charges,
      itemsTotal: grand - charges.reduce((a, c) => a + c.amount, 0) - Number(d.totals?.roundOff ?? 0),
      totalTax: comp?.totals.totalTax ?? Number(d.totals?.totalTax ?? 0),
      grandTotal: grand,
      payment: { method: d.payment?.method, status: d.payment?.status },
      deliveryAddress: d.deliveryAddress ?? null,
      etaMinutes: d.etaMinutes ?? null,
      placedMs: ms(d.createdAt) ?? Date.now(),
      invoiceId: d.invoiceId ?? null,
      invoiceNo: d.invoiceNo ?? null,
      cancelReason: d.cancelReason ?? null,
      deliveryOtp: withOtp ? otp : null,
      customerPhone: withOtp ? undefined : d.customerPhone ?? null,
      customerName: withOtp ? undefined : d.customerName ?? null,
      riderUid: d.riderUid ?? null,
      riderName: d.riderUid ? (await this.riderName(d.riderUid)) : null,
      riderPhone: null,
      hasPod: !!d.podPath,
    };
  }
  private riderNames = new Map<string, string | null>();
  private async riderName(uid: string): Promise<string | null> {
    if (!this.riderNames.has(uid)) this.riderNames.set(uid, (await getDoc(doc(this.staff.db, COL.riders, uid)).catch(() => null))?.get('name') ?? null);
    return this.riderNames.get(uid) ?? null;
  }
  async myOrders() {
    const u = this.uidOrThrow();
    const snap = await getDocs(query(collection(this.staff.db, COL.orders), where('customerUid', '==', u.uid), orderBy('createdAt', 'desc'), limit(30)));
    return Promise.all(snap.docs.map((d) => this.orderFrom(d.id, d.data(), true)));
  }
  async getOrder(orderId: string) {
    const u = this.uidOrThrow();
    const s = await getDoc(doc(this.staff.db, COL.orders, orderId)).catch(() => null);
    if (!s?.exists()) return null;
    return this.orderFrom(s.id, s.data(), s.get('customerUid') === u.uid);
  }
  cancelMyOrder(orderId: string, reason: string) {
    return this.call<{ orderId: string; reason: string }, { refunded: number }>(this.staff, 'cancelOrder')({ orderId, reason });
  }
  async myInvoicePdf(invoiceId: string) {
    const out = await this.call<{ invoiceId: string; format: string }, { base64: string }>(this.staff, 'getInvoicePdf')({ invoiceId, format: 'A4' });
    return b64ToBlob(out.base64);
  }
  async walletTxns(): Promise<WalletTxn[]> {
    const u = this.uidOrThrow();
    const snap = await getDocs(query(collection(this.staff.db, COL.walletTxns), where('uid', '==', u.uid), orderBy('at', 'desc'), limit(50)));
    return snap.docs.map((d) => ({ id: d.id, kind: d.get('kind'), amount: d.get('amount'), balanceAfter: d.get('balanceAfter'), refId: d.get('refId') ?? null, note: d.get('note') ?? null, atMs: ms(d.get('at')) ?? 0 }));
  }
  topUpWallet(amount: number, simulateOutcome?: 'success' | 'fail') {
    return this.call<{ amount: number; simulateOutcome?: string }, { balance: number }>(this.staff, 'topUpWallet')({ amount, simulateOutcome });
  }

  /* ---------------------------------------------- operator: online orders */
  async listOnlineOrders(storeId: string, opts: { includeClosed?: boolean } = {}) {
    const store = await this.getStore(storeId);
    const snap = await getDocs(query(collection(this.staff.db, COL.orders), where('vendorId', '==', store?.vendorId ?? '-'), where('storeId', '==', storeId), where('channel', '==', 'ONLINE'), orderBy('createdAt', 'desc'), limit(opts.includeClosed ? 200 : 60)));
    const dayAgo = Date.now() - 86_400_000;
    const rows = await Promise.all(snap.docs.map((d) => this.orderFrom(d.id, d.data(), false)));
    return rows.filter((o) => opts.includeClosed || !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status) || o.placedMs > dayAgo);
  }
  advanceOrder(orderId: string, to: OrderStatus, opts: { otp?: string; reason?: string } = {}) {
    return this.call<{ orderId: string; to: OrderStatus; otp?: string; reason?: string }, { status: OrderStatus; invoiceNo: string | null }>(this.staff, 'advanceOrder')({ orderId, to, ...opts });
  }

  /* ---------------------------------------------- Phase 4 · super admin */
  listUsers() {
    return this.call<Record<string, never>, UserRow[]>(this.staff, 'listUsers')({});
  }
  setUserRole(input: RoleInput) {
    return this.call<RoleInput, UserRow>(this.staff, 'setUserRole')(input);
  }
  async listZones(): Promise<ZoneRow[]> {
    const snap = await getDocs(collection(this.staff.db, COL.zones));
    return snap.docs.map((d) => ({ zoneId: d.id, name: d.get('name'), geometryJson: d.get('geometryJson'), storeIds: d.get('storeIds') ?? [], baseDeliveryFee: Number(d.get('baseDeliveryFee') ?? 0), freeDeliveryAbove: Number(d.get('freeDeliveryAbove') ?? 0), surgeMultiplierBps: Number(d.get('surgeMultiplierBps') ?? 10_000), isActive: d.get('isActive') === true }));
  }
  saveZone(input: ZoneInput) {
    return this.call<ZoneInput, ZoneRow>(this.staff, 'saveZone')(input);
  }
  upsertHsn(input: HsnInput) {
    return this.call<HsnInput, { productsUpdated: number }>(this.staff, 'upsertHsn')(input);
  }
  async listAudit(opts: { max?: number; actionPrefix?: string } = {}): Promise<AuditRow[]> {
    const base = collection(this.staff.db, COL.auditLogs);
    const q = opts.actionPrefix
      ? query(base, where('action', '>=', opts.actionPrefix), where('action', '<', `${opts.actionPrefix}`), limit(opts.max ?? 200))
      : query(base, orderBy('at', 'desc'), limit(opts.max ?? 200));
    const rows = (await getDocs(q)).docs.map((d) => ({ id: d.id, actorUid: d.get('actorUid'), actorRole: d.get('actorRole'), action: d.get('action'), target: d.get('target'), before: d.get('before') ?? null, after: d.get('after') ?? null, atMs: ms(d.get('at')) ?? 0 }));
    return rows.sort((a, b) => b.atMs - a.atMs);
  }
  async listAllProducts() {
    const snap = await getDocs(collection(this.staff.db, COL.products));
    return snap.docs.map((d) => ({ ...productFrom(d.id, d.data()), vendorId: String(d.get('vendorId')) })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /* ---------------------------------------------- Phase 4 · staff picker */
  async pickTask(orderId: string): Promise<PickTask> {
    const s = await getDoc(doc(this.staff.db, COL.orders, orderId));
    if (!s.exists()) throw new DataError('Order not found');
    const d = s.data();
    const lines = (d.lines as PlannedLine[]) ?? [];
    await this.ensureProducts();
    const shelf: Parameters<typeof buildPickList>[1] = {};
    for (const l of lines) {
      const inv = await getDoc(doc(this.staff.db, COL.storeInventory, inventoryDocId(d.storeId, l.productId))).catch(() => null);
      shelf[l.productId] = { aisleBinCode: inv?.get('aisleBinCode') ?? '', barcode: this.productCache.get(l.productId)?.barcode ?? null, batches: await this.listBatches(d.storeId, l.productId).catch(() => []) };
    }
    return { order: await this.orderFrom(s.id, d, false), lines: buildPickList(lines, shelf) };
  }

  /* ---------------------------------------------- Phase 4 · rider */
  private riderFrom(id: string, d: DocumentData): RiderProfile {
    return { uid: id, name: d.name ?? 'Rider', phone: d.phone ?? '', vehicleType: d.vehicleType ?? 'SCOOTER', vehicleNumber: d.vehicleNumber ?? null, kycStatus: d.kycStatus ?? 'PENDING', isOnline: d.isOnline === true, homeStoreId: d.homeStoreId ?? null, codCashInHand: Number(d.codCashInHand ?? 0), earningsBalance: Number(d.earningsBalance ?? 0), activeOrderIds: d.activeOrderIds ?? [], lastSeenMs: ms(d.lastSeenAt) };
  }
  async myRider() {
    const u = this.user();
    const s = await getDoc(doc(this.staff.db, COL.riders, u.uid));
    if (!s.exists()) throw new DataError('Ask the admin to set up your rider account (home store)', 'NOT_FOUND');
    return this.riderFrom(s.id, s.data());
  }
  async saveRiderProfile(patch: { name: string; vehicleType: RiderVehicle; vehicleNumber: string | null }) {
    await this.call(this.staff, 'saveRiderProfile')(patch);
  }
  async setRiderShift(online: boolean, location?: { lat: number; lng: number } | null) {
    await this.call(this.staff, 'setRiderShift')({ online, location: location ?? null });
  }
  private kycFrom(id: string, d: DocumentData, ownerName: string | null): KycDocRow {
    return { id, ownerUid: d.ownerUid, ownerType: d.ownerType, ownerName, vendorId: d.vendorId ?? null, docType: d.docType, fileName: d.fileName ?? d.storagePath?.split('/').pop() ?? '', status: d.status, reviewNote: d.reviewNote ?? null, createdMs: ms(d.createdAt) ?? 0, reviewedMs: ms(d.reviewedAt) };
  }
  async myKycDocs() {
    const u = this.user();
    const snap = await getDocs(query(collection(this.staff.db, COL.kycDocuments), where('ownerUid', '==', u.uid), orderBy('createdAt', 'desc'), limit(50)));
    return snap.docs.map((d) => this.kycFrom(d.id, d.data(), u.displayName));
  }
  async uploadKyc(i: KycUploadInput) {
    const u = this.user();
    const ownerType = u.role === 'rider' ? 'RIDER' : u.role === 'seller' ? 'VENDOR' : null;
    if (!ownerType) throw new DataError('Only riders and the shop owner upload KYC documents', 'PERMISSION_DENIED');
    if (!(ownerType === 'RIDER' ? RIDER_KYC_DOCS : VENDOR_KYC_DOCS).includes(i.docType)) throw new DataError('This document is not needed for your account');
    if (i.docType === 'AADHAAR_MASKED' && !i.maskedConfirmed) throw new DataError('Upload a masked Aadhaar (only the last 4 digits visible) and tick the box to confirm');
    if (i.file.size > 10 * 1024 * 1024) throw new DataError('File must be under 10 MB');
    const fileName = kycFileName(i.docType, i.fileName, Date.now());
    const path = `kyc/${u.uid}/${fileName}`;
    try {
      await uploadBytes(storageRef(this.staff.storage, path), i.file, { contentType: i.file.type || undefined });
      const ref = doc(collection(this.staff.db, COL.kycDocuments));
      const row = { ownerUid: u.uid, ownerType, vendorId: ownerType === 'VENDOR' ? u.vendorId ?? null : null, docType: i.docType, storagePath: path, fileName: i.fileName.slice(0, 100), status: 'PENDING', reviewerUid: null, reviewNote: null, createdAt: serverTimestamp(), reviewedAt: null, ...(i.docType === 'AADHAAR_MASKED' ? { maskedConfirmed: true } : {}) };
      await setDoc(ref, row);
      return this.kycFrom(ref.id, { ...row, createdAt: Timestamp.now() }, u.displayName);
    } catch (e) {
      fnError(e);
    }
  }
  async riderOrders() {
    const u = this.user();
    const snap = await getDocs(query(collection(this.staff.db, COL.orders), where('riderUid', '==', u.uid), orderBy('createdAt', 'desc'), limit(40)));
    const dayAgo = Date.now() - 86_400_000;
    const rows = await Promise.all(snap.docs.map((d) => this.orderFrom(d.id, d.data(), false)));
    return rows.filter((o) => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status) || o.placedMs > dayAgo);
  }
  async riderCash(riderUid?: string): Promise<RiderCashRow[]> {
    const u = this.user();
    const uid = riderUid ?? u.uid;
    let q;
    if (uid === u.uid) q = query(collection(this.staff.db, COL.riderCash), where('riderUid', '==', uid), orderBy('at', 'desc'), limit(100));
    else {
      const r = await getDoc(doc(this.staff.db, COL.riders, uid));
      q = query(collection(this.staff.db, COL.riderCash), where('riderUid', '==', uid), where('storeId', '==', r.get('homeStoreId') ?? '-'), where('vendorId', '==', r.get('vendorId') ?? '-'), orderBy('at', 'desc'), limit(100));
    }
    return (await getDocs(q)).docs.map((d) => ({ id: d.id, riderUid: d.get('riderUid'), storeId: d.get('storeId'), kind: d.get('kind'), amount: d.get('amount'), balanceAfter: d.get('balanceAfter'), orderId: d.get('orderId') ?? null, confirmedBy: d.get('confirmedBy') ?? null, atMs: ms(d.get('at')) ?? 0 }));
  }

  /* ---------------------------------------------- Phase 4 · operator ↔ riders */
  async listStoreRiders(storeId: string) {
    const store = await this.getStore(storeId);
    const snap = await getDocs(query(collection(this.staff.db, COL.riders), where('vendorId', '==', store?.vendorId ?? '-'), where('homeStoreId', '==', storeId)));
    return snap.docs.map((d) => this.riderFrom(d.id, d.data())).sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || a.name.localeCompare(b.name));
  }
  async assignRider(orderId: string, riderUid: string | null) {
    await this.call(this.staff, 'assignRider')({ orderId, riderUid });
  }
  receiveCodCash(storeId: string, riderUid: string, amount: number) {
    return this.call<{ storeId: string; riderUid: string; amount: number }, { codCashInHand: number }>(this.staff, 'receiveCodCash')({ storeId, riderUid, amount });
  }

  /* ---------------------------------------------- Phase 4 extras · payouts, POD, tracking */
  payRider(riderUid: string, amount: number, method: PayoutMethod, reference: string) {
    return this.call<{ riderUid: string; amount: number; method: string; reference: string }, { earningsBalance: number }>(this.staff, 'payRider')({ riderUid, amount, method, reference });
  }
  async listPayouts(riderUid?: string): Promise<PayoutRow[]> {
    const u = this.user();
    const base = collection(this.staff.db, COL.payouts);
    const q =
      u.role === 'rider'
        ? query(base, where('riderUid', '==', u.uid), orderBy('at', 'desc'), limit(100))
        : u.role === 'super_admin'
          ? riderUid
            ? query(base, where('riderUid', '==', riderUid), orderBy('at', 'desc'), limit(100))
            : query(base, orderBy('at', 'desc'), limit(100))
          : riderUid
            ? query(base, where('vendorId', '==', u.vendorId ?? '-'), where('riderUid', '==', riderUid), orderBy('at', 'desc'), limit(100))
            : query(base, where('vendorId', '==', u.vendorId ?? '-'), orderBy('at', 'desc'), limit(100));
    return (await getDocs(q)).docs.map((d) => ({ id: d.id, riderUid: d.get('riderUid'), riderName: d.get('riderName') ?? null, amount: d.get('amount'), method: d.get('method'), reference: d.get('reference') ?? '', paidBy: d.get('paidBy'), atMs: ms(d.get('at')) ?? 0 }));
  }
  async attachPod(orderId: string, photo: PhotoInput) {
    const u = this.user();
    if (photo.file.size > 5 * 1024 * 1024) throw new DataError('Photo must be under 5 MB');
    const ext = (/\.([A-Za-z0-9]{1,5})$/.exec(photo.fileName)?.[1] ?? 'jpg').toLowerCase();
    const path = `pod/${u.uid}/${orderId}/door-${Date.now()}.${ext}`;
    try {
      await uploadBytes(storageRef(this.staff.storage, path), photo.file, { contentType: photo.file.type || 'image/jpeg' });
      await this.call(this.staff, 'attachPod')({ orderId, storagePath: path });
    } catch (e) {
      fnError(e);
    }
  }
  async podUrl(orderId: string) {
    const s = await getDoc(doc(this.staff.db, COL.orders, orderId));
    const path = s.get('podPath') as string | undefined;
    return path ? getDownloadURL(storageRef(this.staff.storage, path)).catch(() => null) : null;
  }
  async pingRiderLocation(loc: { lat: number; lng: number }) {
    const u = this.user();
    const p = validPing(loc);
    if (!p) throw new DataError('Location not available');
    await updateDoc(doc(this.staff.db, COL.riders, u.uid), { lastLocation: p, lastSeenAt: serverTimestamp(), isOnline: true }).catch(() => undefined);
  }
  trackRider(orderId: string) {
    return this.call<{ orderId: string }, RiderFix | null>(this.staff, 'trackRider')({ orderId });
  }

  /* ---------------------------------------------- Phase 4 extras · hygiene checklists */
  private hygieneFrom(id: string, d: DocumentData, storeName: string | null): HygieneRow {
    const answers = (d.answers ?? []) as HygieneRow['answers'];
    const t = d.temperatureC ?? null;
    return { id, storeId: d.storeId, kind: d.kind, answers, temperatureC: t, storeName, submittedBy: d.submittedBy, submittedByName: d.submittedByName ?? null, submittedMs: ms(d.submittedAt) ?? 0, flagged: d.flagged === true, reviewStatus: d.reviewStatus, reviewNote: d.reviewNote ?? null };
  }
  async submitHygieneCheck(i: HygieneInput) {
    const u = this.user();
    const store = await this.getStore(i.storeId);
    if (!store) throw new DataError('Store not found');
    let v;
    try {
      v = validateHygiene(i.kind, i.answers, i.temperatureC);
    } catch (e) {
      throw new DataError(e instanceof Error ? e.message : 'Check the answers');
    }
    const ref = doc(collection(this.staff.db, COL.complianceChecks));
    const row = { storeId: i.storeId, vendorId: store.vendorId, kind: v.kind, answers: v.answers, temperatureC: v.temperatureC, flagged: v.flag, submittedBy: u.uid, submittedByName: u.displayName ?? null, submittedAt: serverTimestamp(), reviewStatus: 'PENDING', reviewerUid: null, reviewNote: null };
    try {
      await setDoc(ref, row);
    } catch (e) {
      fnError(e);
    }
    return this.hygieneFrom(ref.id, { ...row, submittedAt: Timestamp.now() }, store.name);
  }
  async listHygieneChecks(opts: { storeId?: string; days?: number; flaggedOnly?: boolean } = {}) {
    const u = this.user();
    const since = Timestamp.fromMillis(Date.now() - (opts.days ?? 30) * 86_400_000);
    const base = collection(this.staff.db, COL.complianceChecks);
    const stores = await this.listStores();
    const name = (id: string) => stores.find((s) => s.storeId === id)?.name ?? null;
    let q;
    if (u.role === 'compliance' || u.role === 'super_admin') q = opts.storeId ? query(base, where('storeId', '==', opts.storeId), where('submittedAt', '>=', since), orderBy('submittedAt', 'desc'), limit(300)) : query(base, where('submittedAt', '>=', since), orderBy('submittedAt', 'desc'), limit(300));
    else {
      const sid = opts.storeId ?? stores[0]?.storeId ?? '-';
      q = query(base, where('storeId', '==', sid), where('vendorId', '==', u.vendorId ?? '-'), where('submittedAt', '>=', since), orderBy('submittedAt', 'desc'), limit(300));
    }
    const rows = (await getDocs(q)).docs.map((d) => this.hygieneFrom(d.id, d.data(), name(d.get('storeId'))));
    return opts.flaggedOnly ? rows.filter((r) => r.flagged) : rows;
  }
  async reviewHygieneCheck(id: string, status: 'OK' | 'ACTION_REQUIRED', note?: string) {
    const u = this.user();
    if (status === 'ACTION_REQUIRED' && (!note || note.trim().length < 3)) throw new DataError('Tell the store what to fix');
    try {
      await updateDoc(doc(this.staff.db, COL.complianceChecks, id), { reviewStatus: status, reviewerUid: u.uid, reviewNote: note?.trim().slice(0, 200) || null });
    } catch (e) {
      fnError(e);
    }
  }

  /* ---------------------------------------------- Phase 4 · compliance */
  async listKycDocs(opts: { status?: KycStatus | 'ALL' } = {}) {
    const st = opts.status ?? 'PENDING';
    const base = collection(this.staff.db, COL.kycDocuments);
    const snap = await getDocs(st === 'ALL' ? query(base, orderBy('createdAt', 'desc'), limit(200)) : query(base, where('status', '==', st), orderBy('createdAt', 'asc'), limit(200)));
    const names = new Map<string, string | null>();
    for (const d of snap.docs) {
      const key = d.get('ownerType') === 'RIDER' ? `r:${d.get('ownerUid')}` : `v:${d.get('vendorId')}`;
      if (names.has(key)) continue;
      const s = await getDoc(doc(this.staff.db, key.startsWith('r:') ? COL.riders : COL.vendors, key.slice(2))).catch(() => null);
      names.set(key, (s?.get('name') ?? s?.get('tradeName') ?? null) as string | null);
    }
    return snap.docs.map((d) => this.kycFrom(d.id, d.data(), names.get(d.get('ownerType') === 'RIDER' ? `r:${d.get('ownerUid')}` : `v:${d.get('vendorId')}`) ?? null));
  }
  async kycFileUrl(docId: string) {
    const s = await getDoc(doc(this.staff.db, COL.kycDocuments, docId));
    if (!s.exists()) throw new DataError('Document not found');
    return getDownloadURL(storageRef(this.staff.storage, s.get('storagePath'))).catch(() => null);
  }
  reviewKyc(docId: string, decision: 'VERIFIED' | 'REJECTED', note?: string) {
    return this.call<{ docId: string; decision: string; note?: string }, { ownerStatus: KycStatus }>(this.staff, 'reviewKyc')({ docId, decision, note });
  }
  async listRecalls(): Promise<RecallRow[]> {
    const u = this.user();
    const base = collection(this.staff.db, COL.recalls);
    const q = u.role === 'compliance' || u.role === 'super_admin' ? query(base, orderBy('createdAt', 'desc'), limit(100)) : query(base, where('vendorId', '==', u.vendorId ?? '-'), orderBy('createdAt', 'desc'), limit(100));
    return (await getDocs(q)).docs.map((d) => ({ id: d.id, productId: d.get('productId'), productName: d.get('productName'), batchNumbers: d.get('batchNumbers') ?? [], reason: d.get('reason'), status: d.get('status'), unitsRemoved: Number(d.get('unitsRemoved') ?? 0), initiatedBy: d.get('initiatedBy'), createdMs: ms(d.get('createdAt')) ?? 0, completedMs: ms(d.get('completedAt')) }));
  }
  createRecall(input: RecallInput) {
    return this.call<RecallInput, RecallResult>(this.staff, 'createRecall')(input);
  }
  async completeRecall(recallId: string) {
    await this.call(this.staff, 'completeRecall')({ recallId });
  }

  /* ---------------------------------------------- support */
  createSupportTicket(input: TicketInput) {
    const ctx = this.staff.auth.currentUser ? this.staff : this.guest;
    return this.call<TicketInput, { ticketId: string }>(ctx, 'createSupportTicket')(input);
  }
  async listSupportTickets(): Promise<TicketRow[]> {
    const u = this.user();
    const base = collection(this.staff.db, COL.supportTickets);
    const q =
      u.role === 'seller' ? query(base, where('vendorId', '==', u.vendorId ?? '-'), orderBy('createdAt', 'desc'), limit(100))
      : u.role === 'staff' ? query(base, where('vendorId', '==', u.vendorId ?? '-'), where('storeId', 'in', (u.storeIds ?? ['-']).slice(0, 30)), orderBy('createdAt', 'desc'), limit(100))
      : u.role === 'super_admin' || u.role === 'compliance' ? query(base, orderBy('createdAt', 'desc'), limit(100))
      : query(base, where('createdBy', '==', u.uid), orderBy('createdAt', 'desc'), limit(50));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, category: d.get('category'), subject: d.get('subject'), orderId: d.get('orderId') ?? null, storeId: d.get('storeId') ?? null, status: d.get('status'), priority: d.get('priority'), createdBy: d.get('createdBy'), creatorRole: d.get('creatorRole'), createdMs: ms(d.get('createdAt')) ?? 0, transcript: d.get('transcript') ?? [] }));
  }
  async setTicketStatus(ticketId: string, status: TicketRow['status']) {
    await this.call(this.staff, 'setTicketStatus')({ ticketId, status });
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
