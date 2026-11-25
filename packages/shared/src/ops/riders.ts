/**
 * Rider rules shared by Cloud Functions and the demo client (Phase 4).
 *
 * Delivery with a rider:
 *   store packs (PACKED) → store assigns a rider (riderUid set; allowed from ACCEPTED)
 *   → rider collects the bag at the counter: HANDED_TO_RIDER (tax invoice issued here)
 *   → rider starts the trip: OUT_FOR_DELIVERY
 *   → rider enters the customer's 4-digit code: DELIVERED
 * Cash collected on COD orders is added to the rider's cash in hand and must be
 * handed in at a store counter, where the seller / staff confirm the deposit.
 */
import type { Paise } from '../money.js';
import type { KycDocType, KycStatus, OrderStatus } from '../schema.js';

/** A rider carries at most this many open orders at once. */
export const RIDER_MAX_ACTIVE_ORDERS = 3;
/** Riders cannot take more COD orders once cash in hand would pass ₹5,000. */
export const RIDER_COD_CASH_LIMIT: Paise = 500_000;
/** Flat rider pay per completed drop (illustrative — set your own rate). */
export const RIDER_PAY_PER_DROP: Paise = 3_000;

export const RIDER_VEHICLES = ['BICYCLE', 'SCOOTER', 'MOTORCYCLE', 'EV'] as const;
export type RiderVehicle = (typeof RIDER_VEHICLES)[number];

/** Registration number as printed on the RC, e.g. "RJ14 CK 4821". Returns the tidy form or null. */
export function normaliseVehicleNo(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  return /^[A-Z]{2}\s?\d{1,2}\s?[A-Z]{0,3}\s?\d{1,4}$/.test(s) ? s : null;
}

/** Documents a rider must have verified before going on shift. Aadhaar: masked copy only. */
export const RIDER_KYC_DOCS: readonly KycDocType[] = ['DRIVING_LICENSE', 'VEHICLE_RC', 'AADHAAR_MASKED'];
/** Documents for the selling business (vendor). */
export const VENDOR_KYC_DOCS: readonly KycDocType[] = ['GSTIN_CERT', 'FSSAI_LICENSE', 'PAN', 'CANCELLED_CHEQUE'];

export const KYC_DOC_LABEL: Record<KycDocType, string> = {
  GSTIN_CERT: 'GST registration certificate',
  FSSAI_LICENSE: 'FSSAI licence',
  PAN: 'PAN card',
  DRIVING_LICENSE: 'Driving licence',
  VEHICLE_RC: 'Vehicle RC',
  AADHAAR_MASKED: 'Aadhaar (masked — only last 4 digits visible)',
  CANCELLED_CHEQUE: 'Cancelled cheque',
};

export class RiderError extends Error {
  constructor(
    readonly code:
      | 'KYC_NOT_VERIFIED'
      | 'OFF_SHIFT'
      | 'TOO_MANY_ORDERS'
      | 'COD_CASH_LIMIT'
      | 'WRONG_STORE'
      | 'BAD_STATUS'
      | 'NOT_YOUR_ORDER'
      | 'ALREADY_PICKED'
      | 'BAD_AMOUNT'
      | 'NO_RIDER',
    message: string,
  ) {
    super(message);
    this.name = 'RiderError';
  }
}

export interface RiderState {
  uid: string;
  kycStatus: KycStatus;
  isOnline: boolean;
  homeStoreId: string | null;
  codCashInHand: Paise;
  activeOrderIds: string[];
}

/** Statuses in which the store may assign (or change) the rider. */
export const ASSIGNABLE_STATUSES: readonly OrderStatus[] = ['ACCEPTED', 'PICKING', 'PACKED'];

/** Checks the store may give this order to this rider. Throws RiderError. */
export function checkAssignRider(
  rider: RiderState,
  order: { orderId: string; storeId: string; status: OrderStatus; paymentMethod: string; paymentStatus: string; grandTotal: Paise; riderUid: string | null },
): void {
  if (!ASSIGNABLE_STATUSES.includes(order.status)) throw new RiderError('BAD_STATUS', 'A rider can be assigned only after you accept the order and before it leaves the store');
  if (rider.kycStatus !== 'VERIFIED') throw new RiderError('KYC_NOT_VERIFIED', 'This rider’s documents are not verified yet');
  if (!rider.isOnline) throw new RiderError('OFF_SHIFT', 'This rider is not on shift');
  if (rider.homeStoreId && rider.homeStoreId !== order.storeId) throw new RiderError('WRONG_STORE', 'This rider works from another store');
  const active = rider.activeOrderIds.filter((id) => id !== order.orderId);
  if (active.length >= RIDER_MAX_ACTIVE_ORDERS) throw new RiderError('TOO_MANY_ORDERS', `A rider can carry ${RIDER_MAX_ACTIVE_ORDERS} orders at a time`);
  const cod = order.paymentMethod === 'COD' && order.paymentStatus !== 'PAID' ? order.grandTotal : 0;
  if (cod > 0 && rider.codCashInHand + cod > RIDER_COD_CASH_LIMIT) {
    throw new RiderError('COD_CASH_LIMIT', `Rider already holds ₹${Math.round(rider.codCashInHand / 100)} cash — ask them to hand it in before taking more cash orders`);
  }
}

/** Steps a rider may take on an order assigned to them. */
const RIDER_STEPS: Partial<Record<OrderStatus, OrderStatus>> = {
  PACKED: 'HANDED_TO_RIDER',
  HANDED_TO_RIDER: 'OUT_FOR_DELIVERY',
  OUT_FOR_DELIVERY: 'DELIVERED',
};

export const riderNextStatus = (from: OrderStatus): OrderStatus | null => RIDER_STEPS[from] ?? null;

export function checkRiderStep(riderUid: string, order: { riderUid: string | null; status: OrderStatus }, to: OrderStatus): void {
  if (order.riderUid !== riderUid) throw new RiderError('NOT_YOUR_ORDER', 'This order is not assigned to you');
  if (RIDER_STEPS[order.status] !== to) throw new RiderError('BAD_STATUS', order.status === 'PICKING' || order.status === 'ACCEPTED' ? 'The store is still packing this order' : `Cannot move this order from ${order.status} to ${to}`);
}

/** Once the rider has the bag, the store cannot hand it to someone else. */
export const riderHasPicked = (s: OrderStatus) => s === 'HANDED_TO_RIDER' || s === 'OUT_FOR_DELIVERY' || s === 'DELIVERED';

/** On delivery: what changes on the rider's books. */
export function planRiderDelivered(rider: RiderState, order: { orderId: string; paymentMethod: string; paymentStatus: string; grandTotal: Paise }) {
  const cashCollected = order.paymentMethod === 'COD' && order.paymentStatus !== 'PAID' ? order.grandTotal : 0;
  return {
    cashCollected,
    codCashInHand: rider.codCashInHand + cashCollected,
    activeOrderIds: rider.activeOrderIds.filter((x) => x !== order.orderId),
    earning: RIDER_PAY_PER_DROP,
  };
}

/** Cash handed in at the counter. The store confirms the amount it counted. */
export function planCodDeposit(cashInHand: Paise, amount: number): { codCashInHand: Paise } {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new RiderError('BAD_AMOUNT', 'Enter the cash amount received');
  if (amount > cashInHand) throw new RiderError('BAD_AMOUNT', `Rider holds only ₹${(cashInHand / 100).toFixed(2)}`);
  return { codCashInHand: cashInHand - amount };
}

/* ------------------------------------------------------------------ */
/* KYC roll-up                                                          */
/* ------------------------------------------------------------------ */

export interface KycDocState {
  docType: KycDocType;
  status: KycStatus;
  createdMs: number;
}

/**
 * Overall KYC status from the documents on file. The newest upload of each type
 * counts. VERIFIED only when every required type is verified; REJECTED when any
 * required type's latest upload was rejected; UNDER_REVIEW when all are in.
 */
export function rollupKyc(docs: KycDocState[], required: readonly KycDocType[]): KycStatus {
  const latest = new Map<KycDocType, KycDocState>();
  for (const d of docs) {
    const cur = latest.get(d.docType);
    if (!cur || d.createdMs >= cur.createdMs) latest.set(d.docType, d);
  }
  const states = required.map((t) => latest.get(t)?.status ?? null);
  if (states.every((s) => s === 'VERIFIED')) return 'VERIFIED';
  if (states.some((s) => s === 'REJECTED')) return 'REJECTED';
  if (states.every((s) => s !== null)) return 'UNDER_REVIEW';
  return 'PENDING';
}

/** Which required documents still need an upload (missing or latest rejected). */
export function kycMissing(docs: KycDocState[], required: readonly KycDocType[]): KycDocType[] {
  return required.filter((t) => {
    const mine = docs.filter((d) => d.docType === t).sort((a, b) => b.createdMs - a.createdMs)[0];
    return !mine || mine.status === 'REJECTED';
  });
}

/** Upload file names: storage-safe, kept short. */
export function kycFileName(docType: KycDocType, original: string, nowMs: number): string {
  const ext = (/\.([A-Za-z0-9]{1,5})$/.exec(original)?.[1] ?? 'bin').toLowerCase();
  return `${docType.toLowerCase()}-${nowMs}.${ext}`;
}
