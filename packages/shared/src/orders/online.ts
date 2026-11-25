/**
 * Online (delivery) order rules shared by Cloud Functions and the demo client.
 *
 * Lifecycle: PLACED → ACCEPTED → PICKING → PACKED → OUT_FOR_DELIVERY → DELIVERED.
 * Stock is reserved (deducted FEFO) when the order is placed. The tax invoice
 * number is assigned only at dispatch (time of supply = removal of goods), so an
 * order cancelled before dispatch is simply restocked and never needs a credit note.
 */
import type { Paise } from '../money.js';
import { roundHalfUp } from '../money.js';
import type { GstSlab, OrderStatus, PaymentMethod } from '../schema.js';
import { deriveInventory, StockError, type BatchState, type DerivedInventory, type LedgerPlan, type SaleCharge } from '../inventory/stock.js';
import { sha256Hex } from '../qrToken.js';

/** Delivery charge billed as a separate taxable service line.
 *  SAC 996813 (local delivery) at 18% is the conservative default — confirm with your CA;
 *  some treat it as part of a composite supply taxed at the goods' rate. */
export const DELIVERY_SAC = '996813';
export const DELIVERY_GST_SLAB: GstSlab = 18;

export const ONLINE_PAYMENT_METHODS = ['UPI_INTENT', 'CARD', 'COD', 'WALLET'] as const satisfies readonly PaymentMethod[];
export type OnlinePaymentMethod = (typeof ONLINE_PAYMENT_METHODS)[number];

/** Largest cash-on-delivery order accepted (₹3,000). */
export const COD_LIMIT: Paise = 300_000;
/** Smallest order accepted for delivery (₹99). */
export const MIN_ORDER_VALUE: Paise = 9_900;
export const WALLET_TOPUP_MAX: Paise = 1_000_000;

export interface ZoneFees {
  baseDeliveryFee: Paise;
  freeDeliveryAbove: Paise;
  surgeMultiplierBps: number; // 10000 = 1.0x
}

export function deliveryFee(itemsTotal: Paise, zone: ZoneFees): Paise {
  if (zone.freeDeliveryAbove > 0 && itemsTotal >= zone.freeDeliveryAbove) return 0;
  return roundHalfUp((zone.baseDeliveryFee * Math.max(10_000, zone.surgeMultiplierBps)) / 10_000);
}

export function deliveryCharge(itemsTotal: Paise, zone: ZoneFees): SaleCharge[] {
  const amount = deliveryFee(itemsTotal, zone);
  return amount > 0 ? [{ code: 'DELIVERY', name: 'Delivery charges', sac: DELIVERY_SAC, amount, gstSlab: DELIVERY_GST_SLAB }] : [];
}

/* ------------------------------------------------------------------ */
/* Status machine                                                      */
/* ------------------------------------------------------------------ */

export const ONLINE_FLOW: OrderStatus[] = ['PLACED', 'ACCEPTED', 'PICKING', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

const NEXT: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PLACED: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['PICKING', 'CANCELLED'],
  PICKING: ['PACKED', 'CANCELLED'],
  PACKED: ['OUT_FOR_DELIVERY', 'HANDED_TO_RIDER', 'CANCELLED'],
  HANDED_TO_RIDER: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (NEXT[from] ?? []).includes(to);
}

/** The next forward step a store operator would take (not cancel/reject). */
export function nextForwardStatus(from: OrderStatus): OrderStatus | null {
  const i = ONLINE_FLOW.indexOf(from);
  if (from === 'HANDED_TO_RIDER') return 'OUT_FOR_DELIVERY';
  return i >= 0 && i < ONLINE_FLOW.length - 1 ? ONLINE_FLOW[i + 1]! : null;
}

/** Customers may cancel until the store starts picking. */
export const customerCanCancel = (s: OrderStatus) => s === 'PLACED' || s === 'ACCEPTED';
/** Operators may cancel/reject until dispatch. */
export const operatorCanCancel = (s: OrderStatus) => s === 'PLACED' || s === 'ACCEPTED' || s === 'PICKING' || s === 'PACKED';
/** Moving into this status issues the tax invoice. */
export const isDispatch = (to: OrderStatus) => to === 'OUT_FOR_DELIVERY' || to === 'HANDED_TO_RIDER';

/* ------------------------------------------------------------------ */
/* Cancel → restock into the same batches                              */
/* ------------------------------------------------------------------ */

export interface RestockPlan {
  batchWrites: { productId: string; batchId: string; qty: number }[];
  inventoryWrites: ({ productId: string } & DerivedInventory)[];
  ledger: LedgerPlan[];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function planCancelRestock(
  lines: { productId: string; batchAllocations: { batchId: string; qty: number }[] }[],
  snap: { nowMs: number; batches: Record<string, BatchState[]>; reorderThreshold: Record<string, number> },
): RestockPlan {
  const out: RestockPlan = { batchWrites: [], inventoryWrites: [], ledger: [] };
  for (const l of lines) {
    if (l.productId.startsWith('charge:')) continue;
    const batches = (snap.batches[l.productId] ?? []).map((b) => ({ ...b }));
    let running = deriveInventory(batches, snap.reorderThreshold[l.productId] ?? 0, snap.nowMs).onHand;
    for (const a of l.batchAllocations) {
      const b = batches.find((x) => x.batchId === a.batchId);
      if (!b) throw new StockError('BAD_BATCH', `Batch ${a.batchId} missing for ${l.productId}`, l.productId);
      b.qty = round3(b.qty + a.qty);
      // recalled stock goes back to its batch but is not counted as on hand
      if (!b.recalled) running = round3(running + a.qty);
      out.batchWrites.push({ productId: l.productId, batchId: b.batchId, qty: b.qty });
      out.ledger.push({ productId: l.productId, batchId: b.batchId, movement: 'ORDER_CANCEL_RESTOCK', qtyDelta: a.qty, balanceAfter: running });
    }
    out.inventoryWrites.push({ productId: l.productId, ...deriveInventory(batches, snap.reorderThreshold[l.productId] ?? 0, snap.nowMs) });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Payment + wallet checks                                             */
/* ------------------------------------------------------------------ */

export type OrderCheckCode = 'MIN_ORDER' | 'COD_LIMIT' | 'WALLET_LOW' | 'BAD_METHOD';
export class OrderError extends Error {
  constructor(readonly code: OrderCheckCode, message: string) {
    super(message);
    this.name = 'OrderError';
  }
}

export function checkOnlinePayment(method: string, itemsTotal: Paise, grandTotal: Paise, walletBalance: Paise): void {
  if (!(ONLINE_PAYMENT_METHODS as readonly string[]).includes(method)) throw new OrderError('BAD_METHOD', 'Choose a payment method');
  if (itemsTotal < MIN_ORDER_VALUE) throw new OrderError('MIN_ORDER', `Minimum order for delivery is ₹${MIN_ORDER_VALUE / 100}`);
  if (method === 'COD' && grandTotal > COD_LIMIT) throw new OrderError('COD_LIMIT', `Cash on delivery is available up to ₹${COD_LIMIT / 100}. Pay online for this order.`);
  if (method === 'WALLET' && walletBalance < grandTotal) throw new OrderError('WALLET_LOW', 'Wallet balance is not enough for this order');
}

/** Refund rule on cancellation: anything already paid goes back to the wallet instantly. */
export function refundOnCancel(payment: { method: PaymentMethod; status: string }, grandTotal: Paise): Paise {
  return payment.status === 'PAID' ? grandTotal : 0;
}

/* ------------------------------------------------------------------ */
/* Delivery OTP                                                        */
/* ------------------------------------------------------------------ */

export function newDeliveryOtp(): string {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return String(1000 + (a[0]! % 9000));
}

export const hashDeliveryOtp = (orderId: string, otp: string) => sha256Hex(`pansari-otp:${orderId}:${otp.trim()}`);

/** Items total (before delivery charges) from shelf prices — used for fee and limits. */
export function itemsTotal(lines: { unitPrice: Paise; qty: number }[]): Paise {
  return lines.reduce((a, l) => a + roundHalfUp(l.unitPrice * l.qty), 0);
}
