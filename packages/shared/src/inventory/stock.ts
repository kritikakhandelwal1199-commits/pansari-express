/**
 * Pure stock + sale planning. No I/O: callers load a snapshot (inside a
 * Firestore transaction on the server, or from memory in demo mode), call a
 * planner, then apply the returned writes. Both Cloud Functions and the web
 * demo client use exactly this code, so behaviour cannot drift.
 *
 * Rules implemented:
 *  - FEFO: sell the batch that expires first; expired and recalled batches are never sold.
 *  - Price comes from the server inventory doc, never from the client; selling above MRP is refused.
 *  - Counter / QR sales are intra-state (place of supply = store location, IGST Act s.10(1)(d));
 *    online deliveries use the delivery address state.
 *  - Every movement produces a ledger entry with the running balance.
 */
import { computeInvoice, type InvoiceComputation } from '../gst/engine.js';
import { financialYear, formatInvoiceNo } from '../gst/invoiceNumber.js';
import type { Paise } from '../money.js';
import type { ComplianceStatus, GstSlab, PaymentMethod, SalesChannel, StockMovement, TaxType, Uqc } from '../schema.js';
import { EXPIRY_ALERT_DAYS } from '../schema.js';

export const LOOSE_UNITS: readonly Uqc[] = ['KGS', 'GMS', 'LTR', 'MLT'];
export const MAX_SALE_LINES = 60;

export interface BatchState {
  batchId: string;
  batchNumber: string;
  mfgMs: number | null;
  expiryMs: number | null;
  receivedMs: number;
  qty: number;
  recalled: boolean;
  purchasePrice: Paise;
  mrp: Paise;
}

export interface InventoryState {
  productId: string;
  productName: string;
  sellingPrice: Paise;
  mrp: Paise;
  onHand: number;
  reorderThreshold: number;
  aisleBinCode: string;
  isListed: boolean;
}

export interface ProductTax {
  productId: string;
  name: string;
  hsnCode: string;
  gstSlab: GstSlab;
  cessRate: number;
  taxType: TaxType;
  unit: Uqc;
  complianceStatus: ComplianceStatus;
}

export interface DerivedInventory {
  onHand: number; // physically present, excluding recalled
  sellable: number; // not expired, not recalled
  lowStock: boolean;
  nearestExpiryMs: number | null;
  nextBatchNumber: string | null;
  expiringSoon: boolean;
}

export type StockErrorCode =
  | 'EMPTY_SALE'
  | 'TOO_MANY_LINES'
  | 'BAD_QTY'
  | 'UNKNOWN_PRODUCT'
  | 'NOT_STOCKED'
  | 'NOT_FOR_SALE'
  | 'NO_PRICE'
  | 'PRICE_ABOVE_MRP'
  | 'OUT_OF_STOCK'
  | 'STORE_INACTIVE'
  | 'BAD_BATCH'
  | 'BATCH_CONFLICT'
  | 'BAD_DATES'
  | 'BAD_AMOUNT'
  | 'REASON_REQUIRED'
  | 'NOTHING_TO_ADJUST';

export class StockError extends Error {
  constructor(readonly code: StockErrorCode, message: string, readonly productId?: string, readonly available?: number) {
    super(message);
    this.name = 'StockError';
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const DAY = 24 * 3600 * 1000;

export function validQty(qty: number, unit: Uqc): boolean {
  if (!Number.isFinite(qty) || qty <= 0 || qty > 100_000) return false;
  return LOOSE_UNITS.includes(unit) ? round3(qty) === qty : Number.isInteger(qty);
}

const isSellable = (b: BatchState, nowMs: number) => !b.recalled && b.qty > 0 && (b.expiryMs === null || b.expiryMs > nowMs);

/** FEFO order: earliest expiry first; no-expiry batches last; ties by arrival. */
export function fefoOrder(batches: BatchState[]): BatchState[] {
  return [...batches].sort((a, b) => (a.expiryMs ?? Infinity) - (b.expiryMs ?? Infinity) || a.receivedMs - b.receivedMs || a.batchId.localeCompare(b.batchId));
}

export function deriveInventory(batches: BatchState[], reorderThreshold: number, nowMs: number): DerivedInventory {
  const live = batches.filter((b) => !b.recalled && b.qty > 0);
  const sellableBatches = fefoOrder(live.filter((b) => isSellable(b, nowMs)));
  const onHand = round3(live.reduce((a, b) => a + b.qty, 0));
  const sellable = round3(sellableBatches.reduce((a, b) => a + b.qty, 0));
  const nearest = sellableBatches.find((b) => b.expiryMs !== null)?.expiryMs ?? null;
  return {
    onHand,
    sellable,
    lowStock: sellable <= reorderThreshold,
    nearestExpiryMs: nearest,
    nextBatchNumber: sellableBatches[0]?.batchNumber ?? null,
    expiringSoon: nearest !== null && nearest - nowMs <= EXPIRY_ALERT_DAYS * DAY,
  };
}

export interface Allocation {
  batchId: string;
  batchNumber: string;
  expiryMs: number | null;
  qty: number;
}

export function allocateFefo(batches: BatchState[], qty: number, nowMs: number): { allocations: Allocation[]; shortBy: number } {
  let need = qty;
  const allocations: Allocation[] = [];
  for (const b of fefoOrder(batches.filter((x) => isSellable(x, nowMs)))) {
    if (need <= 0) break;
    const take = round3(Math.min(b.qty, need));
    allocations.push({ batchId: b.batchId, batchNumber: b.batchNumber, expiryMs: b.expiryMs, qty: take });
    need = round3(need - take);
  }
  return { allocations, shortBy: need > 0 ? need : 0 };
}

/* ================================================================== */
/* Sale                                                                */
/* ================================================================== */

export interface SaleRequest {
  channel: SalesChannel;
  items: { productId: string; qty: number }[];
  payment: { method: PaymentMethod; status: 'PAID' | 'PENDING'; providerRef: string | null };
  buyer?: { name?: string | null; gstin?: string | null; address?: string | null; placeOfSupplyStateCode?: string | null };
  customerUid?: string | null;
  guestUid?: string | null;
  actorUid: string;
}

export interface SaleSnapshot {
  nowMs: number;
  store: { storeId: string; vendorId: string; name: string; stateCode: string; addressLine: string; city: string; pincode: string; gstin: string | null; fssaiLicenseNo: string | null; isActive: boolean };
  vendor: { vendorId: string; legalName: string; tradeName: string; gstin: string | null; fssaiLicenseNo: string | null; stateCode: string; invoicePrefix: string; registeredAddress: string };
  products: Record<string, ProductTax>;
  inventory: Record<string, InventoryState>;
  batches: Record<string, BatchState[]>;
  /** lastSeq of counters/{vendorId}_{FY} for the FY of nowMs (0 if none). */
  counterLastSeq: number;
}

export interface PlannedLine {
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

export interface LedgerPlan {
  productId: string;
  batchId: string | null;
  movement: StockMovement;
  qtyDelta: number;
  balanceAfter: number;
}

export interface SalePlan {
  financialYear: string;
  seq: number;
  invoiceNo: string;
  computation: InvoiceComputation;
  lines: PlannedLine[];
  batchWrites: { productId: string; batchId: string; qty: number }[];
  inventoryWrites: ({ productId: string } & DerivedInventory)[];
  ledger: LedgerPlan[];
  sellerSnapshot: { legalName: string; tradeName: string; gstin: string | null; fssaiLicenseNo: string | null; address: string; stateCode: string };
  buyer: { name: string | null; gstin: string | null; address: string | null; placeOfSupplyStateCode: string };
}

const MOVEMENT: Record<SalesChannel, StockMovement> = { ONLINE: 'ONLINE_SALE', OFFLINE_QR: 'OFFLINE_QR_SALE', POS_WALKIN: 'POS_WALKIN_SALE' };

export function planSale(req: SaleRequest, snap: SaleSnapshot): SalePlan {
  if (!snap.store.isActive) throw new StockError('STORE_INACTIVE', 'This store is not active');
  if (!Array.isArray(req.items) || req.items.length === 0) throw new StockError('EMPTY_SALE', 'Add at least one item');

  // merge duplicate lines, keep first-seen order
  const merged = new Map<string, number>();
  for (const it of req.items) {
    if (typeof it?.productId !== 'string') throw new StockError('UNKNOWN_PRODUCT', 'Bad product id');
    merged.set(it.productId, round3((merged.get(it.productId) ?? 0) + Number(it.qty)));
  }
  if (merged.size > MAX_SALE_LINES) throw new StockError('TOO_MANY_LINES', `At most ${MAX_SALE_LINES} different items per bill`);

  const guestFacing = req.channel !== 'POS_WALKIN';
  const lines: PlannedLine[] = [];
  const batchWrites: SalePlan['batchWrites'] = [];
  const inventoryWrites: SalePlan['inventoryWrites'] = [];
  const ledger: LedgerPlan[] = [];
  const firstBatch = new Map<string, { batchNumber: string; expiryMs: number | null }>();

  for (const [productId, qty] of merged) {
    const p = snap.products[productId];
    const inv = snap.inventory[productId];
    if (!p) throw new StockError('UNKNOWN_PRODUCT', `Unknown product ${productId}`, productId);
    if (!inv) throw new StockError('NOT_STOCKED', `${p.name} is not stocked at ${snap.store.name}`, productId);
    if (!validQty(qty, p.unit)) throw new StockError('BAD_QTY', `Invalid quantity for ${p.name}`, productId);
    if (guestFacing && (!inv.isListed || p.complianceStatus !== 'APPROVED')) throw new StockError('NOT_FOR_SALE', `${p.name} is not available for sale`, productId);
    if (!(inv.sellingPrice > 0)) throw new StockError('NO_PRICE', `${p.name} has no selling price`, productId);
    if (inv.mrp > 0 && inv.sellingPrice > inv.mrp) throw new StockError('PRICE_ABOVE_MRP', `${p.name} is priced above its MRP`, productId);

    const batches = (snap.batches[productId] ?? []).map((b) => ({ ...b }));
    const { allocations, shortBy } = allocateFefo(batches, qty, snap.nowMs);
    if (shortBy > 0) {
      const available = round3(qty - shortBy);
      throw new StockError('OUT_OF_STOCK', `Only ${available} of ${p.name} left`, productId, available);
    }
    let running = deriveInventory(batches, inv.reorderThreshold, snap.nowMs).onHand;
    for (const a of allocations) {
      const b = batches.find((x) => x.batchId === a.batchId)!;
      b.qty = round3(b.qty - a.qty);
      running = round3(running - a.qty);
      batchWrites.push({ productId, batchId: b.batchId, qty: b.qty });
      ledger.push({ productId, batchId: b.batchId, movement: MOVEMENT[req.channel], qtyDelta: -a.qty, balanceAfter: running });
    }
    inventoryWrites.push({ productId, ...deriveInventory(batches, inv.reorderThreshold, snap.nowMs) });
    const first = allocations[0]!;
    lines.push({
      productId,
      name: p.name,
      hsnCode: p.hsnCode,
      qty,
      unit: p.unit,
      unitPrice: inv.sellingPrice,
      taxType: p.taxType,
      gstSlab: p.gstSlab,
      cessRate: p.cessRate,
      batchAllocations: allocations.map((a) => ({ batchId: a.batchId, qty: a.qty })),
    });
    firstBatch.set(productId, { batchNumber: first.batchNumber, expiryMs: first.expiryMs });
  }

  const pos = req.channel === 'ONLINE' ? req.buyer?.placeOfSupplyStateCode ?? snap.store.stateCode : snap.store.stateCode;
  const computation = computeInvoice(
    lines.map((l) => {
      const fb = firstBatch.get(l.productId)!;
      return {
        productId: l.productId,
        name: l.name,
        hsnCode: l.hsnCode,
        qty: l.qty,
        unit: l.unit,
        unitPrice: l.unitPrice,
        taxType: l.taxType,
        gstSlab: l.gstSlab,
        cessRate: l.cessRate,
        batchNumber: fb.batchNumber,
        expiryDate: fb.expiryMs ? ddmmyyyy(fb.expiryMs) : null,
      };
    }),
    { sellerStateCode: snap.store.stateCode, placeOfSupplyStateCode: pos, buyerGstin: req.buyer?.gstin ?? null },
  );

  const fy = financialYear(new Date(snap.nowMs));
  const seq = snap.counterLastSeq + 1;
  return {
    financialYear: fy,
    seq,
    invoiceNo: formatInvoiceNo(snap.vendor.invoicePrefix, fy, seq),
    computation,
    lines,
    batchWrites,
    inventoryWrites,
    ledger,
    sellerSnapshot: {
      legalName: snap.vendor.legalName,
      tradeName: snap.vendor.tradeName,
      gstin: snap.store.gstin ?? snap.vendor.gstin,
      fssaiLicenseNo: snap.store.fssaiLicenseNo ?? snap.vendor.fssaiLicenseNo,
      address: `${snap.store.addressLine}, ${snap.store.city} ${snap.store.pincode}`,
      stateCode: snap.store.stateCode,
    },
    buyer: { name: req.buyer?.name?.trim() || null, gstin: computation.buyerGstin, address: req.buyer?.address?.trim() || null, placeOfSupplyStateCode: pos },
  };
}

export function ddmmyyyy(ms: number): string {
  const d = new Date(ms + 330 * 60 * 1000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

/* ================================================================== */
/* Inward (purchase receipt)                                           */
/* ================================================================== */

export interface InwardInput {
  productId: string;
  batchNumber: string;
  mfgMs: number | null;
  expiryMs: number | null;
  qty: number;
  purchasePrice: Paise; // per unit
  mrp: Paise; // printed on this batch
  reference: string; // supplier bill / PO no.
}

export interface InwardPlan {
  batch: BatchState;
  isNewBatch: boolean;
  inventory: DerivedInventory;
  ledger: LedgerPlan;
  mrp: Paise;
}

const BATCH_RE = /^[A-Za-z0-9/._-]{1,20}$/;

export function planInward(input: InwardInput, snap: { nowMs: number; unit: Uqc; reorderThreshold: number; batches: BatchState[]; newBatchId: string }): InwardPlan {
  if (!BATCH_RE.test(input.batchNumber ?? '')) throw new StockError('BAD_BATCH', 'Batch number: 1–20 letters, digits, / . _ -');
  if (!validQty(input.qty, snap.unit)) throw new StockError('BAD_QTY', 'Invalid quantity');
  if (!Number.isSafeInteger(input.purchasePrice) || input.purchasePrice < 0) throw new StockError('BAD_AMOUNT', 'Purchase price must be zero or more');
  if (!Number.isSafeInteger(input.mrp) || input.mrp <= 0) throw new StockError('BAD_AMOUNT', 'MRP is required');
  if (input.purchasePrice > input.mrp) throw new StockError('BAD_AMOUNT', 'Purchase price is above MRP — check the bill');
  if (input.mfgMs !== null && input.mfgMs > snap.nowMs + DAY) throw new StockError('BAD_DATES', 'Manufacturing date is in the future');
  if (input.expiryMs !== null && input.expiryMs <= snap.nowMs) throw new StockError('BAD_DATES', 'This batch has already expired');
  if (input.mfgMs !== null && input.expiryMs !== null && input.expiryMs <= input.mfgMs) throw new StockError('BAD_DATES', 'Expiry must be after manufacturing date');
  if (!input.reference?.trim()) throw new StockError('REASON_REQUIRED', 'Enter the supplier bill / PO number');

  const batches = snap.batches.map((b) => ({ ...b }));
  const existing = batches.find((b) => b.batchNumber.toUpperCase() === input.batchNumber.toUpperCase() && !b.recalled);
  let batch: BatchState;
  let isNewBatch = false;
  if (existing) {
    if (existing.expiryMs !== input.expiryMs || existing.mrp !== input.mrp) {
      throw new StockError('BATCH_CONFLICT', `Batch ${input.batchNumber} already exists with a different expiry or MRP`);
    }
    existing.qty = round3(existing.qty + input.qty);
    batch = existing;
  } else {
    batch = { batchId: snap.newBatchId, batchNumber: input.batchNumber, mfgMs: input.mfgMs, expiryMs: input.expiryMs, receivedMs: snap.nowMs, qty: input.qty, recalled: false, purchasePrice: input.purchasePrice, mrp: input.mrp };
    batches.push(batch);
    isNewBatch = true;
  }
  const inventory = deriveInventory(batches, snap.reorderThreshold, snap.nowMs);
  return { batch, isNewBatch, inventory, mrp: input.mrp, ledger: { productId: input.productId, batchId: batch.batchId, movement: 'INWARD_PO', qtyDelta: input.qty, balanceAfter: inventory.onHand } };
}

/* ================================================================== */
/* Adjustments                                                         */
/* ================================================================== */

export interface AdjustInput {
  productId: string;
  batchId: string;
  movement: 'CUSTOMER_RETURN' | 'DAMAGED_WRITE_OFF' | 'CYCLE_COUNT_ADJUSTMENT';
  qty?: number; // returns / damage
  countedQty?: number; // cycle count: physical count of this batch
  reason: string;
}

export function planAdjust(input: AdjustInput, snap: { nowMs: number; unit: Uqc; reorderThreshold: number; batches: BatchState[] }): { batch: BatchState; inventory: DerivedInventory; ledger: LedgerPlan } {
  if (!input.reason || input.reason.trim().length < 3) throw new StockError('REASON_REQUIRED', 'Write a short reason');
  const batches = snap.batches.map((b) => ({ ...b }));
  const b = batches.find((x) => x.batchId === input.batchId);
  if (!b) throw new StockError('BAD_BATCH', 'Batch not found');
  let delta: number;
  if (input.movement === 'CYCLE_COUNT_ADJUSTMENT') {
    const c = Number(input.countedQty);
    if (!(c === 0 || validQty(c, snap.unit))) throw new StockError('BAD_QTY', 'Counted quantity is invalid');
    delta = round3(c - b.qty);
    if (delta === 0) throw new StockError('NOTHING_TO_ADJUST', 'Count matches the system — nothing to adjust');
  } else {
    const q = Number(input.qty);
    if (!validQty(q, snap.unit)) throw new StockError('BAD_QTY', 'Invalid quantity');
    if (input.movement === 'DAMAGED_WRITE_OFF') {
      if (q > b.qty) throw new StockError('BAD_QTY', `Only ${b.qty} in this batch`);
      delta = -q;
    } else {
      if (b.recalled) throw new StockError('BAD_BATCH', 'Cannot return stock into a recalled batch');
      delta = q;
    }
  }
  b.qty = round3(b.qty + delta);
  const inventory = deriveInventory(batches, snap.reorderThreshold, snap.nowMs);
  return { batch: b, inventory, ledger: { productId: input.productId, batchId: b.batchId, movement: input.movement, qtyDelta: delta, balanceAfter: inventory.onHand } };
}
