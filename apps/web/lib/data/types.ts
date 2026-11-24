/**
 * DataClient — everything the web app needs from the backend.
 * Two implementations:
 *   FirebaseDataClient  Firestore + Cloud Functions + edge worker (production)
 *   DemoDataClient      in-browser store using the SAME shared planners (preview / offline dev)
 *
 * Two independent sessions exist side by side: the staff session (seller portal + POS)
 * and the walk-in guest session (store QR storefront).
 */
import type { BatchState, ComplianceStatus, GstSlab, InvoiceComputation, PaymentMethod, Role, StockMovement, StoreType, TaxType, Uqc } from '@pansari/shared';

export interface AppUser {
  uid: string;
  phone: string | null;
  displayName: string | null;
  role: Role | 'anonymous';
  vendorId?: string;
  storeIds?: string[];
  scopedStoreId?: string;
  qrExp?: number;
  isAnonymous: boolean;
}

export interface StoreInfo {
  storeId: string;
  vendorId: string;
  name: string;
  type: StoreType;
  addressLine: string;
  city: string;
  pincode: string;
  stateCode: string;
  upiVpa: string | null;
  acceptsWalkInQr: boolean;
  qrKeyVersion: number;
}

export interface ProductInfo {
  productId: string;
  name: string;
  nameHi: string | null;
  category: string;
  brand: string | null;
  barcode: string | null;
  unit: Uqc;
  netQuantity: string;
  hsnCode: string;
  gstSlab: GstSlab;
  taxType: TaxType;
  mrp: number;
  manufacturerName: string | null;
  countryOfOrigin: string;
  fssaiRequired: boolean;
  complianceStatus: ComplianceStatus;
  complianceNote: string | null;
  isPublished: boolean;
}

export interface InventoryRow {
  storeId: string;
  productId: string;
  product: ProductInfo;
  sellingPrice: number;
  mrp: number;
  onHand: number;
  reorderThreshold: number;
  aisleBinCode: string;
  isListed: boolean;
  lowStock: boolean;
  nearestExpiryMs: number | null;
  nextBatchNumber: string | null;
}

export interface LedgerRow {
  id: string;
  storeId: string;
  productId: string;
  productName: string;
  batchId: string | null;
  movement: StockMovement;
  qtyDelta: number;
  balanceAfter: number;
  refType: string;
  refId: string;
  reason: string | null;
  byUid: string;
  atMs: number;
}

export interface InvoiceRow {
  invoiceId: string;
  invoiceNo: string;
  kind: 'B2B' | 'B2C';
  storeId: string;
  orderId: string;
  issuedMs: number;
  grandTotal: number;
  paymentMethod: PaymentMethod;
  buyer: { name: string | null; gstin: string | null; address: string | null; placeOfSupplyStateCode: string };
  sellerSnapshot: { legalName: string; tradeName: string; gstin: string | null; fssaiLicenseNo: string | null; address: string; stateCode: string };
  computation: InvoiceComputation;
  irn: string | null;
  ackNo: string | null;
}

export interface ProductInput {
  productId?: string;
  name: string;
  nameHi?: string;
  category: string;
  brand?: string;
  barcode?: string;
  unit: Uqc;
  netQuantity: string;
  hsnCode: string;
  taxType: TaxType;
  mrp: number;
  manufacturerName?: string;
  manufacturerAddress?: string;
  countryOfOrigin?: string;
  customerCareDetails?: string;
  fssaiRequired?: boolean;
}

export interface InwardInput {
  storeId: string;
  productId: string;
  batchNumber: string;
  mfgDate: string | null; // YYYY-MM-DD
  expiryDate: string | null;
  qty: number;
  purchasePrice: number;
  mrp: number;
  reference: string;
}

export interface AdjustInput {
  storeId: string;
  productId: string;
  batchId: string;
  movement: 'CUSTOMER_RETURN' | 'DAMAGED_WRITE_OFF' | 'CYCLE_COUNT_ADJUSTMENT';
  qty?: number;
  countedQty?: number;
  reason: string;
}

export interface SaleInput {
  storeId: string;
  channel: 'POS_WALKIN' | 'OFFLINE_QR';
  items?: { productId: string; qty: number }[];
  tempCartId?: string;
  payment: { method: 'CASH' | 'UPI_QR' | 'CARD'; providerRef?: string | null };
  buyer?: { name?: string | null; gstin?: string | null; address?: string | null };
  simulateOutcome?: 'success' | 'fail';
}

export interface SaleResult {
  orderId: string;
  invoiceId: string;
  invoiceNo: string;
  kind: 'B2B' | 'B2C';
  grandTotal: number;
  totalTax: number;
}

export interface GuestCart {
  cartId: string;
  storeId: string;
  items: { productId: string; qty: number }[];
  status: 'OPEN' | 'CHECKOUT_PENDING' | 'CONSUMED' | 'EXPIRED';
  expiresAtMs: number;
  guestUid: string;
}

export interface HsnRow {
  hsnCode: string;
  description: string;
  gstSlab: GstSlab;
}

export interface DataClient {
  readonly mode: 'demo' | 'firebase';

  /* staff session */
  onAuthChange(cb: (u: AppUser | null) => void): () => void;
  sendOtp(phoneE164: string): Promise<{ verificationId: string }>;
  verifyOtp(verificationId: string, code: string): Promise<AppUser>;
  signOut(): Promise<void>;
  demoAccounts?(): { label: string; phone: string; note: string }[];
  resetDemo?(): void;
  /** Firebase only: one-time setup that makes the configured phone the shop owner and loads the sample shop. */
  bootstrap?(): Promise<{ stores: number; products: number }>;
  /** Demo only: a genuine poster link without signing in, for trying the walk-in flow. */
  demoPoster?(storeId: string): Promise<{ url: string; token: string }>;

  /* catalogue + stock (seller / staff) */
  listStores(): Promise<StoreInfo[]>;
  getStore(storeId: string): Promise<StoreInfo | null>;
  listHsn(): Promise<HsnRow[]>;
  listProducts(): Promise<ProductInfo[]>;
  upsertProduct(input: ProductInput): Promise<{ productId: string; gstSlab: number; sentForReview: boolean }>;
  reviewProduct?(productId: string, decision: 'APPROVED' | 'REJECTED', note?: string): Promise<void>;
  listInventory(storeId: string): Promise<InventoryRow[]>;
  listBatches(storeId: string, productId: string): Promise<BatchState[]>;
  setStorePrice(storeId: string, productId: string, sellingPrice: number): Promise<void>;
  updateShelf(storeId: string, productId: string, patch: { aisleBinCode: string; reorderThreshold: number; isListed: boolean }): Promise<void>;
  inwardStock(input: InwardInput): Promise<{ onHand: number; warning: string | null }>;
  adjustStock(input: AdjustInput): Promise<{ onHand: number }>;
  listLedger(storeId: string, max?: number): Promise<LedgerRow[]>;

  /* billing */
  commitSale(input: SaleInput): Promise<SaleResult>;
  listInvoices(opts: { fromMs: number; toMs: number; storeId?: string }): Promise<InvoiceRow[]>;
  invoicePdf(invoiceId: string, format: 'A4' | 'THERMAL_80MM'): Promise<Blob>;
  signStoreQr(storeId: string): Promise<{ url: string; token: string }>;
  redeemCheckout(token: string): Promise<{ cartId: string; storeId: string; guestUid: string }>;
  getCart(cartId: string): Promise<GuestCart | null>;

  /* walk-in guest session */
  onGuestChange(cb: (u: AppUser | null) => void): () => void;
  resolveStoreQr(storeId: string, token: string): Promise<StoreInfo>;
  startGuestSession(storeId: string, token: string, turnstileToken: string): Promise<AppUser>;
  guestInventory(storeId: string): Promise<InventoryRow[]>;
  saveGuestCart(storeId: string, items: { productId: string; qty: number }[], cartId?: string): Promise<GuestCart>;
  createCheckoutToken(cartId: string): Promise<{ token: string; expiresAtMs: number }>;
  guestCommitSale(input: SaleInput): Promise<SaleResult>;
  guestInvoice(invoiceId: string): Promise<InvoiceRow | null>;
  /** Bills issued to the current walk-in session (newest first). */
  guestInvoices(): Promise<InvoiceRow[]>;
  guestInvoicePdf(invoiceId: string): Promise<Blob>;
  sendGuestLinkOtp(phoneE164: string): Promise<{ verificationId: string }>;
  confirmGuestLink(verificationId: string, code: string): Promise<AppUser>;
}

export class DataError extends Error {
  constructor(message: string, readonly code?: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = 'DataError';
  }
}
