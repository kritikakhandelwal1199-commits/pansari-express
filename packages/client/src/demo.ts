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
  ASSIGNABLE_ROLES,
  ASSIGNABLE_STATUSES,
  buildPickList,
  checkAssignRider,
  checkRiderStep,
  ComplianceError,
  MAX_STAFF_STORES,
  planCodDeposit,
  planRecall,
  planRiderDelivered,
  productsAffectedByHsn,
  recalledInOrder,
  riderHasPicked,
  RIDER_KYC_DOCS,
  RIDER_VEHICLES,
  normaliseVehicleNo,
  RiderError,
  rollupKyc,
  validateHsn,
  validateZone,
  VENDOR_KYC_DOCS,
  checkPod,
  ExtrasError,
  haversineMeters,
  planPayout,
  simulateRiderPosition,
  TRACKABLE,
  trackEstimate,
  validateHygiene,
  validPing,
  type PayoutMethod,
  type RiderFix,
  type HsnInput,
  type KycStatus,
  type RiderVehicle,
  type ZoneInput,
  JAIPUR_MAX_DELIVERY_METERS,
  gstinCheckChar,
  HYGIENE_QUESTIONS,
} from '@pansari/shared';
import { LocalGeoProvider, MockGstProvider } from '@pansari/adapters';
import type { Address, AddressInput, AdjustInput, AppUser, AuditRow, CustomerProfile, DataClient, DeliveryCheck, GuestCart, HsnRow, InventoryRow, InvoiceRow, InwardInput, KycDocRow, KycUploadInput, LedgerRow, OrderRow, PickTask, PlaceOrderInput, ProductInfo, ProductInput, RecallInput, RecallResult, RecallRow, RiderCashRow, PayoutRow, HygieneInput, HygieneRow, PhotoInput, RiderProfile, RoleInput, SaleInput, SaleResult, StoreInfo, TicketInput, TicketRow, UserRow, WalletTxn, ZoneRow } from './types';
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
  riderUid?: string | null;
  /** Demo: proof-of-delivery photo (small data: URL) and when it was added. */
  podDataUrl?: string | null;
  podAtMs?: number | null;
}
interface PayoutRec extends PayoutRow {
  vendorId: string;
}
interface HygieneRec extends Omit<HygieneRow, 'storeName' | 'submittedByName'> {
  vendorId: string;
}
type RiderRec = Omit<RiderProfile, 'lastSeenMs'> & { vendorId: string; lastSeenMs: number | null; lastLocation: { lat: number; lng: number } | null };
interface KycRec extends KycDocRow {
  dataUrl: string | null;
}
interface RecallRec extends RecallRow {
  vendorId: string;
  matchedBatchIds: string[];
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
  /* Phase 4 */
  zones: ZoneRow[];
  audit: AuditRow[];
  riders: Record<string, RiderRec>; // by uid
  kyc: KycRec[];
  vendorKyc: Record<string, KycStatus>;
  riderCash: RiderCashRow[];
  recalls: RecallRec[];
  payouts: PayoutRec[];
  hygiene: HygieneRec[];
  /** Demo: a few days of orders, bills and deliveries were generated (see ensureHistory). */
  historyV1?: boolean;
}

const ACCOUNTS: { phone: string; label: string; note: string; user: Omit<AppUser, 'uid' | 'phone' | 'isAnonymous'> }[] = [
  { phone: '+919999999991', label: 'Shop owner', note: 'All stores, prices, catalogue, QR posters', user: { displayName: 'Shop owner', role: 'seller', vendorId: 'V1', storeIds: [] } },
  { phone: '+919999999992', label: 'Sales boy · Johari Bazaar', note: 'Billing and stock at one store', user: { displayName: 'Ramesh', role: 'staff', vendorId: 'V1', storeIds: ['S1'] } },
  { phone: '+919999999993', label: 'Storekeeper · Godown', note: 'Receiving stock at the godown', user: { displayName: 'Kalu', role: 'staff', vendorId: 'V1', storeIds: ['G1'] } },
  { phone: '+919999999990', label: 'Super admin · Rahul', note: 'Roles, delivery zones, GST tax master, product review, audit log', user: { displayName: 'Rahul (admin)', role: 'super_admin' } },
  { phone: '+919999999994', label: 'Customer · Priya', note: 'Online delivery shopping, saved address, ₹200 wallet', user: { displayName: 'Priya Sharma', role: 'customer' } },
  { phone: '+919999999998', label: 'Picker · Sunita', note: 'Packs online orders at Johari Bazaar, receives stock, counts shelves', user: { displayName: 'Sunita', role: 'staff', vendorId: 'V1', storeIds: ['S1'] } },
  { phone: '+919999999995', label: 'Rider · Vikram', note: 'Documents verified — go on shift, pick up, deliver with code, hand in cash', user: { displayName: 'Vikram Singh', role: 'rider' } },
  { phone: '+919999999996', label: 'Rider · Arjun (new)', note: 'New rider — upload documents for verification', user: { displayName: 'Arjun Meena', role: 'rider' } },
  { phone: '+919999999997', label: 'Compliance · Meera', note: 'KYC review, listing review, product recalls', user: { displayName: 'Meera Joshi', role: 'compliance' } },
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
    zones: [],
    audit: [],
    riders: {},
    kyc: [],
    vendorKyc: {},
    riderCash: [],
    recalls: [],
    payouts: [],
    hygiene: [],
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
  migrate(st, now);
  return st;
}

/** Fills in Phase 4 data for demo states saved by an older version (keeps the user's orders and stock). */
function migrate(st: State, now = Date.now()): State {
  st.zones ??= DEMO_ZONES.map((z) => ({ ...z, storeIds: [...z.storeIds] }));
  if (!st.zones.length) st.zones = DEMO_ZONES.map((z) => ({ ...z, storeIds: [...z.storeIds] }));
  // Nov 2026: the two seed zones grew to cover all of Jaipur — replace the old small seed zones.
  for (const z of DEMO_ZONES) {
    const i = st.zones.findIndex((x) => x.zoneId === z.zoneId);
    if (i >= 0 && !st.zones[i]!.name.startsWith('Jaipur ') && /^(Walled city|Malviya Nagar & Sanganer)/.test(st.zones[i]!.name)) st.zones[i] = { ...z, storeIds: [...z.storeIds] };
  }
  st.audit ??= [];
  st.riders ??= {};
  st.kyc ??= [];
  st.vendorKyc ??= {};
  st.riderCash ??= [];
  st.recalls ??= [];
  st.payouts ??= [];
  st.hygiene ??= [];
  for (const a of ACCOUNTS) st.users[a.phone] ??= { uid: `u-${a.phone.slice(-4)}`, phone: a.phone, isAnonymous: false, ...a.user };
  const day = 86_400_000;
  if (!st.riders['u-9995']) {
    st.riders['u-9995'] = { uid: 'u-9995', name: 'Vikram Singh', phone: '+919999999995', vehicleType: 'MOTORCYCLE', vehicleNumber: 'RJ14 CK 4821', kycStatus: 'VERIFIED', isOnline: false, homeStoreId: 'S1', vendorId: DEMO_VENDOR.vendorId, codCashInHand: 0, earningsBalance: 0, activeOrderIds: [], lastSeenMs: null, lastLocation: null };
    for (const [i, t] of RIDER_KYC_DOCS.entries()) {
      st.kyc.push({ id: `k-v${i}`, ownerUid: 'u-9995', ownerType: 'RIDER', ownerName: 'Vikram Singh', vendorId: null, docType: t, fileName: `${t.toLowerCase()}.jpg`, status: 'VERIFIED', reviewNote: null, createdMs: now - 20 * day, reviewedMs: now - 19 * day, dataUrl: null });
    }
  }
  if (!st.riders['u-9996']) {
    st.riders['u-9996'] = { uid: 'u-9996', name: 'Arjun Meena', phone: '+919999999996', vehicleType: 'SCOOTER', vehicleNumber: null, kycStatus: 'PENDING', isOnline: false, homeStoreId: 'S1', vendorId: DEMO_VENDOR.vendorId, codCashInHand: 0, earningsBalance: 0, activeOrderIds: [], lastSeenMs: null, lastLocation: null };
  }
  if (!st.kyc.some((k) => k.ownerType === 'VENDOR')) {
    const owner = st.users['+919999999991']!.uid;
    VENDOR_KYC_DOCS.forEach((t, i) => st.kyc.push({ id: `k-s${i}`, ownerUid: owner, ownerType: 'VENDOR', ownerName: DEMO_VENDOR.tradeName, vendorId: DEMO_VENDOR.vendorId, docType: t, fileName: `${t.toLowerCase()}.pdf`, status: t === 'CANCELLED_CHEQUE' ? 'PENDING' : 'VERIFIED', reviewNote: null, createdMs: now - 30 * day + i, reviewedMs: t === 'CANCELLED_CHEQUE' ? null : now - 29 * day, dataUrl: null }));
    st.vendorKyc[DEMO_VENDOR.vendorId] = 'UNDER_REVIEW';
  }
  if (!st.audit.length) st.audit.push({ id: 'au-seed', actorUid: 'system', actorRole: 'system', action: 'demo.seed', target: { collection: 'platform_config', id: 'demo' }, before: null, after: JSON.stringify({ stores: st.stores.length, products: Object.keys(st.products).length }), atMs: now });
  return st;
}

async function blobToDataUrl(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${b.type || 'application/octet-stream'};base64,${btoa(bin)}`;
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
  if (e instanceof RiderError || e instanceof ComplianceError || e instanceof ExtrasError) throw new DataError(e.message, e.code);
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
    const loaded = this.load();
    this.st = loaded ? migrate(loaded) : seed();
    // Keep tabs in sync (e.g. POS in one tab, customer phone view in another).
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && this.ls && !opts.noWindowSync) {
      window.addEventListener('storage', (e) => {
        if (e.key === KEY && e.newValue) {
          try {
            this.st = migrate(JSON.parse(e.newValue) as State);
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
  /**
   * Demo only: on first load, give the shop a few days of history (counter bills, delivered rider and
   * store orders, cash hand-in, a payout, a refund, a ticket, a hygiene check, an order on the road
   * right now and new orders waiting) by running the same demo flows as each role, then spreading
   * the timestamps over the last three days. Runs once per browser (state.historyV1).
   */
  async ensureHistory() {
    if (this.st.historyV1) return;
    this.st.historyV1 = true;
    const keep = { staff: this.staff, ls: this.ls, listeners: this.staffL };
    this.ls = null;
    this.staffL = new Set();
    const now = Date.now();
    const windows: { start: number; end: number; target: number; span: number }[] = [];
    const pause = () => new Promise((r) => setTimeout(r, 4));
    // Shop hours in India time: `day(2, 11, 5)` = two days ago at 11:05 IST. Today's slots that are still
    // in the future fall back to `fallbackMin` minutes ago, so nothing is ever dated ahead of now.
    const IST = 330 * 60_000;
    const todayStart = Math.floor((now + IST) / 86_400_000) * 86_400_000 - IST;
    const day = (daysAgo: number, hh: number, mm: number, fallbackMin = 60) => {
      const t = todayStart - daysAgo * 86_400_000 + (hh * 60 + mm) * 60_000;
      return t < now - 5 * 60_000 ? t : now - fallbackMin * 60_000;
    };
    const ago = (minutes: number) => now - minutes * 60_000;
    // Today's slots: fixed shop times once it is past 12:30 IST, else counted back from now — either
    // way in time order, so invoice numbers stay chronological (GST invoices must run in sequence).
    const late = now >= todayStart + 12.5 * 3_600_000;
    const today = (hh: number, mm: number, minutesAgo: number) => (late ? day(0, hh, mm) : ago(minutesAgo));
    const ep = async (target: number, minutes: number, fn: () => Promise<void>) => {
      await pause();
      const start = Date.now();
      try {
        await fn();
      } catch (e) {
        console.warn('[demo history] step skipped:', e instanceof Error ? e.message : e);
      }
      windows.push({ start, end: Date.now(), target, span: minutes * 60_000 });
    };
    const as = async (phone: string, name?: string) => {
      const u = await this.verifyOtp(`demo:${phone}`, OTP);
      if (name && !u.displayName) u.displayName = name;
      await pause();
    };
    const otp = (id: string) => this.st.orders.find((o) => o.orderId === id)?.otp;
    const go = async (id: string, steps: OrderStatus[]) => {
      for (const s of steps) {
        await this.advanceOrder(id, s, s === 'DELIVERED' ? { otp: otp(id) } : undefined);
        await pause();
      }
    };
    const OWNER = '+919999999991', SALES = '+919999999992', SUNITA = '+919999999998', VIKRAM = '+919999999995', PRIYA = '+919999999994', NEHA = '+919876500006';
    const RIDER = 'u-9995';
    const PACK: OrderStatus[] = ['ACCEPTED', 'PICKING', 'PACKED'];
    let priyaFar = 'a-home';
    let nehaHome = '';
    try {
      await ep(day(3, 8, 10), 5, async () => {
        await as(PRIYA);
        priyaFar = (await this.saveAddress({ label: 'Office', line1: '14, Raja Park, near Gol Market', pincode: '302004', location: { lat: 26.8936, lng: 75.8268 } })).id;
        await as(NEHA, 'Neha Gupta');
        nehaHome = (await this.saveAddress({ label: 'Home', line1: 'B-22, Malviya Nagar, Sector 3', pincode: '302017', location: { lat: 26.8545, lng: 75.8139 } })).id;
        this.st.profiles[this.me().uid]!.displayName ??= 'Neha Gupta';
        await as(VIKRAM);
        await this.setRiderShift(true, { lat: 26.9205, lng: 75.8251 });
      });
      await ep(day(3, 10, 15), 12, async () => {
        await as(SALES);
        await this.commitSale({ storeId: 'S1', channel: 'POS_WALKIN', items: [{ productId: 'kapur-50', qty: 2 }, { productId: 'dhoop-20', qty: 3 }], payment: { method: 'CASH' } });
        await pause();
        await this.commitSale({ storeId: 'S1', channel: 'POS_WALKIN', items: [{ productId: 'gond-250', qty: 1 }, { productId: 'kamarkas-100', qty: 1 }, { productId: 'panjiri-500', qty: 1 }], payment: { method: 'UPI_QR', providerRef: 'UPI-DEMO-1182' } });
      });
      await ep(day(3, 12, 30), 48, async () => {
        await as(PRIYA);
        const o = await this.placeOrder({ addressId: priyaFar, storeId: 'S1', items: [{ productId: 'gond-250', qty: 2 }, { productId: 'kamarkas-100', qty: 1 }], paymentMethod: 'COD' });
        await as(SUNITA);
        await this.advanceOrder(o.orderId, 'ACCEPTED');
        await this.assignRider(o.orderId, RIDER);
        await go(o.orderId, ['PICKING', 'PACKED']);
        await as(VIKRAM);
        await go(o.orderId, ['HANDED_TO_RIDER', 'OUT_FOR_DELIVERY', 'DELIVERED']);
        await as(OWNER);
        await this.receiveCodCash('S1', RIDER, o.grandTotal);
      });
      await ep(day(2, 11, 5), 52, async () => {
        await as(NEHA);
        const o = await this.placeOrder({ addressId: nehaHome, storeId: 'S2', items: [{ productId: 'atta-5kg', qty: 1 }, { productId: 'kaju-500', qty: 1 }], paymentMethod: 'UPI_INTENT', simulateOutcome: 'success' });
        await as(OWNER);
        await go(o.orderId, [...PACK, 'OUT_FOR_DELIVERY', 'DELIVERED']);
      });
      await ep(day(2, 16, 40), 6, async () => {
        await as(SALES);
        const f = '08AABCR5521K1Z';
        await this.commitSale({ storeId: 'S1', channel: 'POS_WALKIN', items: [{ productId: 'kaju-500', qty: 2 }, { productId: 'kishmish-250', qty: 4 }, { productId: 'thali-set', qty: 1 }], payment: { method: 'UPI_QR', providerRef: 'UPI-DEMO-1190' }, buyer: { name: 'Hotel Raj Vilas Caterers', gstin: f + gstinCheckChar(f), address: 'MI Road, Jaipur 302001' } });
      });
      await ep(day(1, 10, 20), 12, async () => {
        await as(PRIYA);
        await this.topUpWallet(100_000, 'success');
        const o = await this.placeOrder({ addressId: 'a-home', storeId: 'S1', items: [{ productId: 'mehndi-12', qty: 1 }, { productId: 'haldi-kit', qty: 1 }], paymentMethod: 'WALLET' });
        await pause();
        await this.cancelMyOrder(o.orderId, 'Ordered by mistake');
      });
      await ep(day(1, 18, 10), 42, async () => {
        await as(NEHA);
        const o = await this.placeOrder({ addressId: nehaHome, storeId: 'S2', items: [{ productId: 'haldi-kit', qty: 1 }, { productId: 'kapur-50', qty: 2 }], paymentMethod: 'COD' });
        await as(OWNER);
        await go(o.orderId, [...PACK, 'OUT_FOR_DELIVERY', 'DELIVERED']);
      });
      await ep(day(1, 20, 30), 2, async () => {
        await as(OWNER);
        await this.payRider(RIDER, 3000, 'UPI', 'UPI-PAY-2611');
      });
      await ep(today(8, 30, 150), 25, async () => {
        await as(SALES);
        await this.commitSale({ storeId: 'S1', channel: 'POS_WALKIN', items: [{ productId: 'atta-5kg', qty: 2 }, { productId: 'namak-1kg', qty: 2 }, { productId: 'sarson-1l', qty: 1 }], payment: { method: 'CASH' } });
        await pause();
        await this.commitSale({ storeId: 'S1', channel: 'POS_WALKIN', items: [{ productId: 'chai-250', qty: 1 }, { productId: 'kishmish-250', qty: 1 }], payment: { method: 'CARD', providerRef: 'CARD-DEMO-77' } });
      });
      await ep(today(9, 20, 110), 38, async () => {
        await as(PRIYA);
        const o = await this.placeOrder({ addressId: priyaFar, storeId: 'S1', items: [{ productId: 'badam-500', qty: 1 }, { productId: 'chai-250', qty: 1 }], paymentMethod: 'UPI_INTENT', simulateOutcome: 'success' });
        await as(SUNITA);
        await this.advanceOrder(o.orderId, 'ACCEPTED');
        await this.assignRider(o.orderId, RIDER);
        await go(o.orderId, ['PICKING', 'PACKED']);
        await as(VIKRAM);
        await go(o.orderId, ['HANDED_TO_RIDER', 'OUT_FOR_DELIVERY', 'DELIVERED']);
      });
      await ep(today(8, 5, 170), 4, async () => {
        await as(SUNITA);
        await this.submitHygieneCheck({ storeId: 'S1', kind: 'HYGIENE_DAILY', answers: HYGIENE_QUESTIONS.HYGIENE_DAILY.map((q) => ({ question: q, ok: true })), temperatureC: null });
        await as(PRIYA);
        const first = this.st.orders.find((x) => x.customerName === 'Priya Sharma' && x.status === 'DELIVERED');
        await this.createSupportTicket({ category: 'DAMAGED_ITEM', subject: 'One gond packet seal was loose', orderId: first?.orderId ?? null, storeId: 'S1', transcript: [{ from: 'user', text: 'Gond ka ek packet ki seal khuli thi', at: Date.now() }, { from: 'bot', text: 'Sorry! Main isko store team ko bhej raha hoon.', at: Date.now() }] });
      });
      await ep(ago(14), 8, async () => {
        await as(PRIYA);
        const o = await this.placeOrder({ addressId: priyaFar, storeId: 'S1', items: [{ productId: 'kaju-500', qty: 1 }, { productId: 'kishmish-250', qty: 2 }], paymentMethod: 'COD' });
        await as(SUNITA);
        await this.advanceOrder(o.orderId, 'ACCEPTED');
        await this.assignRider(o.orderId, RIDER);
        await go(o.orderId, ['PICKING', 'PACKED']);
        await as(VIKRAM);
        await go(o.orderId, ['HANDED_TO_RIDER', 'OUT_FOR_DELIVERY']);
      });
      await ep(ago(8), 5, async () => {
        await as(NEHA);
        const o = await this.placeOrder({ addressId: nehaHome, storeId: 'S2', items: [{ productId: 'gond-250', qty: 1 }, { productId: 'namak-1kg', qty: 1 }], paymentMethod: 'UPI_INTENT', simulateOutcome: 'success' });
        await as(OWNER);
        await go(o.orderId, PACK);
      });
      await ep(ago(3), 0, async () => {
        await as(PRIYA);
        await this.placeOrder({ addressId: 'a-home', storeId: 'S1', items: [{ productId: 'thali-set', qty: 1 }, { productId: 'dhoop-20', qty: 2 }], paymentMethod: 'UPI_INTENT', simulateOutcome: 'success' });
      });
      // Spread each step's real (millisecond) time over its episode's minutes, set in the past.
      const shift = (v: number) => {
        for (const w of windows) if (v >= w.start && v <= w.end) return Math.round(w.target + (w.end > w.start ? ((v - w.start) * w.span) / (w.end - w.start) : 0));
        return v;
      };
      const walk = (o: unknown): void => {
        if (Array.isArray(o)) o.forEach(walk);
        else if (o && typeof o === 'object')
          for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
            if (typeof v === 'number' && (k === 'at' || k.endsWith('Ms'))) (o as Record<string, unknown>)[k] = shift(v);
            else if (v && typeof v === 'object') walk(v);
          }
      };
      walk(this.st);
    } finally {
      this.staff = keep.staff;
      this.ls = keep.ls;
      this.staffL = keep.listeners;
      this.save();
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
    return this.st.stores.filter((s) => u.role === 'super_admin' || u.role === 'compliance' || (u.vendorId === s.vendorId && (u.role === 'seller' ? !(u.storeIds?.length) || u.storeIds.includes(s.storeId) : u.storeIds?.includes(s.storeId))));
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
    if (p.complianceStatus === 'RECALLED') throw new DataError('This product is under recall — it cannot be re-approved here');
    if (decision === 'REJECTED' && (!note || note.trim().length < 3)) throw new DataError('Tell the shop what to fix');
    const before = p.complianceStatus;
    p.complianceStatus = decision;
    p.complianceNote = note?.trim() || null;
    p.isPublished = decision === 'APPROVED';
    this.audit(u, 'product.review', 'products', productId, { complianceStatus: before }, { complianceStatus: decision, note: p.complianceNote });
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
    if (!this.operates(u, storeId) && u.role !== 'super_admin' && u.role !== 'compliance') throw new DataError('You do not operate this store', 'PERMISSION_DENIED');
    return Object.values(this.st.inv).filter((r) => r.storeId === storeId).map((r) => this.row(r)).sort((a, b) => a.product.name.localeCompare(b.product.name));
  }
  async listBatches(storeId: string, productId: string) {
    const u = this.me();
    if (!this.operates(u, storeId) && u.role !== 'super_admin' && u.role !== 'compliance') throw new DataError('You do not operate this store', 'PERMISSION_DENIED');
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
    if (!this.operates(u, storeId) && u.role !== 'super_admin' && u.role !== 'compliance') throw new DataError('You do not operate this store', 'PERMISSION_DENIED');
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
  private geo = new LocalGeoProvider({ maxDistanceMeters: JAIPUR_MAX_DELIVERY_METERS });
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
    const r = this.geo.checkServiceability(p, this.st.zones, this.st.stores.map((s) => ({ storeId: s.storeId, name: s.name, location: s.location, isActive: s.isActive, acceptsOnline: s.acceptsOnline })));
    const zone = r.zone ? this.st.zones.find((z) => z.zoneId === r.zone!.zoneId)! : null;
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
      riderUid: o.riderUid ?? null,
      riderName: o.riderUid ? this.st.riders[o.riderUid]?.name ?? null : null,
      riderPhone: o.riderUid && live ? this.st.riders[o.riderUid]?.phone ?? null : null,
      hasPod: !!o.podAtMs,
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
    if (this.operates(u, o.storeId) || u.role === 'super_admin' || u.role === 'compliance' || (u.role === 'rider' && o.riderUid === u.uid)) return this.orderRow(o, false);
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
    this.releaseRider(o);
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
    const asRider = u.role === 'rider';
    if (asRider) {
      try {
        checkRiderStep(u.uid, { riderUid: o.riderUid ?? null, status: o.status }, to);
      } catch (e) {
        wrap(e);
      }
    } else {
      if (!this.operates(u, o.storeId)) throw new DataError('You do not operate this store', 'PERMISSION_DENIED');
      if (!canTransition(o.status, to)) throw new DataError(`Cannot move an order from ${o.status} to ${to}`, 'BAD_TRANSITION');
      if (o.riderUid && riderHasPicked(o.status)) throw new DataError('The rider has this order — they update it from the rider app', 'RIDER_HAS_ORDER');
      if (to === 'HANDED_TO_RIDER' && !o.riderUid) throw new DataError('Assign a rider first', 'NO_RIDER');
      if (to === 'OUT_FOR_DELIVERY' && o.riderUid) throw new DataError('A rider is assigned — hand the bag to the rider instead', 'RIDER_ASSIGNED');
    }
    if (to === 'CANCELLED' || to === 'REJECTED') {
      if (!operatorCanCancel(o.status)) throw new DataError('Too late to cancel');
      const reason = opts.reason?.trim();
      if (!reason || reason.length < 3) throw new DataError('Write a short reason for the customer');
      this.closeAsCancelled(o, to, reason, u.uid);
      this.releaseRider(o);
      this.audit(u, `order.${to.toLowerCase()}`, 'orders', o.orderId, null, { reason });
      this.save();
      return { status: o.status, invoiceNo: null };
    }
    if (isDispatch(to)) {
      const held = recalledInOrder(o.lines, this.recalledBatchIds(o.storeId));
      if (held.length) throw new DataError(`Recalled stock in this order (${held.join(', ')}). Cancel it and ask the customer to order again.`, 'RECALLED_STOCK');
    }
    if (to === 'DELIVERED') {
      if (!opts.otp || (await hashDeliveryOtp(o.orderId, opts.otp)) !== o.otpHash) throw new DataError('Wrong delivery code — ask the customer for the 4-digit code', 'BAD_OTP');
      const rider = o.riderUid ? this.st.riders[o.riderUid] : undefined;
      if (rider) {
        const plan = planRiderDelivered(rider, { orderId: o.orderId, paymentMethod: o.payment.method, paymentStatus: o.payment.status, grandTotal: o.computation.totals.grandTotal });
        rider.activeOrderIds = plan.activeOrderIds;
        rider.earningsBalance += plan.earning;
        if (plan.cashCollected > 0) {
          rider.codCashInHand = plan.codCashInHand;
          this.st.riderCash.unshift({ id: this.id('rc-'), riderUid: rider.uid, storeId: o.storeId, kind: 'COLLECT', amount: plan.cashCollected, balanceAfter: rider.codCashInHand, orderId: o.orderId, confirmedBy: null, atMs: Date.now() });
        }
      }
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
    if (isDispatch(to) || to === 'DELIVERED') this.audit(u, `order.${to.toLowerCase()}`, 'orders', o.orderId, null, { invoiceNo: o.invoiceNo });
    this.save();
    return { status: o.status, invoiceNo: o.invoiceNo };
  }

  private recalledBatchIds(storeId: string): Set<string> {
    const out = new Set<string>();
    for (const [key, list] of Object.entries(this.st.batches)) if (key.startsWith(`${storeId}_`)) for (const b of list) if (b.recalled) out.add(b.batchId);
    return out;
  }
  private releaseRider(o: OrderRec) {
    const r = o.riderUid ? this.st.riders[o.riderUid] : undefined;
    if (r) r.activeOrderIds = r.activeOrderIds.filter((x) => x !== o.orderId);
  }

  async demoAdvanceOrder(orderId: string) {
    const me = this.me();
    const o = this.st.orders.find((x) => x.orderId === orderId);
    if (!o || o.customerUid !== me.uid) throw new DataError('Order not found');
    const to = o.riderUid && o.status === 'PACKED' ? 'HANDED_TO_RIDER' : nextForwardStatus(o.status);
    if (!to) throw new DataError('This order is already finished');
    const riderTurn = o.riderUid && (o.status === 'PACKED' || riderHasPicked(o.status));
    const owner = riderTurn
      ? Object.values(this.st.users).find((u) => u.uid === o.riderUid)
      : Object.values(this.st.users).find((u) => u.role === 'seller' && u.vendorId === this.store(o.storeId).vendorId);
    if (!owner) throw new DataError('No shop owner in the demo data');
    const prev = this.staff;
    this.staff = owner; // act as the shop (or its rider) for one step, then switch back (demo only)
    try {
      return await this.advanceOrder(orderId, to, { otp: o.otp });
    } finally {
      this.staff = prev;
    }
  }

  /* -------------------------------------------------- Phase 4 · helpers */
  private audit(actor: AppUser | null, action: string, collection: string, id: string, before: unknown, after: unknown) {
    this.st.audit.unshift({ id: this.id('au-'), actorUid: actor?.uid ?? 'system', actorRole: actor?.role ?? 'system', action, target: { collection, id }, before: before == null ? null : JSON.stringify(before), after: after == null ? null : JSON.stringify(after), atMs: Date.now() });
    if (this.st.audit.length > 1000) this.st.audit.length = 1000;
  }
  private requireRole(...roles: AppUser['role'][]) {
    const u = this.me();
    if (!roles.includes(u.role)) throw new DataError('You do not have access to this', 'PERMISSION_DENIED');
    return u;
  }
  private userRow(u: AppUser): UserRow {
    return { uid: u.uid, phone: u.phone, displayName: u.displayName, role: u.role === 'anonymous' ? 'customer' : u.role, vendorId: u.vendorId ?? null, storeIds: [...(u.storeIds ?? [])], homeStoreId: this.st.riders[u.uid]?.homeStoreId ?? null };
  }
  private riderRow(r: RiderRec): RiderProfile {
    const { vendorId: _v, lastLocation: _l, ...rest } = r;
    return { ...rest, activeOrderIds: [...r.activeOrderIds] };
  }
  private ensureRider(u: AppUser, homeStoreId: string | null = null): RiderRec {
    return (this.st.riders[u.uid] ??= { uid: u.uid, name: u.displayName ?? 'Rider', phone: u.phone ?? '', vehicleType: 'SCOOTER', vehicleNumber: null, kycStatus: 'PENDING', isOnline: false, homeStoreId, vendorId: DEMO_VENDOR.vendorId, codCashInHand: 0, earningsBalance: 0, activeOrderIds: [], lastSeenMs: null, lastLocation: null });
  }
  private kycRow(k: KycRec): KycDocRow {
    const { dataUrl: _d, ...row } = k;
    return { ...row };
  }
  private rollupOwner(ownerUid: string, ownerType: 'VENDOR' | 'RIDER', vendorId: string | null): KycStatus {
    const docs = this.st.kyc.filter((k) => (ownerType === 'RIDER' ? k.ownerUid === ownerUid && k.ownerType === 'RIDER' : k.ownerType === 'VENDOR' && k.vendorId === vendorId));
    const status = rollupKyc(docs, ownerType === 'RIDER' ? RIDER_KYC_DOCS : VENDOR_KYC_DOCS);
    if (ownerType === 'RIDER') {
      const r = this.st.riders[ownerUid];
      if (r) {
        r.kycStatus = status;
        if (status !== 'VERIFIED') r.isOnline = false;
      }
    } else if (vendorId) this.st.vendorKyc[vendorId] = status;
    return status;
  }

  /* -------------------------------------------------- Phase 4 · super admin */
  async listUsers() {
    this.requireRole('super_admin');
    return Object.values(this.st.users).map((u) => this.userRow(u)).sort((a, b) => a.role.localeCompare(b.role) || (a.displayName ?? '').localeCompare(b.displayName ?? ''));
  }
  async setUserRole(i: RoleInput) {
    const me = this.requireRole('super_admin');
    if (!(ASSIGNABLE_ROLES as readonly string[]).includes(i.role)) throw new DataError(`Role "${i.role}" cannot be assigned`);
    let target = i.uid ? Object.values(this.st.users).find((u) => u.uid === i.uid) : undefined;
    if (!target && i.phone) {
      const phone = i.phone.replace(/\s+/g, '');
      if (!/^\+91[6-9]\d{9}$/.test(phone)) throw new DataError('Enter a valid Indian mobile number');
      target = this.st.users[phone] ??= { uid: `u-${phone.slice(-4)}${randomId(2)}`, phone, displayName: i.displayName?.trim() || null, role: 'customer', isAnonymous: false };
    }
    if (!target) throw new DataError('User not found — enter their mobile number', 'NOT_FOUND');
    const before = this.userRow(target);
    if (target.role === 'super_admin' && i.role !== 'super_admin') {
      if (target.uid === me.uid) throw new DataError('You cannot remove your own super admin role');
      if (Object.values(this.st.users).filter((u) => u.role === 'super_admin').length <= 1) throw new DataError('At least one super admin must remain');
    }
    let vendorId: string | undefined;
    let storeIds: string[] | undefined;
    if (i.role === 'seller' || i.role === 'staff') {
      vendorId = i.vendorId || DEMO_VENDOR.vendorId;
      if (vendorId !== DEMO_VENDOR.vendorId) throw new DataError(`Vendor ${vendorId} does not exist`);
      storeIds = [...new Set(i.storeIds ?? [])];
      if (storeIds.length > MAX_STAFF_STORES) throw new DataError(`At most ${MAX_STAFF_STORES} stores per user`);
      if (i.role === 'staff' && !storeIds.length) throw new DataError('Pick at least one store for staff');
      for (const sid of storeIds) if (this.store(sid).vendorId !== vendorId) throw new DataError(`Store ${sid} belongs to another business`);
    } else if (i.storeIds?.length) throw new DataError('Stores apply only to the shop owner and staff');
    let homeStoreId: string | null = null;
    if (i.role === 'rider') {
      homeStoreId = i.homeStoreId || null;
      if (!homeStoreId) throw new DataError('Pick the store this rider collects orders from');
      if (!this.store(homeStoreId).acceptsOnline) throw new DataError('Riders work from a store that delivers');
    } else if (i.homeStoreId) throw new DataError('A home store applies only to riders');
    const r = this.st.riders[target.uid];
    if (r && r.activeOrderIds.length && (i.role !== 'rider' || r.homeStoreId !== homeStoreId)) throw new DataError('This rider is carrying orders — let them finish first');
    if (r && r.codCashInHand > 0 && i.role !== 'rider') throw new DataError('This rider still holds cash — the store must receive it first');
    Object.assign(target, { role: i.role, vendorId, storeIds });
    if (i.displayName?.trim()) target.displayName = i.displayName.trim().slice(0, 60);
    if (i.role === 'rider') {
      const rec = this.ensureRider(target, homeStoreId);
      rec.homeStoreId = homeStoreId;
      rec.name = target.displayName ?? rec.name;
    } else if (r) r.isOnline = false;
    const after = this.userRow(target);
    this.audit(me, 'role.set', 'auth_users', target.uid, before, after);
    this.save();
    return after;
  }
  async listZones() {
    return this.st.zones.map((z) => ({ ...z, storeIds: [...z.storeIds] }));
  }
  async saveZone(i: ZoneInput) {
    const me = this.requireRole('super_admin');
    let z;
    try {
      z = validateZone(i, this.st.stores.filter((s) => s.acceptsOnline && s.isActive).map((s) => s.storeId));
    } catch (e) {
      wrap(e);
    }
    const zoneId = i.zoneId ?? `Z${this.st.zones.length + 1}${randomId(2)}`;
    const row: ZoneRow = { zoneId, name: z.name, geometryJson: z.geometryJson, storeIds: z.storeIds, baseDeliveryFee: z.baseDeliveryFee, freeDeliveryAbove: z.freeDeliveryAbove, surgeMultiplierBps: z.surgeMultiplierBps, isActive: z.isActive };
    const idx = this.st.zones.findIndex((x) => x.zoneId === zoneId);
    const before = idx >= 0 ? { ...this.st.zones[idx]!, geometryJson: undefined } : null;
    if (idx >= 0) this.st.zones[idx] = row;
    else this.st.zones.push(row);
    this.audit(me, idx >= 0 ? 'zones.update' : 'zones.create', 'zones', zoneId, before, { ...row, geometryJson: undefined });
    this.save();
    return { ...row };
  }
  async upsertHsn(i: HsnInput) {
    const me = this.requireRole('super_admin');
    let h;
    try {
      h = validateHsn(i);
    } catch (e) {
      wrap(e);
    }
    const idx = this.st.hsn.findIndex((x) => x.hsnCode === h.hsnCode);
    const before = idx >= 0 ? { ...this.st.hsn[idx]! } : null;
    if (idx >= 0) this.st.hsn[idx] = h;
    else this.st.hsn.push(h);
    this.st.hsn.sort((a, b) => a.hsnCode.localeCompare(b.hsnCode));
    const changes = productsAffectedByHsn(Object.values(this.st.products), this.st.hsn);
    for (const c of changes) this.st.products[c.productId]!.gstSlab = c.to;
    this.audit(me, idx >= 0 ? 'hsn_master.update' : 'hsn_master.create', 'hsn_master', h.hsnCode, before, { ...h, productsUpdated: changes.length });
    this.save();
    return { productsUpdated: changes.length };
  }
  async listAudit(opts: { max?: number; actionPrefix?: string } = {}) {
    this.requireRole('super_admin', 'compliance');
    return this.st.audit.filter((a) => !opts.actionPrefix || a.action.startsWith(opts.actionPrefix)).slice(0, opts.max ?? 200).map((a) => ({ ...a, target: { ...a.target } }));
  }
  async listAllProducts() {
    this.requireRole('super_admin', 'compliance');
    return Object.values(this.st.products).map((p) => ({ ...p })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /* -------------------------------------------------- Phase 4 · staff picker */
  async pickTask(orderId: string): Promise<PickTask> {
    const u = this.me();
    const o = this.st.orders.find((x) => x.orderId === orderId);
    if (!o || !this.operates(u, o.storeId)) throw new DataError('Order not found');
    const shelf = Object.fromEntries(
      o.lines.map((l) => {
        const id = inventoryDocId(o.storeId, l.productId);
        return [l.productId, { aisleBinCode: this.st.inv[id]?.aisleBinCode ?? '', barcode: this.st.products[l.productId]?.barcode ?? null, batches: this.st.batches[id] ?? [] }];
      }),
    );
    return { order: this.orderRow(o, false), lines: buildPickList(o.lines, shelf) };
  }

  /* -------------------------------------------------- Phase 4 · rider */
  private rider(): { u: AppUser; r: RiderRec } {
    const u = this.requireRole('rider');
    return { u, r: this.ensureRider(u) };
  }
  async myRider() {
    const { r } = this.rider();
    this.save();
    return this.riderRow(r);
  }
  async saveRiderProfile(patch: { name: string; vehicleType: RiderVehicle; vehicleNumber: string | null }) {
    const { u, r } = this.rider();
    const name = patch.name?.trim().slice(0, 60);
    if (!name || name.length < 2) throw new DataError('Enter your name');
    if (!(RIDER_VEHICLES as readonly string[]).includes(patch.vehicleType)) throw new DataError('Choose your vehicle');
    const no = normaliseVehicleNo(patch.vehicleNumber);
    if (patch.vehicleType !== 'BICYCLE' && !no) throw new DataError('Enter the vehicle number as on the RC, e.g. RJ14 CK 4821');
    Object.assign(r, { name, vehicleType: patch.vehicleType, vehicleNumber: patch.vehicleType === 'BICYCLE' ? null : no });
    u.displayName = name;
    this.save();
  }
  async setRiderShift(online: boolean, location?: { lat: number; lng: number } | null) {
    const { r } = this.rider();
    if (online && r.kycStatus !== 'VERIFIED') throw new DataError('Your documents must be verified before you can go on shift', 'KYC_NOT_VERIFIED');
    if (!online && r.activeOrderIds.length) throw new DataError('Finish your deliveries before going off shift', 'HAS_ORDERS');
    r.isOnline = online;
    r.lastSeenMs = Date.now();
    if (location) r.lastLocation = location;
    this.save();
  }
  async myKycDocs() {
    const u = this.requireRole('rider', 'seller');
    return this.st.kyc.filter((k) => (u.role === 'rider' ? k.ownerUid === u.uid && k.ownerType === 'RIDER' : k.ownerType === 'VENDOR' && k.vendorId === u.vendorId)).sort((a, b) => b.createdMs - a.createdMs).map((k) => this.kycRow(k));
  }
  async uploadKyc(i: KycUploadInput) {
    const u = this.requireRole('rider', 'seller');
    const ownerType = u.role === 'rider' ? 'RIDER' : 'VENDOR';
    const allowed = ownerType === 'RIDER' ? RIDER_KYC_DOCS : VENDOR_KYC_DOCS;
    if (!allowed.includes(i.docType)) throw new DataError('This document is not needed for your account');
    if (i.docType === 'AADHAAR_MASKED' && !i.maskedConfirmed) throw new DataError('Upload a masked Aadhaar (only the last 4 digits visible) and tick the box to confirm');
    if (!i.file || i.file.size === 0) throw new DataError('Choose a photo or PDF');
    if (i.file.size > 10 * 1024 * 1024) throw new DataError('File must be under 10 MB');
    if (i.file.type && !/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(i.file.type)) throw new DataError('Upload a JPG, PNG, WEBP photo or a PDF');
    const vendorId = ownerType === 'VENDOR' ? u.vendorId ?? null : null;
    if (ownerType === 'RIDER') this.ensureRider(u);
    const rec: KycRec = {
      id: this.id('k-'),
      ownerUid: u.uid,
      ownerType,
      ownerName: ownerType === 'RIDER' ? this.st.riders[u.uid]?.name ?? u.displayName : DEMO_VENDOR.tradeName,
      vendorId,
      docType: i.docType,
      fileName: i.fileName.slice(0, 100),
      status: 'PENDING',
      reviewNote: null,
      // strictly increasing, so "newest upload wins" holds even for uploads in the same millisecond
      createdMs: Math.max(Date.now(), ...this.st.kyc.filter((k) => k.ownerUid === u.uid).map((k) => k.createdMs + 1)),
      reviewedMs: null,
      // demo keeps small files so compliance can view them; large ones keep only the name
      dataUrl: i.preview && i.preview.length <= 480 * 1024 ? i.preview : i.file.size <= 350 * 1024 ? await blobToDataUrl(i.file).catch(() => null) : null,
    };
    this.st.kyc.unshift(rec);
    // keep localStorage small: only the latest 12 files keep their content
    this.st.kyc.filter((k) => k.dataUrl).slice(12).forEach((k) => (k.dataUrl = null));
    this.rollupOwner(u.uid, ownerType, vendorId);
    this.save();
    return this.kycRow(rec);
  }
  async riderOrders() {
    const { u } = this.rider();
    const dayAgo = Date.now() - 86_400_000;
    return this.st.orders.filter((o) => o.riderUid === u.uid && (!['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status) || o.placedMs > dayAgo)).map((o) => this.orderRow(o, false));
  }
  async riderCash(riderUid?: string) {
    const u = this.me();
    const uid = riderUid ?? u.uid;
    const r = this.st.riders[uid];
    const ok = u.uid === uid || u.role === 'super_admin' || (r && (r.homeStoreId ? this.operates(u, r.homeStoreId) : u.vendorId === r.vendorId && (u.role === 'seller' || u.role === 'staff')));
    if (!ok) throw new DataError('Not allowed', 'PERMISSION_DENIED');
    return this.st.riderCash.filter((x) => x.riderUid === uid).map((x) => ({ ...x }));
  }

  /* -------------------------------------------------- Phase 4 · operator ↔ riders */
  async listStoreRiders(storeId: string) {
    const u = this.me();
    if (!this.operates(u, storeId) && u.role !== 'super_admin') throw new DataError('You do not operate this store', 'PERMISSION_DENIED');
    const vendorId = this.store(storeId).vendorId;
    return Object.values(this.st.riders)
      .filter((r) => r.vendorId === vendorId && r.homeStoreId === storeId && Object.values(this.st.users).some((x) => x.uid === r.uid && x.role === 'rider'))
      .map((r) => this.riderRow(r))
      .sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || a.name.localeCompare(b.name));
  }
  async assignRider(orderId: string, riderUid: string | null) {
    const u = this.me();
    const o = this.st.orders.find((x) => x.orderId === orderId);
    if (!o) throw new DataError('Order not found');
    if (!this.operates(u, o.storeId)) throw new DataError('You do not operate this store', 'PERMISSION_DENIED');
    if (!ASSIGNABLE_STATUSES.includes(o.status)) throw new DataError('A rider can be assigned only after you accept the order and before it leaves the store', 'BAD_STATUS');
    const prev = o.riderUid ?? null;
    if (riderUid) {
      const r = this.st.riders[riderUid];
      if (!r || !Object.values(this.st.users).some((x) => x.uid === riderUid && x.role === 'rider')) throw new DataError('Rider not found');
      try {
        checkAssignRider(r, { orderId: o.orderId, storeId: o.storeId, status: o.status, paymentMethod: o.payment.method, paymentStatus: o.payment.status, grandTotal: o.computation.totals.grandTotal, riderUid: prev });
      } catch (e) {
        wrap(e);
      }
      this.releaseRider(o);
      if (!r.activeOrderIds.includes(o.orderId)) r.activeOrderIds.push(o.orderId);
    } else this.releaseRider(o);
    o.riderUid = riderUid;
    this.audit(u, riderUid ? 'order.assign_rider' : 'order.unassign_rider', 'orders', o.orderId, { riderUid: prev }, { riderUid });
    this.save();
  }
  async receiveCodCash(storeId: string, riderUid: string, amount: number) {
    const u = this.me();
    if (!this.operates(u, storeId)) throw new DataError('You do not operate this store', 'PERMISSION_DENIED');
    const r = this.st.riders[riderUid];
    if (!r || r.vendorId !== this.store(storeId).vendorId || (r.homeStoreId && r.homeStoreId !== storeId)) throw new DataError('This rider does not work from this store');
    let plan;
    try {
      plan = planCodDeposit(r.codCashInHand, amount);
    } catch (e) {
      wrap(e);
    }
    r.codCashInHand = plan.codCashInHand;
    this.st.riderCash.unshift({ id: this.id('rc-'), riderUid, storeId, kind: 'DEPOSIT', amount: -amount, balanceAfter: r.codCashInHand, orderId: null, confirmedBy: u.uid, atMs: Date.now() });
    this.audit(u, 'rider.cod_deposit', 'riders', riderUid, null, { amount, storeId, balanceAfter: r.codCashInHand });
    this.save();
    return { codCashInHand: r.codCashInHand };
  }

  /* -------------------------------------------------- Phase 4 extras · payouts */
  private canManageRider(u: AppUser, r: RiderRec) {
    return u.role === 'super_admin' || (u.role === 'seller' && u.vendorId === r.vendorId);
  }
  async payRider(riderUid: string, amount: number, method: PayoutMethod, reference: string) {
    const u = this.me();
    const r = this.st.riders[riderUid];
    if (!r) throw new DataError('Rider not found');
    if (!this.canManageRider(u, r)) throw new DataError('Only the shop owner or admin pays riders', 'PERMISSION_DENIED');
    let plan;
    try {
      plan = planPayout(r.earningsBalance, amount, method, reference);
    } catch (e) {
      wrap(e);
    }
    r.earningsBalance = plan.earningsBalance;
    this.st.payouts.unshift({ id: this.id('po-'), riderUid, riderName: r.name, vendorId: r.vendorId, amount, method: plan.method, reference: plan.reference, paidBy: u.uid, atMs: Date.now() });
    this.audit(u, 'rider.payout', 'riders', riderUid, null, { amount, method: plan.method, reference: plan.reference, earningsBalance: r.earningsBalance });
    this.save();
    return { earningsBalance: r.earningsBalance };
  }
  async listPayouts(riderUid?: string) {
    const u = this.me();
    return this.st.payouts
      .filter((p) => (u.role === 'rider' ? p.riderUid === u.uid : (u.role === 'super_admin' || (u.role === 'seller' && u.vendorId === p.vendorId)) && (!riderUid || p.riderUid === riderUid)))
      .map(({ vendorId: _v, ...p }) => ({ ...p }));
  }

  /* -------------------------------------------------- Phase 4 extras · proof of delivery */
  private deliveredMs(o: OrderRec) {
    return [...o.statusHistory].reverse().find((h) => h.status === 'DELIVERED')?.at ?? null;
  }
  async attachPod(orderId: string, photo: PhotoInput) {
    const u = this.requireRole('rider');
    const o = this.st.orders.find((x) => x.orderId === orderId);
    if (!o) throw new DataError('Order not found');
    try {
      checkPod(u.uid, { riderUid: o.riderUid ?? null, status: o.status, deliveredMs: this.deliveredMs(o) }, Date.now());
    } catch (e) {
      wrap(e);
    }
    if (!photo.file || photo.file.size === 0) throw new DataError('Take a photo of the bag at the door');
    if (photo.file.size > 5 * 1024 * 1024) throw new DataError('Photo must be under 5 MB');
    if (photo.file.type && !/^image\/(jpeg|png|webp)$/.test(photo.file.type)) throw new DataError('Upload a JPG, PNG or WEBP photo');
    o.podDataUrl = photo.preview && photo.preview.length <= 480 * 1024 ? photo.preview : photo.file.size <= 350 * 1024 ? await blobToDataUrl(photo.file).catch(() => null) : null;
    o.podAtMs = Date.now();
    // keep localStorage small: only the latest 10 delivery photos keep their image
    this.st.orders.filter((x) => x.podDataUrl).sort((a, b) => (b.podAtMs ?? 0) - (a.podAtMs ?? 0)).slice(10).forEach((x) => (x.podDataUrl = null));
    this.audit(u, 'order.pod', 'orders', orderId, null, { fileName: photo.fileName.slice(0, 100) });
    this.save();
  }
  async podUrl(orderId: string) {
    const u = this.me();
    const o = this.st.orders.find((x) => x.orderId === orderId);
    if (!o) throw new DataError('Order not found');
    const ok = o.customerUid === u.uid || o.riderUid === u.uid || this.operates(u, o.storeId) || u.role === 'super_admin' || u.role === 'compliance';
    if (!ok) throw new DataError('Not allowed', 'PERMISSION_DENIED');
    return o.podDataUrl ?? null;
  }

  /* -------------------------------------------------- Phase 4 extras · live tracking */
  async pingRiderLocation(loc: { lat: number; lng: number }) {
    const { r } = this.rider();
    const p = validPing(loc);
    if (!p) throw new DataError('Location not available');
    if (!r.isOnline) return;
    r.lastLocation = p;
    r.lastSeenMs = Date.now();
    this.save();
  }
  async trackRider(orderId: string): Promise<RiderFix | null> {
    const u = this.me();
    const o = this.st.orders.find((x) => x.orderId === orderId);
    if (!o) throw new DataError('Order not found');
    if (o.customerUid !== u.uid && !this.operates(u, o.storeId) && u.role !== 'super_admin') throw new DataError('Not allowed', 'PERMISSION_DENIED');
    if (!o.riderUid || !TRACKABLE.includes(o.status)) return null;
    const r = this.st.riders[o.riderUid];
    if (!r) return null;
    const now = Date.now();
    const dest = o.deliveryAddress.location;
    if (r.lastLocation && r.lastSeenMs && now - r.lastSeenMs < 10 * 60_000 && haversineMeters(r.lastLocation, dest) < 30_000) return trackEstimate({ ...r.lastLocation, atMs: r.lastSeenMs }, dest, now);
    // Demo without a real GPS fix: estimate a position along the way from the store.
    const started = [...o.statusHistory].reverse().find((h) => h.status === 'OUT_FOR_DELIVERY' || h.status === 'HANDED_TO_RIDER')?.at ?? now;
    const pos = o.status === 'HANDED_TO_RIDER' ? this.store(o.storeId).location : simulateRiderPosition(this.store(o.storeId).location, dest, started, now);
    return { ...trackEstimate({ ...pos, atMs: now }, dest, now), simulated: true };
  }

  /* -------------------------------------------------- Phase 4 extras · hygiene checklists */
  private hygieneRow(h: HygieneRec): HygieneRow {
    const { vendorId: _v, ...row } = h;
    const by = Object.values(this.st.users).find((x) => x.uid === h.submittedBy);
    return { ...row, answers: h.answers.map((a) => ({ ...a })), storeName: this.st.stores.find((s) => s.storeId === h.storeId)?.name ?? null, submittedByName: by?.displayName ?? null };
  }
  async submitHygieneCheck(i: HygieneInput) {
    const u = this.me();
    if (!this.operates(u, i.storeId)) throw new DataError('You do not operate this store', 'PERMISSION_DENIED');
    let v;
    try {
      v = validateHygiene(i.kind, i.answers, i.temperatureC);
    } catch (e) {
      wrap(e);
    }
    const rec: HygieneRec = { id: this.id('hc-'), storeId: i.storeId, vendorId: this.store(i.storeId).vendorId, kind: v.kind, answers: v.answers, temperatureC: v.temperatureC, submittedBy: u.uid, submittedMs: Date.now(), flagged: v.flag, reviewStatus: 'PENDING', reviewNote: null };
    this.st.hygiene.unshift(rec);
    if (this.st.hygiene.length > 500) this.st.hygiene.length = 500;
    this.save();
    return this.hygieneRow(rec);
  }
  async listHygieneChecks(opts: { storeId?: string; days?: number; flaggedOnly?: boolean } = {}) {
    const u = this.me();
    const since = Date.now() - (opts.days ?? 30) * 86_400_000;
    return this.st.hygiene
      .filter((h) => (u.role === 'compliance' || u.role === 'super_admin' || this.operates(u, h.storeId)) && (!opts.storeId || h.storeId === opts.storeId) && h.submittedMs >= since && (!opts.flaggedOnly || h.flagged))
      .map((h) => this.hygieneRow(h));
  }
  async reviewHygieneCheck(id: string, status: 'OK' | 'ACTION_REQUIRED', note?: string) {
    const u = this.requireRole('compliance', 'super_admin');
    const h = this.st.hygiene.find((x) => x.id === id);
    if (!h) throw new DataError('Checklist not found');
    if (status === 'ACTION_REQUIRED' && (!note || note.trim().length < 3)) throw new DataError('Tell the store what to fix');
    const before = h.reviewStatus;
    h.reviewStatus = status;
    h.reviewNote = note?.trim().slice(0, 200) || null;
    this.audit(u, 'hygiene.review', 'compliance_checks', id, { reviewStatus: before }, { reviewStatus: status, note: h.reviewNote });
    this.save();
  }

  /* -------------------------------------------------- Phase 4 · compliance */
  async listKycDocs(opts: { status?: KycStatus | 'ALL' } = {}) {
    this.requireRole('compliance', 'super_admin');
    const st = opts.status ?? 'PENDING';
    return this.st.kyc.filter((k) => st === 'ALL' || k.status === st).sort((a, b) => (st === 'PENDING' ? a.createdMs - b.createdMs : b.createdMs - a.createdMs)).map((k) => this.kycRow(k));
  }
  async kycFileUrl(docId: string) {
    const u = this.me();
    const k = this.st.kyc.find((x) => x.id === docId);
    if (!k) throw new DataError('Document not found');
    if (u.role !== 'compliance' && u.role !== 'super_admin' && k.ownerUid !== u.uid) throw new DataError('Not allowed', 'PERMISSION_DENIED');
    return k.dataUrl;
  }
  async reviewKyc(docId: string, decision: 'VERIFIED' | 'REJECTED', note?: string) {
    const u = this.requireRole('compliance', 'super_admin');
    const k = this.st.kyc.find((x) => x.id === docId);
    if (!k) throw new DataError('Document not found');
    if (k.status !== 'PENDING') throw new DataError('This document was already reviewed');
    if (decision === 'REJECTED' && (!note || note.trim().length < 3)) throw new DataError('Write why it was rejected so they can upload again');
    k.status = decision;
    k.reviewNote = note?.trim().slice(0, 200) || null;
    k.reviewedMs = Date.now();
    const ownerStatus = this.rollupOwner(k.ownerUid, k.ownerType, k.vendorId);
    this.audit(u, `kyc.${decision === 'VERIFIED' ? 'verify' : 'reject'}`, 'kyc_documents', k.id, { status: 'PENDING' }, { status: decision, docType: k.docType, owner: k.ownerUid, ownerStatus, note: k.reviewNote });
    this.save();
    return { ownerStatus };
  }
  async listRecalls() {
    const u = this.requireRole('compliance', 'super_admin', 'seller', 'staff');
    return this.st.recalls.filter((r) => u.role === 'compliance' || u.role === 'super_admin' || r.vendorId === u.vendorId).map(({ vendorId: _v, matchedBatchIds: _m, ...r }) => ({ ...r, batchNumbers: [...r.batchNumbers] }));
  }
  async createRecall(i: RecallInput): Promise<RecallResult> {
    const u = this.requireRole('compliance', 'super_admin');
    const p = this.st.products[i.productId];
    if (!p) throw new DataError('Product not found');
    const reason = i.reason?.trim();
    if (!reason || reason.length < 5) throw new DataError('Write the recall reason (what is wrong and who asked for it)');
    const nowMs = Date.now();
    const stores = this.st.stores.filter((s) => s.vendorId === p.vendorId).map((s) => {
      const id = inventoryDocId(s.storeId, p.productId);
      return { storeId: s.storeId, reorderThreshold: this.st.inv[id]?.reorderThreshold ?? 0, batches: this.st.batches[id] ?? [] };
    });
    let plan;
    try {
      plan = planRecall(p.productId, i.batchNumbers, stores, nowMs);
    } catch (e) {
      wrap(e);
    }
    const recallId = this.id('rl-');
    for (const sp of plan.stores) {
      const list = this.st.batches[inventoryDocId(sp.storeId, p.productId)]!;
      for (const w of sp.batchWrites) Object.assign(list.find((b) => b.batchId === w.batchId)!, { qty: 0, recalled: true });
      for (const l of sp.ledger) this.ledger(sp.storeId, p.productId, l, 'RECALL', recallId, reason, u.uid);
    }
    if (plan.wholeProduct) Object.assign(p, { complianceStatus: 'RECALLED', isPublished: false, complianceNote: reason });
    const matched = new Set(plan.matchedBatchIds);
    const sold = this.st.ledger.filter((l) => l.batchId && matched.has(l.batchId) && ['ONLINE_SALE', 'OFFLINE_QR_SALE', 'POS_WALKIN_SALE', 'ORDER_CANCEL_RESTOCK'].includes(l.movement)).reduce((a, l) => a - l.qtyDelta, 0);
    const openOrderIds = this.st.orders.filter((o) => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status) && o.lines.some((l) => l.batchAllocations.some((a) => matched.has(a.batchId)))).map((o) => o.orderId);
    const batchNumbers = plan.wholeProduct ? [] : [...new Set(plan.stores.flatMap((s) => s.batchWrites.map((w) => w.batchNumber.trim().toUpperCase())))];
    this.st.recalls.unshift({ id: recallId, productId: p.productId, productName: p.name, vendorId: p.vendorId, batchNumbers, reason, status: 'ACTIVE', unitsRemoved: plan.unitsRemoved, initiatedBy: u.uid, createdMs: nowMs, completedMs: null, matchedBatchIds: plan.matchedBatchIds });
    this.audit(u, 'recall.create', 'recalls', recallId, null, { productId: p.productId, batchNumbers, unitsRemoved: plan.unitsRemoved, unitsSold: sold, openOrderIds });
    this.save();
    return { recallId, unitsRemoved: plan.unitsRemoved, stores: plan.stores.map((s) => ({ storeId: s.storeId, unitsRemoved: s.unitsRemoved })), unitsSold: Math.round(sold * 1000) / 1000, openOrderIds };
  }
  async completeRecall(recallId: string) {
    const u = this.requireRole('compliance', 'super_admin');
    const r = this.st.recalls.find((x) => x.id === recallId);
    if (!r) throw new DataError('Recall not found');
    if (r.status === 'COMPLETED') return;
    r.status = 'COMPLETED';
    r.completedMs = Date.now();
    this.audit(u, 'recall.complete', 'recalls', recallId, { status: 'ACTIVE' }, { status: 'COMPLETED' });
    this.save();
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
