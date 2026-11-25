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
  type SalesChannel,
  type InvoiceComputation,
  type OrderStatus,
  type PlannedLine,
  type PaymentMethod,
  type PaymentStatus,
  type SaleCharge,
  DEMO_ZONES,
  canTransition,
  checkOnlinePayment,
  customerCanCancel,
  deliveryCharge,
  formatInvoiceNo,
  hashDeliveryOtp,
  isDispatch,
  isValidPincode,
  nextForwardStatus,
  newDeliveryOtp,
  operatorCanCancel,
  OrderError,
  planCancelRestock,
  refundOnCancel,
  WALLET_TOPUP_MAX,
} from '@pansari/shared';
import { LocalGeoProvider, MockGstProvider } from '@pansari/adapters';
import type { Address, AddressInput, AdjustInput, AppUser, CustomerProfile, DataClient, DeliveryCheck, GuestCart, HsnRow, InventoryRow, InvoiceRow, InwardInput, LedgerRow, OrderRow, PlaceOrderInput, ProductInfo, ProductInput, SaleInput, SaleResult, StoreInfo, TicketInput, TicketRow, WalletTxn } from './types';
import { DataError } from './types';

const KEY = 'pansari-demo-v3';
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
  customerUid?: string | null;
  channel: SalesChannel;
  signedQr: string | null;
  upiQr: string | null;
}
interface OrderRec {
  orderId: string;
  storeId: string;
  customerUid: string;
  customerPhone: string | null;
  customerName: string | null;
  lines: PlannedLine[];
  charges: SaleCharge[];
  computation: InvoiceComputation;
  sellerSnapshot: InvoiceRow['sellerSnapshot'];
  buyer: InvoiceRow['buyer'];
  payment: { method: PaymentMethod; status: PaymentStatus; providerRef: string | null };
  status: OrderStatus;
  statusHistory: { status: OrderStatus; at: number; by: string }[];
  deliveryAddress: Address;
  etaMinutes: number | null;
  placedMs: number;
  invoiceId: string | null;
  invoiceNo: string | null;
  cancelReason: string | null;
  otpHash: string;
  otp: string; // demo only: the customer's copy (production keeps it in order_secrets)
}
interface Profile {
  displayName: string | null;
  addresses: Address[];
  walletBalance: number;
}
interface State {
  stores: (StoreInfo & { isActive: boolean; acceptsOnline: boolean; location: { lat: number; lng: number } })[];
  orders: OrderRec[];
  profiles: Record<string, Profile>;
  wallet: (WalletTxn & { uid: string })[];
  tickets: TicketRow[];
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
  { phone: '+919999999994', label: 'Customer · Priya', note: 'Online delivery shopping, saved address, ₹200 wallet', user: { displayName: 'Priya Sharma', role: 'customer' } },
];

function seed(): State {
  const now = Date.now();
  const st: State = {
    stores: DEMO_STORES.map((s) => ({ storeId: s.storeId, vendorId: DEMO_VENDOR.vendorId, name: s.name, type: s.type, addressLine: s.addressLine, city: s.city, pincode: s.pincode, stateCode: s.stateCode, upiVpa: s.upiVpa, acceptsWalkInQr: s.acceptsWalkInQr, acceptsOnline: s.acceptsOnline, location: s.location, qrKeyVersion: 1, isActive: true })),
    orders: [],
    profiles: {},
    wallet: [],
    tickets: [],
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
  st.profiles['u-9994'] = {
    displayName: 'Priya Sharma',
    addresses: [{ id: 'a-home', label: 'Home', line1: 'House 21, Haldiyon ka Rasta', line2: 'Near Johari Bazaar', city: 'Jaipur', pincode: '302003', stateCode: '08', location: { lat: 26.9205, lng: 75.8251 } }],
    walletBalance: 20_000,
  };
  st.wallet.push({ id: 'w-welcome', uid: 'u-9994', kind: 'ADJUSTMENT', amount: 20_000, balanceAfter: 20_000, refId: null, note: 'Welcome credit (demo)', atMs: now });
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
  /** URL prefix when the web app is served from a sub-path (GitHub Pages). */
  basePath?: string;
  /** Turn off the cross-tab storage listener (React Native). */
  noWindowSync?: boolean;
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
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && this.ls && !opts.noWindowSync) {
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

  private defaultStoreUrl(storeId: string, token: string) {
    const origin = typeof location !== 'undefined' && location.origin ? location.origin : 'http://localhost:3000';
    return `${origin}${this.opts.basePath ?? ''}/store?s=${storeId}&token=${encodeURIComponent(token)}`;
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

    const rec = await this.issueInvoice({ store, orderId, nowMs, invoiceNo: plan.invoiceNo, computation: plan.computation, sellerSnapshot: plan.sellerSnapshot, buyer: plan.buyer, paymentMethod: i.payment.method, guestUid: cart?.guestUid ?? null, customerUid: null, channel: i.channel });
    this.save();
    return { orderId, invoiceId: rec.invoiceId, invoiceNo: plan.invoiceNo, kind: plan.computation.kind, grandTotal: plan.computation.totals.grandTotal, totalTax: plan.computation.totals.totalTax };
  }

  private async issueInvoice(a: { store: State['stores'][number]; orderId: string; nowMs: number; invoiceNo: string; computation: InvoiceComputation; sellerSnapshot: InvoiceRow['sellerSnapshot']; buyer: InvoiceRow['buyer']; paymentMethod: PaymentMethod; guestUid: string | null; customerUid: string | null; channel: SalesChannel; deliveryAddress?: Address | null }): Promise<InvoiceRec> {
    const { store, computation, sellerSnapshot, buyer } = a;
    let irn: string | null = null;
    let ackNo: string | null = null;
    let signedQr: string | null = null;
    let upiQr: string | null = null;
    const sellerGstin = sellerSnapshot.gstin;
    if (computation.kind === 'B2B' && sellerGstin) {
      const reg = await this.gst.register(
        this.gst.buildEInvoice({
          computation,
          docType: 'INV',
          docNo: a.invoiceNo,
          docDate: new Date(a.nowMs),
          seller: { legalName: sellerSnapshot.legalName, tradeName: sellerSnapshot.tradeName, gstin: sellerGstin, addr1: store.addressLine, location: store.city, pincode: store.pincode, stateCode: store.stateCode },
          buyer: { legalName: buyer.name ?? 'Registered buyer', gstin: buyer.gstin!, addr1: buyer.address ?? 'Counter sale', location: store.city, pincode: store.pincode, stateCode: buyer.gstin!.slice(0, 2) },
        }),
      );
      irn = reg.Irn;
      ackNo = reg.AckNo;
      signedQr = reg.SignedQRCode;
    } else if (store.upiVpa && sellerGstin && a.channel !== 'ONLINE') {
      upiQr = this.gst.b2cUpiQr({ sellerGstin, payeeVpa: store.upiVpa, payeeName: sellerSnapshot.tradeName, invoiceNo: a.invoiceNo, invoiceDate: new Date(a.nowMs), computation });
    }
    const rec: InvoiceRec = {
      invoiceId: a.orderId,
      invoiceNo: a.invoiceNo,
      kind: computation.kind,
      storeId: store.storeId,
      orderId: a.orderId,
      issuedMs: a.nowMs,
      grandTotal: computation.totals.grandTotal,
      paymentMethod: a.paymentMethod,
      buyer,
      sellerSnapshot,
      computation,
      irn,
      ackNo,
      guestUid: a.guestUid,
      customerUid: a.customerUid,
      channel: a.channel,
      signedQr,
      upiQr,
    };
    this.st.invoices.unshift(rec);
    return rec;
  }

  private snapshotFor(store: State['stores'][number], items: { productId: string }[], nowMs: number): SaleSnapshot {
    const fy = financialYear(new Date(nowMs));
    const ids = [...new Set(items.map((x) => x.productId))];
    return {
      nowMs,
      store: { storeId: store.storeId, vendorId: store.vendorId, name: store.name, stateCode: store.stateCode, addressLine: store.addressLine, city: store.city, pincode: store.pincode, gstin: null, fssaiLicenseNo: null, isActive: store.isActive },
      vendor: { vendorId: DEMO_VENDOR.vendorId, legalName: DEMO_VENDOR.legalName, tradeName: DEMO_VENDOR.tradeName, gstin: DEMO_VENDOR.gstin, fssaiLicenseNo: DEMO_VENDOR.fssaiLicenseNo, stateCode: DEMO_VENDOR.stateCode, invoicePrefix: DEMO_VENDOR.invoicePrefix, registeredAddress: DEMO_VENDOR.registeredAddress },
      products: Object.fromEntries(ids.filter((p) => this.st.products[p]).map((p) => {
        const x = this.st.products[p]!;
        return [p, { productId: p, name: x.name, hsnCode: x.hsnCode, gstSlab: x.gstSlab, cessRate: 0, taxType: x.taxType, unit: x.unit, complianceStatus: x.complianceStatus }];
      })),
      inventory: Object.fromEntries(ids.map((p) => [p, this.st.inv[inventoryDocId(store.storeId, p)]] as const).filter(([, r]) => r).map(([p, r]) => [p, { productId: p, productName: this.st.products[p]?.name ?? '', sellingPrice: r!.sellingPrice, mrp: r!.mrp, onHand: 0, reorderThreshold: r!.reorderThreshold, aisleBinCode: r!.aisleBinCode, isListed: r!.isListed }])),
      batches: Object.fromEntries(ids.map((p) => [p, (this.st.batches[inventoryDocId(store.storeId, p)] ?? []).map((b) => ({ ...b }))])),
      counterLastSeq: this.st.counters[`${store.vendorId}_${fy}`] ?? 0,
    };
  }

  /* -------------------------------------------------- customer: delivery */
  private geo = new LocalGeoProvider({ maxDistanceMeters: 7000 });
  private customer(): AppUser {
    const u = this.me();
    if (u.role !== 'customer') throw new DataError('Sign in with a customer account to order', 'PERMISSION_DENIED');
    return u;
  }
  private profile(uid: string): Profile {
    return (this.st.profiles[uid] ??= { displayName: null, addresses: [], walletBalance: 0 });
  }
  async deliveryStores() {
    return this.st.stores.filter((s) => s.isActive && s.acceptsOnline).map(({ acceptsOnline: _a, location: _l, isActive: _i, ...rest }) => rest);
  }
  async shopCatalog(storeId: string) {
    const s = this.store(storeId);
    if (!s.acceptsOnline) throw new DataError('This store does not deliver');
    return Object.values(this.st.inv)
      .filter((r) => r.storeId === storeId && r.isListed && this.st.products[r.productId]?.complianceStatus === 'APPROVED' && r.sellingPrice > 0)
      .map((r) => this.row(r))
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
    const r = this.geo.checkServiceability(p, DEMO_ZONES, this.st.stores.map((s) => ({ storeId: s.storeId, name: s.name, location: s.location, isActive: s.isActive, acceptsOnline: s.acceptsOnline })));
    const zone = r.zone ? DEMO_ZONES.find((z) => z.zoneId === r.zone!.zoneId)! : null;
    return {
      serviceable: r.serviceable,
      reason: r.reason,
      storeId: r.store?.storeId ?? null,
      storeName: r.store?.name ?? null,
      etaMinutes: r.etaMinutes,
      distanceMeters: r.distanceMeters === null ? null : Math.round(r.distanceMeters),
      baseDeliveryFee: zone?.baseDeliveryFee ?? 0,
      freeDeliveryAbove: zone?.freeDeliveryAbove ?? 0,
      surgeMultiplierBps: zone?.surgeMultiplierBps ?? 10_000,
    };
  }
  async myProfile(): Promise<CustomerProfile> {
    const u = this.me();
    const p = this.profile(u.uid);
    return { uid: u.uid, phone: u.phone, displayName: p.displayName ?? u.displayName, addresses: p.addresses.map((a) => ({ ...a })), walletBalance: p.walletBalance };
  }
  async saveProfileName(displayName: string) {
    const u = this.me();
    const name = displayName.trim().slice(0, 60);
    if (name.length < 2) throw new DataError('Enter your name');
    this.profile(u.uid).displayName = name;
    this.save();
  }
  async saveAddress(i: AddressInput): Promise<Address> {
    const u = this.me();
    const prof = this.profile(u.uid);
    if (!i.line1?.trim() || i.line1.trim().length < 4) throw new DataError('Enter house / street');
    if (!isValidPincode(i.pincode)) throw new DataError('Enter a 6-digit pincode');
    const g = await this.geo.geocodePincode(i.pincode.trim());
    if (!g && !i.location) throw new DataError('We could not find this pincode — use "Use my location"');
    if (!i.id && prof.addresses.length >= 10) throw new DataError('You can save up to 10 addresses');
    const addr: Address = {
      id: i.id ?? this.id('a-'),
      label: (i.label?.trim() || 'Home').slice(0, 20),
      line1: i.line1.trim().slice(0, 120),
      line2: i.line2?.trim().slice(0, 120) || undefined,
      city: g?.city ?? 'Jaipur',
      pincode: i.pincode.trim(),
      stateCode: g?.stateCode ?? '08',
      location: i.location ?? g!.center,
    };
    const idx = prof.addresses.findIndex((a) => a.id === addr.id);
    if (idx >= 0) prof.addresses[idx] = addr;
    else prof.addresses.push(addr);
    this.save();
    return addr;
  }
  async deleteAddress(addressId: string) {
    const prof = this.profile(this.me().uid);
    prof.addresses = prof.addresses.filter((a) => a.id !== addressId);
    this.save();
  }
  private walletPost(uid: string, kind: WalletTxn['kind'], amount: number, refId: string | null, note: string | null) {
    const prof = this.profile(uid);
    prof.walletBalance += amount;
    if (prof.walletBalance < 0) throw new DataError('Wallet balance is not enough');
    this.st.wallet.unshift({ id: this.id('w-'), uid, kind, amount, balanceAfter: prof.walletBalance, refId, note, atMs: Date.now() });
  }
  async placeOrder(i: PlaceOrderInput) {
    const u = this.customer();
    const prof = this.profile(u.uid);
    const addr = prof.addresses.find((a) => a.id === i.addressId);
    if (!addr) throw new DataError('Choose a delivery address');
    const check = await this.checkDelivery({ pincode: addr.pincode, location: addr.location });
    if (!check.serviceable || !check.storeId) throw new DataError('Sorry, we do not deliver to this address yet', 'NOT_SERVICEABLE');
    if (check.storeId !== i.storeId) throw new DataError('Your address is served by another store — your cart was refreshed', 'STORE_CHANGED');
    const store = this.store(check.storeId);
    const nowMs = Date.now();
    const req = { channel: 'ONLINE' as const, items: i.items, payment: { method: i.paymentMethod, status: 'PENDING' as const, providerRef: null }, buyer: { name: prof.displayName ?? u.displayName, address: `${addr.line1}, ${addr.city} ${addr.pincode}`, placeOfSupplyStateCode: addr.stateCode }, customerUid: u.uid, actorUid: u.uid };
    let plan;
    try {
      const pre = planSale(req, this.snapshotFor(store, i.items, nowMs));
      const charges = deliveryCharge(pre.computation.totals.grandTotal, check);
      plan = planSale({ ...req, charges }, this.snapshotFor(store, i.items, nowMs));
      checkOnlinePayment(i.paymentMethod, pre.computation.totals.grandTotal, plan.computation.totals.grandTotal, prof.walletBalance);
      (req as { charges?: SaleCharge[] }).charges = charges;
    } catch (e) {
      if (e instanceof OrderError) throw new DataError(e.message, e.code);
      wrap(e);
    }
    const grand = plan.computation.totals.grandTotal;
    if ((i.paymentMethod === 'UPI_INTENT' || i.paymentMethod === 'CARD') && i.simulateOutcome === 'fail') throw new DataError('Payment declined (test mode). Nothing was charged.', 'PAYMENT_DECLINED');
    const orderId = this.id('o-');
    if (i.paymentMethod === 'WALLET') this.walletPost(u.uid, 'ORDER_DEBIT', -grand, orderId, `Order ${orderId}`);
    for (const w of plan.batchWrites) this.st.batches[inventoryDocId(store.storeId, w.productId)]!.find((x) => x.batchId === w.batchId)!.qty = w.qty;
    for (const l of plan.ledger) this.ledger(store.storeId, l.productId, l, 'ORDER', orderId, null, u.uid);
    const otp = newDeliveryOtp();
    this.st.orders.unshift({
      orderId,
      storeId: store.storeId,
      customerUid: u.uid,
      customerPhone: u.phone,
      customerName: prof.displayName ?? u.displayName,
      lines: plan.lines,
      charges: (req as { charges?: SaleCharge[] }).charges ?? [],
      computation: plan.computation,
      sellerSnapshot: plan.sellerSnapshot,
      buyer: plan.buyer,
      payment: { method: i.paymentMethod, status: i.paymentMethod === 'COD' ? 'PENDING' : 'PAID', providerRef: i.paymentMethod === 'COD' ? null : `MOCK-${randomId(6)}` },
      status: 'PLACED',
      statusHistory: [{ status: 'PLACED', at: nowMs, by: u.uid }],
      deliveryAddress: { ...addr },
      etaMinutes: check.etaMinutes,
      placedMs: nowMs,
      invoiceId: null,
      invoiceNo: null,
      cancelReason: null,
      otpHash: await hashDeliveryOtp(orderId, otp),
      otp,
    });
    this.save();
    return { orderId, grandTotal: grand, etaMinutes: check.etaMinutes };
  }
  private orderRow(o: OrderRec, forCustomer: boolean): OrderRow {
    const t = o.computation.totals;
    const chargesTotal = o.charges.reduce((a, c) => a + c.amount, 0);
    const live = !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status);
    return {
      orderId: o.orderId,
      channel: 'ONLINE',
      storeId: o.storeId,
      storeName: this.store(o.storeId).name,
      status: o.status,
      statusHistory: o.statusHistory.map((h) => ({ ...h })),
      lines: o.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice })),
      charges: o.charges.map((c) => ({ code: c.code, name: c.name, amount: c.amount })),
      itemsTotal: t.grandTotal - chargesTotal - t.roundOff,
      totalTax: t.totalTax,
      grandTotal: t.grandTotal,
      payment: { method: o.payment.method, status: o.payment.status },
      deliveryAddress: { ...o.deliveryAddress },
      etaMinutes: o.etaMinutes,
      placedMs: o.placedMs,
      invoiceId: o.invoiceId,
      invoiceNo: o.invoiceNo,
      cancelReason: o.cancelReason,
      deliveryOtp: forCustomer && live ? o.otp : null,
      customerPhone: forCustomer ? undefined : o.customerPhone,
      customerName: forCustomer ? undefined : o.customerName,
    };
  }
  async myOrders() {
    const u = this.me();
    return this.st.orders.filter((o) => o.customerUid === u.uid).map((o) => this.orderRow(o, true));
  }
  async getOrder(orderId: string) {
    const u = this.me();
    const o = this.st.orders.find((x) => x.orderId === orderId);
    if (!o) return null;
    if (o.customerUid === u.uid) return this.orderRow(o, true);
    if (this.operates(u, o.storeId) || u.role === 'super_admin') return this.orderRow(o, false);
    return null;
  }
  private restock(o: OrderRec, by: string) {
    const ids = o.lines.map((l) => l.productId);
    const r = planCancelRestock(o.lines, {
      nowMs: Date.now(),
      batches: Object.fromEntries(ids.map((p) => [p, (this.st.batches[inventoryDocId(o.storeId, p)] ?? []).map((b) => ({ ...b }))])),
      reorderThreshold: Object.fromEntries(ids.map((p) => [p, this.st.inv[inventoryDocId(o.storeId, p)]?.reorderThreshold ?? 0])),
    });
    for (const w of r.batchWrites) this.st.batches[inventoryDocId(o.storeId, w.productId)]!.find((x) => x.batchId === w.batchId)!.qty = w.qty;
    for (const l of r.ledger) this.ledger(o.storeId, l.productId, l, 'ORDER', o.orderId, o.cancelReason, by);
  }
  private closeAsCancelled(o: OrderRec, status: 'CANCELLED' | 'REJECTED', reason: string, by: string) {
    o.status = status;
    o.cancelReason = reason;
    o.statusHistory.push({ status, at: Date.now(), by });
    this.restock(o, by);
    const refund = refundOnCancel(o.payment, o.computation.totals.grandTotal);
    if (refund > 0) {
      this.walletPost(o.customerUid, 'REFUND', refund, o.orderId, `Refund for ${o.orderId}`);
      o.payment.status = 'REFUNDED';
    }
    return refund;
  }
  async cancelMyOrder(orderId: string, reason: string) {
    const u = this.me();
    const o = this.st.orders.find((x) => x.orderId === orderId);
    if (!o || o.customerUid !== u.uid) throw new DataError('Order not found');
    if (!customerCanCancel(o.status)) throw new DataError('The store has started packing this order, so it cannot be cancelled here. Use Help to contact the shop.', 'TOO_LATE');
    const refunded = this.closeAsCancelled(o, 'CANCELLED', reason?.trim().slice(0, 140) || 'Cancelled by customer', u.uid);
    this.save();
    return { refunded };
  }
  async myInvoicePdf(invoiceId: string) {
    const u = this.me();
    const rec = this.st.invoices.find((x) => x.invoiceId === invoiceId);
    if (!rec || rec.customerUid !== u.uid) throw new DataError('Invoice not found');
    return this.pdf(rec, 'A4');
  }
  async walletTxns() {
    const u = this.me();
    return this.st.wallet.filter((w) => w.uid === u.uid).map(({ uid: _u, ...w }) => w);
  }
  async topUpWallet(amount: number, simulateOutcome?: 'success' | 'fail') {
    const u = this.customer();
    if (!Number.isSafeInteger(amount) || amount < 1000 || amount > WALLET_TOPUP_MAX) throw new DataError('Add between ₹10 and ₹10,000');
    if (simulateOutcome === 'fail') throw new DataError('Payment declined (test mode). Nothing was charged.', 'PAYMENT_DECLINED');
    this.walletPost(u.uid, 'TOPUP', amount, `MOCK-${randomId(6)}`, 'Added by UPI (test mode)');
    this.save();
    return { balance: this.profile(u.uid).walletBalance };
  }

  /* -------------------------------------------------- operator: online orders */
  async listOnlineOrders(storeId: string, opts: { includeClosed?: boolean } = {}) {
    const u = this.me();
    if (!this.operates(u, storeId) && u.role !== 'super_admin') throw new DataError('You do not operate this store', 'PERMISSION_DENIED');
    const dayAgo = Date.now() - 86_400_000;
    return this.st.orders
      .filter((o) => o.storeId === storeId && (opts.includeClosed || !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status) || o.placedMs > dayAgo))
      .map((o) => this.orderRow(o, false));
  }
  async advanceOrder(orderId: string, to: OrderStatus, opts: { otp?: string; reason?: string } = {}) {
    const u = this.me();
    const o = this.st.orders.find((x) => x.orderId === orderId);
    if (!o) throw new DataError('Order not found');
    if (!this.operates(u, o.storeId)) throw new DataError('You do not operate this store', 'PERMISSION_DENIED');
    if (!canTransition(o.status, to)) throw new DataError(`Cannot move an order from ${o.status} to ${to}`, 'BAD_TRANSITION');
    if (to === 'CANCELLED' || to === 'REJECTED') {
      if (!operatorCanCancel(o.status)) throw new DataError('Too late to cancel');
      const reason = opts.reason?.trim();
      if (!reason || reason.length < 3) throw new DataError('Write a short reason for the customer');
      this.closeAsCancelled(o, to, reason, u.uid);
      this.save();
      return { status: o.status, invoiceNo: null };
    }
    if (to === 'DELIVERED') {
      if (!opts.otp || (await hashDeliveryOtp(o.orderId, opts.otp)) !== o.otpHash) throw new DataError('Wrong delivery code — ask the customer for the 4-digit code', 'BAD_OTP');
      if (o.payment.method === 'COD') o.payment.status = 'PAID';
    }
    if (isDispatch(to) && !o.invoiceId) {
      const nowMs = Date.now();
      const store = this.store(o.storeId);
      const fy = financialYear(new Date(nowMs));
      const key = `${store.vendorId}_${fy}`;
      const seq = (this.st.counters[key] ?? 0) + 1;
      this.st.counters[key] = seq;
      const invoiceNo = formatInvoiceNo(DEMO_VENDOR.invoicePrefix, fy, seq);
      const rec = await this.issueInvoice({ store, orderId: o.orderId, nowMs, invoiceNo, computation: o.computation, sellerSnapshot: o.sellerSnapshot, buyer: o.buyer, paymentMethod: o.payment.method, guestUid: null, customerUid: o.customerUid, channel: 'ONLINE' });
      o.invoiceId = rec.invoiceId;
      o.invoiceNo = invoiceNo;
    }
    o.status = to;
    o.statusHistory.push({ status: to, at: Date.now(), by: u.uid });
    this.save();
    return { status: o.status, invoiceNo: o.invoiceNo };
  }

  async demoAdvanceOrder(orderId: string) {
    const me = this.me();
    const o = this.st.orders.find((x) => x.orderId === orderId);
    if (!o || o.customerUid !== me.uid) throw new DataError('Order not found');
    const to = nextForwardStatus(o.status);
    if (!to) throw new DataError('This order is already finished');
    const owner = Object.values(this.st.users).find((u) => u.role === 'seller' && u.vendorId === this.store(o.storeId).vendorId);
    if (!owner) throw new DataError('No shop owner in the demo data');
    const prev = this.staff;
    this.staff = owner; // act as the shop for one step, then switch back (demo only)
    try {
      return await this.advanceOrder(orderId, to, { otp: o.otp });
    } finally {
      this.staff = prev;
    }
  }

  /* -------------------------------------------------- support */
  async createSupportTicket(i: TicketInput) {
    const u = this.staff ?? this.activeGuest();
    if (!u) throw new DataError('Sign in so the shop can reach you', 'UNAUTHENTICATED');
    const subject = i.subject?.trim().slice(0, 140);
    if (!subject) throw new DataError('Describe the problem');
    const t: TicketRow = {
      id: this.id('t-'),
      category: i.category,
      subject,
      orderId: i.orderId ?? null,
      storeId: i.storeId ?? (i.orderId ? this.st.orders.find((o) => o.orderId === i.orderId)?.storeId ?? null : null),
      status: 'OPEN',
      priority: i.category === 'DAMAGED_ITEM' || i.category === 'PAYMENT' ? 'HIGH' : 'NORMAL',
      createdBy: u.uid,
      creatorRole: u.role,
      createdMs: Date.now(),
      transcript: i.transcript.slice(-30).map((m) => ({ from: m.from, text: String(m.text).slice(0, 500), at: m.at })),
    };
    this.st.tickets.unshift(t);
    this.save();
    return { ticketId: t.id };
  }
  async listSupportTickets() {
    const u = this.me();
    if (u.role === 'super_admin' || u.role === 'seller') return this.st.tickets.map((t) => ({ ...t }));
    if (u.role === 'staff') return this.st.tickets.filter((t) => t.storeId && u.storeIds?.includes(t.storeId)).map((t) => ({ ...t }));
    return this.st.tickets.filter((t) => t.createdBy === u.uid).map((t) => ({ ...t }));
  }
  async setTicketStatus(ticketId: string, status: TicketRow['status']) {
    const u = this.me();
    if (u.role !== 'seller' && u.role !== 'super_admin' && u.role !== 'staff') throw new DataError('Not allowed', 'PERMISSION_DENIED');
    const t = this.st.tickets.find((x) => x.id === ticketId);
    if (!t) throw new DataError('Ticket not found');
    t.status = status;
    this.save();
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
        paymentMode: { CASH: 'Cash', UPI_QR: 'UPI', UPI_INTENT: 'UPI', CARD: 'Card', COD: 'Cash on delivery', WALLET: 'Pansari wallet' }[rec.paymentMethod],
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
    const url = this.opts.storeUrl ? this.opts.storeUrl(storeId, token) : this.defaultStoreUrl(storeId, token);
    return { url, token };
  }
  async demoPoster(storeId: string) {
    const s = this.store(storeId);
    const token = await signToken({ t: 'store', sid: storeId, ver: s.qrKeyVersion, iat: Math.floor(Date.now() / 1000) }, 'k1', QR_SECRET);
    const url = this.opts.storeUrl ? this.opts.storeUrl(storeId, token) : this.defaultStoreUrl(storeId, token);
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
