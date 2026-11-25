/**
 * Phase 4 extras shared by Cloud Functions and the demo client:
 * rider payouts, proof-of-delivery photos, live rider tracking, hygiene checklists.
 */
import type { Paise } from '../money.js';
import type { GeoPoint, OrderStatus } from '../schema.js';
import { estimateEtaMinutes, haversineMeters } from '../geo/geo.js';

export class ExtrasError extends Error {
  constructor(readonly code: 'BAD_AMOUNT' | 'BAD_INPUT' | 'NOT_ALLOWED' | 'TOO_LATE', message: string) {
    super(message);
    this.name = 'ExtrasError';
  }
}

/* ------------------------------------------------------------------ payouts */

export const PAYOUT_METHODS = ['UPI', 'BANK', 'CASH'] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

/**
 * The shop pays a rider part or all of their earnings. Money moves outside the app
 * (API hold: no payout provider yet); this records it and lowers earningsBalance.
 */
export function planPayout(earnings: Paise, amount: number, method: string, reference: string): { earningsBalance: Paise; method: PayoutMethod; reference: string } {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new ExtrasError('BAD_AMOUNT', 'Enter the amount paid');
  if (amount > earnings) throw new ExtrasError('BAD_AMOUNT', `Rider has only ₹${(earnings / 100).toFixed(2)} unpaid`);
  if (!(PAYOUT_METHODS as readonly string[]).includes(method)) throw new ExtrasError('BAD_INPUT', 'Choose how you paid');
  const ref = (reference ?? '').trim().slice(0, 60);
  if (method !== 'CASH' && ref.length < 4) throw new ExtrasError('BAD_INPUT', 'Enter the UPI / bank reference number');
  return { earningsBalance: earnings - amount, method: method as PayoutMethod, reference: ref };
}

/* ------------------------------------------------------------------ proof of delivery */

/** A rider can attach the delivery photo from the moment they start the trip until 2 hours after delivery. */
export const POD_WINDOW_MS = 2 * 60 * 60 * 1000;

export function checkPod(riderUid: string, order: { riderUid: string | null; status: OrderStatus; deliveredMs: number | null }, nowMs: number): void {
  if (order.riderUid !== riderUid) throw new ExtrasError('NOT_ALLOWED', 'This order is not assigned to you');
  if (order.status !== 'OUT_FOR_DELIVERY' && order.status !== 'DELIVERED') throw new ExtrasError('NOT_ALLOWED', 'Add the photo when you hand over the order');
  if (order.status === 'DELIVERED' && order.deliveredMs !== null && nowMs - order.deliveredMs > POD_WINDOW_MS) throw new ExtrasError('TOO_LATE', 'Too late to add a delivery photo for this order');
}

/* ------------------------------------------------------------------ live tracking */

/** Rider location older than this is shown as "last seen", not live. */
export const LIVE_LOCATION_MAX_AGE_MS = 3 * 60 * 1000;
/** How often the rider app sends its location while carrying orders. */
export const RIDER_PING_INTERVAL_MS = 30 * 1000;

export const TRACKABLE: readonly OrderStatus[] = ['HANDED_TO_RIDER', 'OUT_FOR_DELIVERY'];

export interface RiderFix {
  lat: number;
  lng: number;
  atMs: number;
  distanceKm: number;
  etaMinutes: number;
  live: boolean;
  /** Demo only: position estimated along the route because no real GPS fix exists. */
  simulated?: boolean;
}

export function trackEstimate(rider: GeoPoint & { atMs: number }, dest: GeoPoint, nowMs: number): RiderFix {
  const m = haversineMeters(rider, dest);
  return {
    lat: rider.lat,
    lng: rider.lng,
    atMs: rider.atMs,
    distanceKm: Math.round(m / 100) / 10,
    etaMinutes: m < 60 ? 1 : estimateEtaMinutes(m, { prepMinutes: 0 }),
    live: nowMs - rider.atMs <= LIVE_LOCATION_MAX_AGE_MS,
  };
}

/** Demo: a believable position between the store and the customer based on time since the trip started. */
export function simulateRiderPosition(from: GeoPoint, to: GeoPoint, startedMs: number, nowMs: number): GeoPoint {
  const tripMs = estimateEtaMinutes(haversineMeters(from, to), { prepMinutes: 0 }) * 60_000;
  const f = Math.min(0.95, Math.max(0.05, (nowMs - startedMs) / tripMs));
  return { lat: from.lat + (to.lat - from.lat) * f, lng: from.lng + (to.lng - from.lng) * f };
}

export function validPing(p: unknown): GeoPoint | null {
  const o = p as { lat?: unknown; lng?: unknown } | null;
  const lat = Number(o?.lat);
  const lng = Number(o?.lng);
  // India bounding box (roughly) — rejects 0,0 and obviously wrong fixes.
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 6 || lat > 38 || lng < 68 || lng > 98) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

/* ------------------------------------------------------------------ hygiene checklists */

export type HygieneKind = 'HYGIENE_DAILY' | 'COLD_CHAIN' | 'PEST_CONTROL' | 'EXPIRY_SWEEP';

export const HYGIENE_KIND_LABEL: Record<HygieneKind, string> = {
  HYGIENE_DAILY: 'Daily hygiene',
  COLD_CHAIN: 'Cool storage temperature',
  PEST_CONTROL: 'Pest control',
  EXPIRY_SWEEP: 'Expiry sweep',
};

/** Questions per checklist. Plain wording for shop staff. */
export const HYGIENE_QUESTIONS: Record<HygieneKind, string[]> = {
  HYGIENE_DAILY: [
    'Floor, shelves and counter cleaned today',
    'Loose herbs and dry fruits kept in closed containers',
    'No damaged or leaking packets on the shelf',
    'Staff washed hands; clean apron or uniform',
    'Waste bin covered and emptied',
    'FSSAI licence displayed where customers can see it',
  ],
  COLD_CHAIN: ['Cool shelf / fridge working', 'Temperature written in the register', 'Nothing stored directly on the floor'],
  PEST_CONTROL: ['No signs of rats, cockroaches or insects', 'Pest-control service done this month', 'Gaps under doors and shutters sealed'],
  EXPIRY_SWEEP: ['Checked every shelf for expired stock', 'Expired items removed and written off in the app', 'Items expiring in 30 days moved to the front'],
};

/** Safe range for herb / dry-fruit cool storage, °C. */
export const COLD_RANGE = { min: 2, max: 25 } as const;

export interface HygieneAnswer {
  question: string;
  ok: boolean;
  note?: string;
}

export function validateHygiene(kind: string, answers: HygieneAnswer[], temperatureC: number | null): { kind: HygieneKind; answers: HygieneAnswer[]; temperatureC: number | null; failed: number; flag: boolean } {
  if (!(kind in HYGIENE_QUESTIONS)) throw new ExtrasError('BAD_INPUT', 'Unknown checklist');
  const k = kind as HygieneKind;
  const qs = HYGIENE_QUESTIONS[k];
  if (!Array.isArray(answers) || answers.length !== qs.length) throw new ExtrasError('BAD_INPUT', 'Answer every question');
  const clean = qs.map((q, i) => {
    const a = answers[i]!;
    if (a.question !== q || typeof a.ok !== 'boolean') throw new ExtrasError('BAD_INPUT', 'Answer every question');
    const note = (a.note ?? '').trim().slice(0, 200);
    if (!a.ok && note.length < 3) throw new ExtrasError('BAD_INPUT', `Say what is wrong: “${q}”`);
    return note ? { question: q, ok: a.ok, note } : { question: q, ok: a.ok };
  });
  let t: number | null = null;
  if (k === 'COLD_CHAIN') {
    if (temperatureC === null || !Number.isFinite(temperatureC) || temperatureC < -30 || temperatureC > 60) throw new ExtrasError('BAD_INPUT', 'Enter the temperature in °C');
    t = Math.round(temperatureC * 10) / 10;
  }
  const failed = clean.filter((a) => !a.ok).length;
  const outOfRange = t !== null && (t < COLD_RANGE.min || t > COLD_RANGE.max);
  return { kind: k, answers: clean, temperatureC: t, failed, flag: failed > 0 || outOfRange };
}

/** Stores that have not submitted today's daily hygiene check (IST day). */
export function missingDailyChecks(storeIds: string[], checks: { storeId: string; kind: string; submittedMs: number }[], nowMs: number): string[] {
  const istDay = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);
  const today = istDay(nowMs);
  const done = new Set(checks.filter((c) => c.kind === 'HYGIENE_DAILY' && istDay(c.submittedMs) === today).map((c) => c.storeId));
  return storeIds.filter((s) => !done.has(s));
}
