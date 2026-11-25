/**
 * Firestore data model — single source of truth for collection names and
 * document shapes. Security rules (firestore.rules) and Cloud Functions are
 * written against these definitions; keep them in sync.
 *
 * Money: integer paise. Times: Firestore Timestamp (typed here as TimestampLike
 * so this package stays free of any Firebase SDK dependency).
 */
import type { Paise } from './money.js';
import type { Role } from './roles.js';

export interface TimestampLike {
  toMillis(): number;
}
type Ts = TimestampLike;

export const COL = {
  users: 'users',
  vendors: 'vendors',
  stores: 'stores',
  zones: 'zones',
  products: 'products',
  hsnMaster: 'hsn_master',
  storeInventory: 'store_inventory',
  /** Subcollection of store_inventory/{invId} */
  batches: 'batches',
  stockLedger: 'stock_ledger',
  tempCarts: 'temp_carts',
  orders: 'orders',
  /** order_secrets/{orderId} — delivery OTP, readable only by the ordering customer. */
  orderSecrets: 'order_secrets',
  /** wallet_txns/{id} — append-only wallet ledger, server-written. */
  walletTxns: 'wallet_txns',
  invoices: 'invoices',
  counters: 'counters',
  riders: 'riders',
  /** rider_cash_ledger/{id} — COD cash collected by riders and handed in at stores. Server-written. */
  riderCash: 'rider_cash_ledger',
  kycDocuments: 'kyc_documents',
  supportTickets: 'support_tickets',
  complianceChecks: 'compliance_checks',
  recalls: 'recalls',
  payouts: 'payouts',
  auditLogs: 'audit_logs',
  platformConfig: 'platform_config',
} as const;

export type CollectionName = (typeof COL)[keyof typeof COL];

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

/** users/{uid} — profile. `roleMirror` is display-only (claims are authoritative). */
export interface UserDoc {
  uid: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  roleMirror: Role;
  addresses: SavedAddress[];
  loyaltyPoints: number;
  walletBalance: Paise; // server-written only
  createdAt: Ts;
  updatedAt: Ts;
}

export interface SavedAddress {
  id: string;
  label: string; // "Home", "Shop"
  line1: string;
  line2?: string;
  city: string;
  pincode: string;
  stateCode: string; // GST state code, drives place of supply
  location: GeoPoint;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

/* ------------------------------------------------------------------ */
/* Business                                                            */
/* ------------------------------------------------------------------ */

export type KycStatus = 'PENDING' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED';

/** vendors/{vendorId} — the legal business that sells. A dedicated single-business
 *  deployment simply has one vendor document. */
export interface VendorDoc {
  vendorId: string;
  legalName: string;
  tradeName: string;
  gstin: string | null;
  pan: string;
  fssaiLicenseNo: string | null;
  stateCode: string;
  registeredAddress: string;
  invoicePrefix: string; // e.g. "PX" → PX/26-27/000001 (max 16 chars total)
  kycStatus: KycStatus;
  commissionBps: number; // platform commission, basis points (server only)
  isActive: boolean;
  createdAt: Ts;
  updatedAt: Ts;
}

export type StoreType = 'DARK_STORE' | 'RETAIL_STORE' | 'WAREHOUSE';

/**
 * stores/{storeId} — a physical location. Public-readable fields only;
 * nothing here may be PII. `qrKeyVersion` is bumped to revoke all printed QRs.
 */
export interface StoreDoc {
  storeId: string;
  vendorId: string;
  name: string;
  type: StoreType;
  addressLine: string;
  city: string;
  pincode: string;
  stateCode: string;
  gstin: string | null; // store-level registration if different from vendor
  fssaiLicenseNo: string | null;
  location: GeoPoint;
  zoneId: string | null;
  upiVpa: string | null;
  openingHours: { open: string; close: string }; // "08:00" / "22:00" local
  acceptsOnline: boolean;
  acceptsWalkInQr: boolean;
  qrKeyVersion: number;
  isActive: boolean;
  createdAt: Ts;
  updatedAt: Ts;
}

/** zones/{zoneId} — serviceable delivery polygon (GeoJSON, [lng, lat] order). */
export interface ZoneDoc {
  zoneId: string;
  name: string;
  /** GeoJSON geometry stored as a JSON string (Firestore cannot store nested arrays). */
  geometryJson: string;
  storeIds: string[];
  baseDeliveryFee: Paise;
  freeDeliveryAbove: Paise;
  surgeMultiplierBps: number; // 10000 = 1.0x
  isActive: boolean;
  updatedAt: Ts;
}

/* ------------------------------------------------------------------ */
/* Catalogue + tax                                                     */
/* ------------------------------------------------------------------ */

export const GST_SLABS = [0, 5, 12, 18, 28] as const;
export type GstSlab = (typeof GST_SLABS)[number];
export type TaxType = 'INCLUSIVE' | 'EXCLUSIVE';

/** Unit Quantity Codes accepted by the e-invoice schema (subset used in kirana). */
export const UQC = ['NOS', 'PCS', 'PAC', 'BOX', 'BTL', 'KGS', 'GMS', 'LTR', 'MLT', 'SET', 'BDL', 'ROL', 'OTH'] as const;
export type Uqc = (typeof UQC)[number];

export type ComplianceStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'RECALLED';

/** hsn_master/{hsnCode} — platform-wide tax master, super-admin maintained. */
export interface HsnMasterDoc {
  hsnCode: string;
  description: string;
  gstSlab: GstSlab;
  cessRate: number; // percent, usually 0
  updatedBy: string;
  updatedAt: Ts;
}

/** products/{productId} — catalogue item. Tax + price fields are server-written only. */
export interface ProductDoc {
  productId: string;
  vendorId: string;
  name: string;
  nameHi?: string;
  category: string; // "preg", "pooja", "shaadi", "dry", "home"
  brand: string | null;
  barcode: string | null; // EAN-13 / internal
  images: string[]; // Storage paths
  unit: Uqc;
  netQuantity: string; // Legal Metrology: "250 g"
  hsnCode: string;
  gstSlab: GstSlab;
  cessRate: number;
  taxType: TaxType;
  mrp: Paise;
  // Legal Metrology (Packaged Commodities) declarations
  manufacturerName: string | null;
  manufacturerAddress: string | null;
  countryOfOrigin: string;
  customerCareDetails: string | null;
  fssaiRequired: boolean;
  isVeg: boolean | null;
  complianceStatus: ComplianceStatus;
  complianceNote: string | null;
  isPublished: boolean;
  searchTokens: string[];
  createdAt: Ts;
  updatedAt: Ts;
}

/* ------------------------------------------------------------------ */
/* Inventory                                                           */
/* ------------------------------------------------------------------ */

/** store_inventory/{storeId}_{productId} — per-store stock + price. */
export interface StoreInventoryDoc {
  storeId: string;
  vendorId: string;
  productId: string;
  productName: string; // denormalised for picking lists
  sellingPrice: Paise; // server-written only
  mrp: Paise; // server-written only
  onHand: number; // server-written only (sum of batch qty)
  reorderThreshold: number;
  aisleBinCode: string; // "A3-R2-B05"
  isListed: boolean;
  lowStock: boolean; // server-maintained flag for alerts/indexes
  nearestExpiry: Ts | null; // server-maintained, drives FEFO + expiry alerts
  /** Batch number that FEFO will sell next — shown to walk-in customers instead of
   *  exposing batch documents (which carry purchase price). */
  nextBatchNumber: string | null;
  updatedAt: Ts;
}

export const inventoryDocId = (storeId: string, productId: string) => `${storeId}_${productId}`;

/** store_inventory/{invId}/batches/{batchId} — FEFO batch. Server-written only. */
export interface BatchDoc {
  batchId: string;
  storeId: string;
  vendorId: string;
  productId: string;
  batchNumber: string;
  mfgDate: Ts | null;
  expiryDate: Ts | null;
  purchasePrice: Paise;
  mrp: Paise;
  qty: number;
  receivedAt: Ts;
  receivedBy: string;
  recalled: boolean;
}

export const STOCK_MOVEMENTS = [
  'INWARD_PO',
  'ONLINE_SALE',
  'OFFLINE_QR_SALE',
  'POS_WALKIN_SALE',
  'CUSTOMER_RETURN',
  'DAMAGED_WRITE_OFF',
  'CYCLE_COUNT_ADJUSTMENT',
  'STOCK_TRANSFER_OUT',
  'STOCK_TRANSFER_IN',
  'RECALL_REMOVAL',
  'ORDER_CANCEL_RESTOCK',
] as const;
export type StockMovement = (typeof STOCK_MOVEMENTS)[number];

/** stock_ledger/{entryId} — append-only audit of every stock change. */
export interface StockLedgerDoc {
  storeId: string;
  vendorId: string;
  productId: string;
  batchId: string | null;
  movement: StockMovement;
  qtyDelta: number; // negative for outward
  balanceAfter: number;
  refType: 'ORDER' | 'PURCHASE' | 'ADJUSTMENT' | 'TRANSFER' | 'RECALL';
  refId: string;
  reason: string | null;
  byUid: string;
  at: Ts;
}

/** Days before expiry that trigger an alert badge. */
export const EXPIRY_ALERT_DAYS = 15;

/* ------------------------------------------------------------------ */
/* Carts, orders, invoices                                             */
/* ------------------------------------------------------------------ */

/** temp_carts/{cartId} — walk-in QR cart. Holds only ids + qty; prices are
 *  always recomputed server-side at checkout. TTL policy on `expiresAt`. */
export interface TempCartDoc {
  cartId: string;
  storeId: string;
  vendorId: string;
  guestUid: string;
  items: { productId: string; qty: number }[];
  status: 'OPEN' | 'CHECKOUT_PENDING' | 'CONSUMED' | 'EXPIRED';
  createdAt: Ts;
  expiresAt: Ts;
}

export type SalesChannel = 'ONLINE' | 'OFFLINE_QR' | 'POS_WALKIN';
export type PaymentMethod = 'UPI_INTENT' | 'UPI_QR' | 'CARD' | 'COD' | 'CASH' | 'WALLET';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type OrderStatus =
  | 'PLACED'
  | 'ACCEPTED'
  | 'PICKING'
  | 'PACKED'
  | 'HANDED_TO_RIDER'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'COMPLETED' // walk-in sales
  | 'CANCELLED'
  | 'REJECTED';

export interface OrderLine {
  productId: string;
  name: string;
  hsnCode: string;
  qty: number;
  unit: Uqc;
  unitPrice: Paise;
  taxType: TaxType;
  gstSlab: GstSlab;
  cessRate: number;
  batchAllocations: { batchId: string; qty: number }[];
}

/** orders/{orderId} — server-written only. */
export interface OrderDoc {
  orderId: string;
  channel: SalesChannel;
  storeId: string;
  vendorId: string;
  customerUid: string | null; // null for anonymous walk-in that never upgraded
  guestUid: string | null;
  lines: OrderLine[];
  totals: { taxable: Paise; cgst: Paise; sgst: Paise; igst: Paise; cess: Paise; roundOff: Paise; grandTotal: Paise };
  payment: { method: PaymentMethod; status: PaymentStatus; providerRef: string | null };
  status: OrderStatus;
  deliveryAddress: SavedAddress | null;
  riderUid: string | null;
  deliveryOtpHash: string | null;
  invoiceId: string | null;
  /** Online orders: delivery fee etc. (also lines in the computation). */
  charges?: { code: string; name: string; amount: Paise }[];
  /** Online orders: tax computation frozen at order time; invoice number is
   *  assigned at dispatch so cancelled orders never consume a number. */
  computationJson?: string | null;
  etaMinutes?: number | null;
  cancelReason?: string | null;
  statusHistory?: { status: OrderStatus; at: number; by: string }[];
  createdAt: Ts;
  updatedAt: Ts;
}

/** wallet_txns/{id} */
export interface WalletTxnDoc {
  uid: string;
  kind: 'TOPUP' | 'ORDER_DEBIT' | 'REFUND' | 'ADJUSTMENT';
  amount: Paise; // + credit, - debit
  balanceAfter: Paise;
  refId: string | null;
  note: string | null;
  at: Ts;
}

export type InvoiceKind = 'B2C' | 'B2B';

/** invoices/{invoiceId} — immutable once issued. Server-written only. */
export interface InvoiceDoc {
  invoiceId: string;
  invoiceNo: string; // e.g. PX/26-27/000123 (≤16 chars)
  financialYear: string; // "2026-27"
  seq: number;
  kind: InvoiceKind;
  vendorId: string;
  storeId: string;
  orderId: string;
  customerUid: string | null;
  guestUid: string | null;
  sellerSnapshot: { legalName: string; tradeName: string; gstin: string | null; fssaiLicenseNo: string | null; address: string; stateCode: string };
  buyer: { name: string | null; gstin: string | null; address: string | null; placeOfSupplyStateCode: string };
  supplyType: 'INTRA_STATE' | 'INTER_STATE';
  // computed lines + HSN summary + totals mirror InvoiceComputation in gst/engine.ts
  computationJson: string;
  irn: string | null;
  ackNo: string | null;
  ackDate: string | null;
  signedQr: string | null;
  upiQrPayload: string | null;
  pdfPaths: { a4: string | null; thermal: string | null };
  issuedAt: Ts;
  issuedBy: string;
}

/** counters/{vendorId}_{FY} — invoice sequence. Server-only. */
export interface CounterDoc {
  vendorId: string;
  financialYear: string;
  lastSeq: number;
  updatedAt: Ts;
}

/* ------------------------------------------------------------------ */
/* Riders, compliance, support, audit                                  */
/* ------------------------------------------------------------------ */

export interface RiderDoc {
  uid: string;
  name: string;
  phone: string;
  vehicleType: 'BICYCLE' | 'SCOOTER' | 'MOTORCYCLE' | 'EV';
  vehicleNumber: string | null;
  kycStatus: KycStatus;
  isOnline: boolean; // rider-writable
  lastLocation: GeoPoint | null; // rider-writable
  lastSeenAt: Ts | null; // rider-writable
  homeStoreId: string | null;
  /** Business the rider delivers for (lets store operators see riders of their stores). Server-set. */
  vendorId: string | null;
  codCashInHand: Paise; // server-only
  earningsBalance: Paise; // server-only
  activeOrderIds: string[]; // server-only
}

/** rider_cash_ledger/{id} — append-only. COLLECT on a COD delivery, DEPOSIT at a store counter. */
export interface RiderCashDoc {
  riderUid: string;
  vendorId: string;
  storeId: string;
  kind: 'COLLECT' | 'DEPOSIT';
  amount: Paise; // + collect, - deposit
  balanceAfter: Paise;
  orderId: string | null;
  confirmedBy: string | null;
  at: Ts;
}

export type KycDocType = 'GSTIN_CERT' | 'FSSAI_LICENSE' | 'PAN' | 'DRIVING_LICENSE' | 'VEHICLE_RC' | 'AADHAAR_MASKED' | 'CANCELLED_CHEQUE';

export interface KycDocumentDoc {
  ownerUid: string;
  ownerType: 'VENDOR' | 'RIDER';
  vendorId: string | null;
  docType: KycDocType;
  storagePath: string;
  fileName?: string;
  status: KycStatus;
  reviewerUid: string | null;
  reviewNote: string | null;
  createdAt: Ts;
  reviewedAt: Ts | null;
}

export interface SupportTicketDoc {
  createdBy: string;
  creatorRole: Role;
  subject: string;
  category: 'ORDER' | 'PAYMENT' | 'INVOICE' | 'DAMAGED_ITEM' | 'STOCK' | 'KYC' | 'OTHER';
  orderId: string | null;
  transcript: { from: 'user' | 'bot' | 'agent'; text: string; at: number }[];
  attachmentPaths: string[];
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  assignedTo: string | null;
  createdAt: Ts;
  updatedAt: Ts;
}

/** compliance_checks/{id} — hygiene / cold-chain checklist submitted by store staff. */
export interface ComplianceCheckDoc {
  storeId: string;
  vendorId: string;
  kind: 'HYGIENE_DAILY' | 'COLD_CHAIN' | 'PEST_CONTROL' | 'EXPIRY_SWEEP';
  answers: { question: string; ok: boolean; note?: string }[];
  temperatureC: number | null;
  submittedBy: string;
  submittedAt: Ts;
  reviewStatus: 'PENDING' | 'OK' | 'ACTION_REQUIRED';
  reviewerUid: string | null;
  reviewNote: string | null;
}

export interface RecallDoc {
  productId: string;
  vendorId: string;
  batchNumbers: string[];
  reason: string;
  initiatedBy: string;
  status: 'ACTIVE' | 'COMPLETED';
  /** Units pulled off shelves when the recall was raised. */
  unitsRemoved?: number;
  createdAt: Ts;
  completedAt?: Ts | null;
}

/** audit_logs/{id} — append-only, written by functions only, never deletable. */
export interface AuditLogDoc {
  actorUid: string;
  actorRole: Role | 'system';
  action: string; // "role.set", "hsn_master.write", "qr.session"
  target: { collection: string; id: string };
  before: string | null; // JSON
  after: string | null; // JSON
  ip: string | null;
  at: Ts;
}
