/**
 * DemoDataClient — a complete in-browser backend for previews and offline
 * development. It enforces the same permission checks as the Cloud Functions
 * and runs the SAME shared planners (planSale / planInward / planAdjust), so the
 * stock, tax and invoice numbers it produces are what production will produce.
 * State persists in localStorage when available.
 */
import {
  CHECKOUT_TOKEN_TTL_SECONDS,
  DEMO_HSN,
  DEMO_PRODUCTS,
  DEMO_STORES,
  DEMO_VENDOR,
  deriveInventory,
  expandBatches,
  financialYear,
  inventoryDocId,
  isValidHsn,
  planAdjust,
  planInward,
  planSale,
  QR_GUEST_SESSION_SECONDS,
  randomId,
  signToken,
  StockError,
  TEMP_CART_TTL_SECONDS,
  verifyToken,
  TokenError,
  GstValidationError,
  type BatchState,
  type SaleSnapshot,
} from '@pansari/shared';
import { MockGstProvider } from '@pansari/adapters';
import type { AdjustInput, AppUser, DataClient, GuestCart, HsnRow, InventoryRow, InvoiceRow, InwardInput, LedgerRow, ProductInfo, ProductInput, SaleInput, SaleResult, StoreInfo } from './types';
import { DataError } from './types';

const KEY = 'pansari-demo-v2';
const STAFF_KEY = 'pansari-demo-staff';
const GUEST_KEY = 'pansari-demo-guest';
const QR_SECRET = 'demo-mode-hmac-secret-not-for-production-0123';
const OTP = '123456';
export const DEMO_TURNSTILE_PASS = 'mock-turnstile-pass';

interface InvRec {
  storeId: string;
  productId: string;
  sellingPrice: number;
  mrp: number;
  reorderThreshold: number;
  aisleBinCode: string;
  isListed: boolean;
}
interface InvoiceRec extends InvoiceRow {
  guestUid: string | null;
  channel: SaleInput['channel'];
  signedQr: string | null;
  upiQr: string | null;
}
interface State {
  stores: (StoreInfo & { isActive: boolean })[];
  hsn: HsnRow[];
  products: Record<string, ProductInfo & { vendorId: string }>;
  inv: Record<string, InvRec>;
  batches: Record<string, BatchState[]>;
  ledger: LedgerRow[];
  invoices: InvoiceRec[];
  counters: Record<string, number>;
  carts: Record<string, GuestCart>;
  usedNonces: string[];
  users: Record<string, AppUser>; // by phone
  seq: number;
}

const ACCOUNTS: { phone: string; label: string; note: string; user: Omit<AppUser, 'uid' | 'phone' | 'isAnonymous'> }[] = [
  { phone: '+919999999991', label: 'Shop owner', note: 'All stores, prices, catalogue, QR posters', user: { displayName: 'Shop owner', role: 'seller', vendorId: 'V1', storeIds: [] } },
  { phone: '+919999999992', label: 'Sales boy · Johari Bazaar', note: 'Billing and stock at one store', user: { displayName: 'Ramesh', role: 'staff', vendorId: 'V1', storeIds: ['S1'] } },
  { phone: '+919999999993', label: 'Storekeeper · Godown', note: 'Receiving stock at the godown', user: { displayName: 'Kalu', role: 'staff', vendorId: 'V1', storeIds: ['G1'] } },
  { phone: '+919999999990', label: 'Super admin', note: 'Approves product listings', user: { displayName: 'Admin', role: 'super_admin' } },
];

function seed(): State {
  const now = Date.now();
  const st: State = {
    stores: DEMO_STORES.map((s) => ({ storeId: s.storeId, vendorId: DEMO_VENDOR.vendorId, name: s.name, type: s.type, addressLine: s.addressLine, city: s.city, pincode: s.pincode, stateCode: s.stateCode, upiVpa: s.upiVpa, acceptsWalkInQr: s.acceptsWalkInQr, qrKeyVersion: 1, isActive: true })),
    hsn: DEMO_HSN.map((h) => ({ ...h })),
    products: {},
    inv: {},
    batches: {},
    ledger: [],
    invoices: [],
    counters: {},
    carts: {},
    usedNonces: [],
    users: {},
    seq: 1,
  };
  for (const a of ACCOUNTS) st.users[a.phone] = { uid: `u-${a.phone.slice(-4)}`, phone: a.phone, isAnonymous: false, ...a.user };
  const slab = (h: string) => DEMO_HSN.find((x) => h.startsWith(x.hsnCode))!.gstSlab;
  for (const p of DEMO_PRODUCTS) {
    st.products[p.productId] = {
      productId: p.productId,
      vendorId: DEMO_VENDOR.vendorId,
      name: p.name,
      nameHi: p.nameHi,
      category: p.category,
      brand: p.brand,
      barcode: p.barcode,
      unit: p.unit,
      netQuantity: p.netQuantity,
      hsnCode: p.hsnCode,
      gstSlab: slab(p.hsnCode),
      taxType: p.taxType,
      mrp: p.mrp,
      manufacturerName: p.brand,
      countryOfOrigin: 'India',
      fssaiRequired: p.category !== 'pooja',
      complianceStatus: p.approved ? 'APPROVED' : 'PENDING_REVIEW',
      complianceNote: null,
      isPublished: p.approved,
    };
    for (const [storeId, s] of Object.entries(p.stock)) {
      const id = inventoryDocId(storeId, p.productId);
      st.inv[id] = { storeId, productId: p.productId, sellingPrice: s.price, mrp: p.mrp, reorderThreshold: s.reorder, aisleBinCode: s.bin, isListed: true };
      st.batches[id] = expandBatches(p, storeId, now);
    }
  }
  return st;
}

function parseIstDate(v: string | null, endOfDay: boolean): number | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) throw new DataError('Dates must be YYYY-MM-DD');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return endOfDay ? Date.UTC(y, mo - 1, d, 18, 29, 59) : Date.UTC(y, mo - 1, d) - 330 * 60_000;
}

function wrap(e: unknown): never {
  if (e instanceof DataError) throw e;
  if (e instanceof StockError) throw new DataError(e.message, e.code, { productId: e.productId, available: e.available });
  if (e instanceof GstValidationError) throw new DataError(e.message, 'GST_INVALID');
  if (e instanceof TokenError) throw new DataError(e.code === 'EXPIRED' ? 'This QR code has expired' : 'This QR code is not genuine', `QR_${e.code}`);
  throw e;
}

export interface DemoOptions {
  /** Builds the walk-in URL printed on posters (the preview build uses hash routes). */
  storeUrl?: (storeId: string, token: string) => string;
  storage?: Storage | null;
  sessionStorage?: Storage | null;
}

export class DemoDataClient implements DataClient {
  readonly mode = 'demo' as const;
  private st: State;
  private staff: AppUser | null = null;
  private guest: AppUser | null = null;
  private staffL = new Set<(u: AppUser | null) => void>();
  private guestL = new Set<(u: AppUser | null) => void>();
  private gst = new MockGstProvider({ mockSigningKey: 'demo-mock-irp-signing-key-0123456789abc' });
  private ls: Storage | null;
  private ss: Storage | null;

  constructor(private opts: DemoOptions = {}) {
    this.ls = opts.storage === undefined ? safeStorage('localStorage') : opts.storage;
    this.ss = opts.sessionStorage === undefined ? safeStorage('sessionStorage') : opts.sessionStorage;
    this.st = this.load() ?? seed();
    // Keep tabs in sync (e.g. POS in one tab, customer phone view in another).
    if (typeof window !== 'undefined' && this.ls) {
      window.addEventListener('storage', (e) => {
        if (e.key === KEY && e.newValue) {
          try {
            this.st = JSON.parse(e.newValue) as State;
          } catch {}
        }
      });
    }
    try {
      const phone = this.ls?.getItem(STAFF_KEY);
      if (phone && this.st.users[phone]) this.staff = this.st.users[phone]!;
      const g = this.ss?.getItem(GUEST_KEY);
      if (g) {
        const parsed = JSON.parse(g) as AppUser;
        if ((parsed.qrExp ?? 0) > Date.now() / 1000) this.guest = parsed;
      }
    } catch {
      /* storage unavailable */
    }
  }

  /* -------------------------------------------------- persistence */
  private load(): State | null {
    try {
      const raw = this.ls?.getItem(KEY);
      return raw ? (JSON.parse(raw) as State) : null;
    } catch {
      return null;
    }
  }
  private save() {
    try {
      this.ls?.setItem(KEY, JSON.stringify(this.st));
    } catch {
      /* quota or private mode — keep in memory */
    }
  }
  resetDemo() {
    this.st = seed();
    this.save();
  }
  private id(prefix: string) {
    return `${prefix}${(this.st.seq++).toString(36)}${randomId(3)}`;
  }

  /* -------------------------------------------------- staff auth */
  onAuthChange(cb: (u: AppUser | null) => void) {
    this.staffL.add(cb);
    queueMicrotask(() => cb(this.staff));
    return () => void this.staffL.delete(cb);
  }
  demoAccounts() {
    return ACCOUNTS.map(({ phone, label, note }) => ({ phone, label, note }));
  }
  async sendOtp(phone: string) {
    const p = phone.replace(/\s+/g, '');
    if (!/^\+91[6-9]\d{9}$/.test(p)) throw new DataError('Enter a valid Indian mobile number');
    return { verificationId: `demo:${p}` };
  }
  async verifyOtp(verificationId: string, code: string) {
    if (code !== OTP) throw new DataError('Wrong OTP (demo OTP is 123456)', 'INVALID_CODE');
    const phone = verificationId.replace(/^demo:/, '');
    const user = this.st.users[phone] ?? (this.st.users[phone] = { uid: `u-${phone.slice(-4)}`, phone, displayName: null, role: 'customer', isAnonymous: false });
    this.staff = user;
    try {
      this.ls?.setItem(STAFF_KEY, phone);
    } catch {}
    this.save();
    this.staffL.forEach((l) => l(user));
    return user;
  }
  async signOut() {
    this.staff = null;
    try {
      this.ls?.removeItem(STAFF_KEY);
    } catch {}
    this.staffL.forEach((l) => l(null));
  }

  /* -------------------------------------------------- authorisation helpers */
  private me(): AppUser {
    if (!this.staff) throw new DataError('Sign in first', 'UNAUTHENTICATED');
    return this.staff;
  }
  private store(storeId: string) {
    const s = this.st.stores.find((x) => x.storeId === storeId);
    if (!s) throw new DataError('Store not found', 'NOT_FOUND');
    return s;
  }
  private operates(u: AppUser, storeId: string, sellerOnly = false) {
    const s = this.store(storeId);
    if (u.vendorId !== s.vendorId) return false;
    const ids = u.storeIds ?? [];
    if (u.role === 'seller') return ids.length === 0 || ids.includes(storeId);
    if (u.role === 'staff' && !sellerOnly) return ids.includes(storeId);
    return false;
  }
  private requireOperator(storeId: string, sellerOnly = false) {
    const u = this.me();
    if (!this.operates(u, storeId, sellerOnly)) throw new DataError(sellerOnly ? 'Only the shop owner can do this' : 'You do not operate this store', 'PERMISSION_DENIED');
    return u;
  }
  private vendorOf(u: AppUser) {
    if (u.role === 'super_admin') return DEMO_VENDOR.vendorId;
    if (!u.vendorId) throw new DataError('Not attached to a business', 'PERMISSION_DENIED');
    return u.vendorId;
  }

  /* -------------------------------------------------- catalogue */
  async listStores() {
    const u = this.me();
    return this.st.stores.filter((s) => u.role === 'super_admin' || (u.vendorId === s.vendorId && (u.role === 'seller' ? !(u.storeIds?.length) || u.storeIds.includes(s.storeId) : u.storeIds?.includes(s.storeId))));
  }
  async getStore(storeId: string) {
    return this.st.stores.find((s) => s.storeId === storeId) ?? null;
  }
  async listHsn() {
    return [...this.st.hsn];
  }
  async listProducts() {
    const v = this.vendorOf(this.me());
    return Object.values(this.st.products).filter((p) => p.vendorId === v).sort((a, b) => a.name.localeCompare(b.name));
  }
  async upsertProduct(i: ProductInput) {
    const u = this.me();
    if (u.role !== 'seller') throw new DataError('Only the shop owner can edit the catalogue', 'PERMISSION_DENIED');
    if (!isValidHsn(i.hsnCode)) throw new DataError('HSN must be 4, 6 or 8 digits');
    if (!i.name?.trim()) throw new DataError('Name is required');
    if (!(i.mrp > 0)) throw new DataError('MRP is required');
    const master = [i.hsnCode, i.hsnCode.slice(0, 6), i.hsnCode.slice(0, 4)].map((h) => this.st.hsn.find((x) => x.hsnCode === h)).find(Boolean);
    if (!master) throw new DataError(`HSN ${i.hsnCode} is not in the tax master yet — ask the admin to add it with its GST rate`, 'HSN_UNKNOWN');
    const productId = i.productId ?? this.id('p-');
    const cur = this.st.products[productId];
    if (cur && cur.vendorId !== u.vendorId) throw new DataError('Not your product', 'PERMISSION_DENIED');
    const next = {
      productId,
      vendorId: u.vendorId!,
      name: i.name.trim(),
      nameHi: i.nameHi?.trim() || null,
      category: i.category,
      brand: i.brand?.trim() || null,
      barcode: i.barcode?.trim() || null,
      unit: i.unit,
      netQuantity: i.netQuantity.trim(),
      hsnCode: i.hsnCode,
      gstSlab: master.gstSlab,
      taxType: i.taxType,
      mrp: i.mrp,
      manufacturerName: i.manufacturerName?.trim() || null,
      countryOfOrigin: i.countryOfOrigin?.trim() || 'India',
      fssaiRequired: !!i.fssaiRequired,
    };
    const material = !cur || (['name', 'hsnCode', 'mrp', 'netQuantity', 'manufacturerName', 'unit', 'taxType'] as const).some((k) => cur[k] !== next[k]);
    this.st.products[productId] = {
      ...next,
      complianceStatus: material ? 'PENDING_REVIEW' : cur!.complianceStatus,
      complianceNote: material ? null : cur!.complianceNote,
      isPublished: material ? false : cur!.isPublished,
    };
    this.save();
    return { productId, gstSlab: master.gstSlab, sentForReview: material };
  }
  async reviewProduct(productId: string, decision: 'APPROVED' | 'REJECTED', note?: string) {
    const u = this.me();
    if (u.role !== 'super_admin' && u.role !== 'compliance') throw new DataError('Compliance only', 'PERMISSION_DENIED');
    const p = this.st.products[productId];
    if (!p) throw new DataError('Product not found');
    p.complianceStatus = decision;
    p.complianceNote = note ?? null;
    p.isPublished = decision === 'APPROVED';
    this.save();
  }

  /* -------------------------------------------------- inventory */
  private row(r: InvRec, now = Date.now()): InventoryRow {
    const d = deriveInventory(this.st.batches[inventoryDocId(r.storeId, r.productId)] ?? [], r.reorderThreshold, now);
    const { vendorId: _v, ...product } = this.st.products[r.productId]!;
    return { storeId: r.storeId, productId: r.productId, product, sellingPrice: r.sellingPrice, mrp: r.mrp, onHand: d.onHand, reorderThreshold: r.reorderThreshold, aisleBinCode: r.aisleBinCode, isListed: r.isListed, lowStock: d.lowStock, nearestExpiryMs: d.nearestExpiryMs, nextBatchNumber: d.nextBatchNumber };
  }
  async listInventory(storeId: string) {
    const u = this.me();
    if (!this.operates(u, storeId) && u.role !== 'super_admin') throw new DataError('You do not operate this store', 'PERMISSION_DENIED');
    return Object.values(this.st.inv).filter((r) => r.storeId === storeId).map((r) => this.row(r)).sort((a, b) => a.product.name.localeCompare(b.product.name));
  }
  async listBatches(storeId: string, productId: string) {
    const u = this.me();
    if (!this.operates(u, storeId) && u.role !== 'super_admin') throw new DataError('You do not operate this store', 'PERMISSION_DENIED');
    return (this.st.batches[inventoryDocId(storeId, productId)] ?? []).map((b) => ({ ...b }));
  }
  async setStorePrice(storeId: string, productId: string, sellingPrice: number) {
    this.requireOperator(storeId, true);
    const p = this.st.products[productId];
    if (!p) throw new DataError('Product not found');
    if (!Number.isSafeInteger(sellingPrice) || sellingPrice <= 0) throw new DataError('Enter a selling price');
    const id = inventoryDocId(storeId, productId);
    const rec = this.st.inv[id] ?? (this.st.inv[id] = { storeId, productId, sellingPrice: 0, mrp: p.mrp, reorderThreshold: 5, aisleBinCode: '', isListed: true });
    if (sellingPrice > rec.mrp) throw new DataError('Selling price cannot be above MRP');
    rec.sellingPrice = sellingPrice;
    this.save();
  }
  async updateShelf(storeId: string, productId: string, patch: { aisleBinCode: string; reorderThreshold: number; isListed: boolean }) {
    this.requireOperator(storeId);
    const rec = this.st.inv[inventoryDocId(storeId, productId)];
    if (!rec) throw new DataError('Item not stocked here');
    if (patch.aisleBinCode.length > 24) throw new DataError('Bin code is too long');
    if (!Number.isInteger(patch.reorderThreshold) || patch.reorderThreshold < 0) throw new DataError('Reorder level must be a whole number');
    Object.assign(rec, patch);
    this.save();
  }
  private ledger(storeId: string, productId: string, l: { batchId: string | null; movement: LedgerRow['movement']; qtyDelta: number; balanceAfter: number }, refType: string, refId: string, reason: string | null, by: string) {
    this.st.ledger.unshift({ id: this.id('l-'), storeId, productId, productName: this.st.products[productId]?.name ?? productId, ...l, refType, refId, reason, byUid: by, atMs: Date.now() });
    if (this.st.ledger.length > 2000) this.st.ledger.length = 2000;
  }
  async inwardStock(i: InwardInput) {
    const u = this.requireOperator(i.storeId);
    const p = this.st.products[i.productId];
    if (!p) throw new DataError('Product not found');
    const id = inventoryDocId(i.storeId, i.productId);
    const rec = this.st.inv[id];
    try {
      const plan = planInward(
        { productId: i.productId, batchNumber: i.batchNumber, mfgMs: parseIstDate(i.mfgDate, false), expiryMs: parseIstDate(i.expiryDate, true), qty: i.qty, purchasePrice: i.purchasePrice, mrp: i.mrp, reference: i.reference },
        { nowMs: Date.now(), unit: p.unit, reorderThreshold: rec?.reorderThreshold ?? 5, batches: this.st.batches[id] ?? [], newBatchId: this.id('b-') },
      );
      const list = (this.st.batches[id] ??= []);
      if (plan.isNewBatch) list.push(plan.batch);
      else Object.assign(list.find((b) => b.batchId === plan.batch.batchId)!, plan.batch);
      if (!rec) this.st.inv[id] = { storeId: i.storeId, productId: i.productId, sellingPrice: 0, mrp: plan.mrp, reorderThreshold: 5, aisleBinCode: '', isListed: false };
      this.ledger(i.storeId, i.productId, plan.ledger, 'PURCHASE', i.reference, null, u.uid);
      this.save();
      const price = rec?.sellingPrice ?? 0;
      return { onHand: plan.inventory.onHand, warning: price > plan.mrp ? `Shelf price is above this batch's MRP — lower it before selling.` : !rec ? 'Set a selling price before this item can be sold.' : null };
    } catch (e) {
      wrap(e);
    }
  }
  async adjustStock(i: AdjustInput) {
    const u = this.requireOperator(i.storeId);
    const p = this.st.products[i.productId];
    const id = inventoryDocId(i.storeId, i.productId);
    const rec = this.st.inv[id];
    if (!p || !rec) throw new DataError('Item not stocked here');
    try {
      const plan = planAdjust(i, { nowMs: Date.now(), unit: p.unit, reorderThreshold: rec.reorderThreshold, batches: this.st.batches[id] ?? [] });
      Object.assign(this.st.batches[id]!.find((b) => b.batchId === i.batchId)!, { qty: plan.batch.qty });
      this.ledger(i.storeId, i.productId, plan.ledger, 'ADJUSTMENT', id, i.reason, u.uid);
      this.save();
      return { onHand: plan.inventory.onHand };
    } catch (e) {
      wrap(e);
    }
  }
  async listLedger(storeId: string, max = 200) {
    const u = this.me();
    if (!this.operates(u, storeId) && u.role !== 'super_admin') throw new DataError('You do not operate this store', 'PERMISSION_DENIED');
    return this.st.ledger.filter((l) => l.storeId === storeId).slice(0, max);
  }

  /* -------------------------------------------------- billing */
  private async sell(actor: AppUser, i: SaleInput, guestUidForCart: string | null, isGuest: boolean): Promise<SaleResult> {
    const store = this.store(i.storeId);
    let items = i.items ?? [];
    let cart: GuestCart | undefined;
    if (i.channel === 'OFFLINE_QR') {
      if (!i.tempCartId) throw new DataError('Cart is required');
      cart = this.st.carts[i.tempCartId];
      if (!cart) throw new DataError('Cart not found');
      if (cart.storeId !== i.storeId) throw new DataError('Cart belongs to another store');
      if (cart.status === 'CONSUMED') throw new DataError('This cart was already billed', 'CART_CONSUMED');
      if (cart.expiresAtMs + (isGuest ? 0 : 5 * 60_000) < Date.now()) throw new DataError('Cart expired — scan the store QR again', 'CART_EXPIRED');
      if (isGuest && cart.guestUid !== guestUidForCart) throw new DataError('Not your cart');
      items = cart.items;
    }
    const nowMs = Date.now();
    const fy = financialYear(new Date(nowMs));
    const counterKey = `${store.vendorId}_${fy}`;
    const ids = [...new Set(items.map((x) => x.productId))];
    const snap: SaleSnapshot = {
      nowMs,
      store: { storeId: store.storeId, vendorId: store.vendorId, name: store.name, stateCode: store.stateCode, addressLine: store.addressLine, city: store.city, pincode: store.pincode, gstin: null, fssaiLicenseNo: null, isActive: store.isActive },
      vendor: { vendorId: DEMO_VENDOR.vendorId, legalName: DEMO_VENDOR.legalName, tradeName: DEMO_VENDOR.tradeName, gstin: DEMO_VENDOR.gstin, fssaiLicenseNo: DEMO_VENDOR.fssaiLicenseNo, stateCode: DEMO_VENDOR.stateCode, invoicePrefix: DEMO_VENDOR.invoicePrefix, registeredAddress: DEMO_VENDOR.registeredAddress },
      products: Object.fromEntries(ids.filter((p) => this.st.products[p]).map((p) => {
        const x = this.st.products[p]!;
        return [p, { productId: p, name: x.name, hsnCode: x.hsnCode, gstSlab: x.gstSlab, cessRate: 0, taxType: x.taxType, unit: x.unit, complianceStatus: x.complianceStatus }];
      })),
      inventory: Object.fromEntries(ids.map((p) => [p, this.st.inv[inventoryDocId(store.storeId, p)]]).filter(([, r]) => r).map(([p, r]) => {
        const rec = r as InvRec;
        return [p, { productId: p as string, productName: this.st.products[p as string]?.name ?? '', sellingPrice: rec.sellingPrice, mrp: rec.mrp, onHand: 0, reorderThreshold: rec.reorderThreshold, aisleBinCode: rec.aisleBinCode, isListed: rec.isListed }];
      })),
      batches: Object.fromEntries(ids.map((p) => [p, (this.st.batches[inventoryDocId(store.storeId, p)] ?? []).map((b) => ({ ...b }))])),
      counterLastSeq: this.st.counters[counterKey] ?? 0,
    };
    let plan;
    try {
      plan = planSale({ channel: i.channel, items, payment: { method: i.payment.method, status: 'PAID', providerRef: i.payment.providerRef ?? null }, buyer: i.buyer, guestUid: cart?.guestUid ?? null, actorUid: actor.uid }, snap);
    } catch (e) {
      wrap(e);
    }
    // apply
    for (const w of plan.batchWrites) {
      const b = this.st.batches[inventoryDocId(store.storeId, w.productId)]!.find((x) => x.batchId === w.batchId)!;
      b.qty = w.qty;
    }
    const orderId = this.id('o-');
    for (const l of plan.ledger) this.ledger(store.storeId, l.productId, l, 'ORDER', orderId, null, actor.uid);
    this.st.counters[counterKey] = plan.seq;
    if (cart) cart.status = 'CONSUMED';

    let irn: string | null = null;
    let ackNo: string | null = null;
    let signedQr: string | null = null;
    let upiQr: string | null = null;
    const sellerGstin = plan.sellerSnapshot.gstin;
    if (plan.computation.kind === 'B2B' && sellerGstin) {
      const reg = await this.gst.register(
        this.gst.buildEInvoice({
          computation: plan.computation,
          docType: 'INV',
          docNo: plan.invoiceNo,
          docDate: new Date(nowMs),
          seller: { legalName: plan.sellerSnapshot.legalName, tradeName: plan.sellerSnapshot.tradeName, gstin: sellerGstin, addr1: store.addressLine, location: store.city, pincode: store.pincode, stateCode: store.stateCode },
          buyer: { legalName: plan.buyer.name ?? 'Registered buyer', gstin: plan.buyer.gstin!, addr1: plan.buyer.address ?? 'Counter sale', location: store.city, pincode: store.pincode, stateCode: plan.buyer.gstin!.slice(0, 2) },
        }),
      );
      irn = reg.Irn;
      ackNo = reg.AckNo;
      signedQr = reg.SignedQRCode;
    } else if (store.upiVpa && sellerGstin) {
      upiQr = this.gst.b2cUpiQr({ sellerGstin, payeeVpa: store.upiVpa, payeeName: plan.sellerSnapshot.tradeName, invoiceNo: plan.invoiceNo, invoiceDate: new Date(nowMs), computation: plan.computation });
    }
    const rec: InvoiceRec = {
      invoiceId: orderId,
      invoiceNo: plan.invoiceNo,
      kind: plan.computation.kind,
      storeId: store.storeId,
      orderId,
      issuedMs: nowMs,
      grandTotal: plan.computation.totals.grandTotal,
      paymentMethod: i.payment.method,
      buyer: plan.buyer,
      sellerSnapshot: plan.sellerSnapshot,
      computation: plan.computation,
      irn,
      ackNo,
      guestUid: cart?.guestUid ?? null,
      channel: i.channel,
      signedQr,
      upiQr,
    };
    this.st.invoices.unshift(rec);
    this.save();
    return { orderId, invoiceId: orderId, invoiceNo: plan.invoiceNo, kind: plan.computation.kind, grandTotal: plan.computation.totals.grandTotal, totalTax: plan.computation.totals.totalTax };
  }

  async commitSale(i: SaleInput) {
    const u = this.requireOperator(i.storeId);
    if (i.channel === 'POS_WALKIN' && !i.items?.length) throw new DataError('Add items to the bill');
    return this.sell(u, i, null, false);
  }
  async listInvoices(opts: { fromMs: number; toMs: number; storeId?: string }) {
    const u = this.me();
    const v = this.vendorOf(u);
    return this.st.invoices.filter((x) => this.store(x.storeId).vendorId === v && x.issuedMs >= opts.fromMs && x.issuedMs <= opts.toMs && (!opts.storeId || x.storeId === opts.storeId) && (u.role !== 'staff' || u.storeIds?.includes(x.storeId)));
  }
  private async pdf(rec: InvoiceRec, format: 'A4' | 'THERMAL_80MM') {
    const store = this.store(rec.storeId);
    const bytes = await this.gst.renderPdf(
      {
        invoiceNo: rec.invoiceNo,
        invoiceDate: new Date(rec.issuedMs),
        seller: { ...rec.sellerSnapshot, storeName: store.name },
        buyer: { name: rec.buyer.name, gstin: rec.buyer.gstin, address: rec.buyer.address },
        computation: rec.computation,
        orderRef: rec.orderId,
        paymentMode: { CASH: 'Cash', UPI_QR: 'UPI', UPI_INTENT: 'UPI', CARD: 'Card', COD: 'Cash on delivery' }[rec.paymentMethod],
        irn: rec.irn,
        ackNo: rec.ackNo,
        qrPayload: rec.signedQr ?? rec.upiQr,
        qrCaption: rec.signedQr ? 'Signed e-invoice QR (test mode)' : 'UPI QR with GST break-up',
        isMockIrn: !!rec.irn,
        footerNote: 'Demo invoice generated by Pansari Express preview.',
      },
      format,
    );
    return new Blob([bytes as BlobPart], { type: 'application/pdf' });
  }
  async invoicePdf(invoiceId: string, format: 'A4' | 'THERMAL_80MM') {
    const rec = (await this.listInvoices({ fromMs: 0, toMs: Infinity })).find((x) => x.invoiceId === invoiceId) as InvoiceRec | undefined;
    if (!rec) throw new DataError('Invoice not found');
    return this.pdf(rec, format);
  }
  async signStoreQr(storeId: string) {
    const u = this.me();
    if (u.role !== 'super_admin' && !this.operates(u, storeId, true)) throw new DataError('Only the shop owner can print store QR posters', 'PERMISSION_DENIED');
    const s = this.store(storeId);
    if (!s.acceptsWalkInQr) throw new DataError('This location does not take walk-in customers');
    const token = await signToken({ t: 'store', sid: storeId, ver: s.qrKeyVersion, iat: Math.floor(Date.now() / 1000) }, 'k1', QR_SECRET);
    const url = this.opts.storeUrl ? this.opts.storeUrl(storeId, token) : `${typeof location !== 'undefined' ? location.origin : 'http://localhost:3000'}${process.env.NEXT_PUBLIC_BASE_PATH || ''}/store?s=${storeId}&token=${encodeURIComponent(token)}`;
    return { url, token };
  }
  async demoPoster(storeId: string) {
    const s = this.store(storeId);
    const token = await signToken({ t: 'store', sid: storeId, ver: s.qrKeyVersion, iat: Math.floor(Date.now() / 1000) }, 'k1', QR_SECRET);
    const url = this.opts.storeUrl ? this.opts.storeUrl(storeId, token) : `${typeof location !== 'undefined' ? location.origin : 'http://localhost:3000'}${process.env.NEXT_PUBLIC_BASE_PATH || ''}/store?s=${storeId}&token=${encodeURIComponent(token)}`;
    return { url, token };
  }
  async redeemCheckout(token: string) {
    const u = this.me();
    try {
      const p = await verifyToken(token.trim(), { expectedType: 'checkout', secretFor: (k) => (k === 'k1' ? QR_SECRET : undefined) });
      if (!this.operates(u, p.sid)) throw new DataError(`This cart is for ${this.store(p.sid).name}`, 'NOT_YOUR_STORE');
      if (this.st.usedNonces.includes(p.n)) throw new DataError('This checkout QR was already used', 'ALREADY_REDEEMED');
      this.st.usedNonces.push(p.n);
      this.save();
      return { cartId: p.cid, storeId: p.sid, guestUid: p.uid };
    } catch (e) {
      wrap(e);
    }
  }
  async getCart(cartId: string) {
    const c = this.st.carts[cartId];
    if (!c) return null;
    const asStaff = this.staff && this.operates(this.staff, c.storeId);
    const asGuest = this.guest?.uid === c.guestUid;
    if (!asStaff && !asGuest) throw new DataError('Not allowed', 'PERMISSION_DENIED');
    return { ...c, items: c.items.map((x) => ({ ...x })) };
  }

  /* -------------------------------------------------- walk-in guest */
  onGuestChange(cb: (u: AppUser | null) => void) {
    this.guestL.add(cb);
    queueMicrotask(() => cb(this.activeGuest()));
    return () => void this.guestL.delete(cb);
  }
  private activeGuest() {
    if (this.guest && this.guest.role === 'temp_qr_guest' && (this.guest.qrExp ?? 0) < Date.now() / 1000) this.guest = null;
    return this.guest;
  }
  private setGuest(u: AppUser | null) {
    this.guest = u;
    try {
      if (u) this.ss?.setItem(GUEST_KEY, JSON.stringify(u));
      else this.ss?.removeItem(GUEST_KEY);
    } catch {}
    this.guestL.forEach((l) => l(u));
  }
  private requireGuest(storeId: string) {
    const g = this.activeGuest();
    if (!g || g.role !== 'temp_qr_guest' || g.scopedStoreId !== storeId) throw new DataError('Scan the store QR to start shopping', 'GUEST_SESSION_REQUIRED');
    return g;
  }
  async resolveStoreQr(storeId: string, token: string) {
    try {
      const p = await verifyToken(token, { expectedType: 'store', secretFor: (k) => (k === 'k1' ? QR_SECRET : undefined) });
      if (p.sid !== storeId) throw new DataError('This QR belongs to another store', 'QR_STORE_MISMATCH');
      const s = this.store(storeId);
      if (!s.isActive || !s.acceptsWalkInQr) throw new DataError('This store is not taking walk-in orders right now');
      if (s.qrKeyVersion !== p.ver) throw new DataError('This poster has been replaced — ask the shop for the new QR', 'QR_REVOKED');
      return s;
    } catch (e) {
      wrap(e);
    }
  }
  async startGuestSession(storeId: string, token: string, turnstileToken: string) {
    if (turnstileToken !== DEMO_TURNSTILE_PASS) throw new DataError('Please complete the human check', 'TURNSTILE_FAILED');
    await this.resolveStoreQr(storeId, token);
    const current = this.activeGuest();
    const u: AppUser = { uid: current?.isAnonymous ? current.uid : `anon-${randomId(6)}`, phone: null, displayName: null, role: 'temp_qr_guest', scopedStoreId: storeId, qrExp: Math.floor(Date.now() / 1000) + QR_GUEST_SESSION_SECONDS, isAnonymous: true };
    this.setGuest(u);
    return u;
  }
  async guestInventory(storeId: string) {
    this.requireGuest(storeId);
    return Object.values(this.st.inv)
      .filter((r) => r.storeId === storeId && r.isListed && this.st.products[r.productId]?.complianceStatus === 'APPROVED' && r.sellingPrice > 0)
      .map((r) => this.row(r))
      .sort((a, b) => a.product.name.localeCompare(b.product.name));
  }
  async saveGuestCart(storeId: string, items: { productId: string; qty: number }[], cartId?: string) {
    const g = this.requireGuest(storeId);
    if (items.length > 50) throw new DataError('Cart is full');
    const clean = items.filter((x) => typeof x.productId === 'string' && x.qty > 0).map((x) => ({ productId: x.productId, qty: x.qty }));
    const existing = cartId ? this.st.carts[cartId] : undefined;
    if (existing && existing.guestUid === g.uid && existing.status === 'OPEN' && existing.expiresAtMs > Date.now()) {
      existing.items = clean;
      this.save();
      return { ...existing };
    }
    const cart: GuestCart = { cartId: this.id('c-'), storeId, items: clean, status: 'OPEN', expiresAtMs: Date.now() + TEMP_CART_TTL_SECONDS * 1000, guestUid: g.uid };
    this.st.carts[cart.cartId] = cart;
    this.save();
    return { ...cart };
  }
  async createCheckoutToken(cartId: string) {
    const c = this.st.carts[cartId];
    if (!c) throw new DataError('Cart not found');
    const g = this.requireGuest(c.storeId);
    if (c.guestUid !== g.uid) throw new DataError('Not your cart');
    if (c.status === 'CONSUMED') throw new DataError('This cart was already billed');
    if (!c.items.length) throw new DataError('Your cart is empty');
    const now = Math.floor(Date.now() / 1000);
    const exp = now + CHECKOUT_TOKEN_TTL_SECONDS;
    const token = await signToken({ t: 'checkout', sid: c.storeId, cid: cartId, uid: g.uid, iat: now, exp, n: randomId(9) }, 'k1', QR_SECRET);
    c.status = 'CHECKOUT_PENDING';
    this.save();
    return { token, expiresAtMs: exp * 1000 };
  }
  async guestCommitSale(i: SaleInput) {
    const g = this.requireGuest(i.storeId);
    if (i.channel !== 'OFFLINE_QR' || !i.tempCartId) throw new DataError('Guests can only pay for their own walk-in cart');
    if (i.payment.method === 'CASH') throw new DataError('Pay cash at the counter instead');
    if (i.simulateOutcome === 'fail') throw new DataError('Payment declined (simulated)', 'PAYMENT_DECLINED');
    return this.sell(g, { ...i, payment: { method: i.payment.method, providerRef: `MOCK-${randomId(6)}` } }, g.uid, true);
  }
  async guestInvoice(invoiceId: string) {
    const g = this.activeGuest();
    const rec = this.st.invoices.find((x) => x.invoiceId === invoiceId);
    if (!g || !rec || rec.guestUid !== g.uid) return null;
    return rec;
  }
  async guestInvoices() {
    const g = this.activeGuest();
    if (!g) return [];
    return this.st.invoices.filter((x) => x.guestUid === g.uid);
  }
  async guestInvoicePdf(invoiceId: string) {
    const g = this.activeGuest();
    const rec = this.st.invoices.find((x) => x.invoiceId === invoiceId);
    if (!g || !rec || rec.guestUid !== g.uid) throw new DataError('Invoice not found');
    return this.pdf(rec, 'A4');
  }
  async sendGuestLinkOtp(phone: string) {
    if (!this.activeGuest()?.isAnonymous) throw new DataError('Only a walk-in session can be saved to an account');
    return this.sendOtp(phone);
  }
  async confirmGuestLink(verificationId: string, code: string) {
    const g = this.activeGuest();
    if (!g?.isAnonymous) throw new DataError('Only a walk-in session can be saved to an account');
    if (code !== OTP) throw new DataError('Wrong OTP (demo OTP is 123456)', 'INVALID_CODE');
    const phone = verificationId.replace(/^demo:/, '');
    if (this.st.users[phone] && this.st.users[phone]!.uid !== g.uid) throw new DataError('This number already has an account — sign in with it instead', 'PHONE_IN_USE');
    const u: AppUser = { uid: g.uid, phone, displayName: null, role: 'customer', isAnonymous: false };
    this.st.users[phone] = u;
    this.save();
    this.setGuest({ ...u, role: 'customer' });
    return u;
  }
}

function safeStorage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    const s = window[kind];
    const k = '__pansari_probe__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}
