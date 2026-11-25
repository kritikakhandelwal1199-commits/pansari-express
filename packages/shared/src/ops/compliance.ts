/**
 * Compliance + super-admin rules (Phase 4): product recalls, HSN master changes,
 * delivery zone validation.
 */
import type { Paise } from '../money.js';
import type { GstSlab } from '../schema.js';
import { GST_SLABS } from '../schema.js';
import { deriveInventory, type BatchState, type DerivedInventory, type LedgerPlan } from '../inventory/stock.js';
import { isValidHsn } from '../gst/validators.js';
import { parseZoneGeometry, type ZoneGeometry } from '../geo/geo.js';

export class ComplianceError extends Error {
  constructor(readonly code: 'BAD_INPUT' | 'NOTHING_TO_RECALL' | 'RECALLED_STOCK' | 'BAD_ZONE' | 'BAD_HSN', message: string) {
    super(message);
    this.name = 'ComplianceError';
  }
}

/* ------------------------------------------------------------------ */
/* Recalls                                                              */
/* ------------------------------------------------------------------ */

export const normBatchNo = (s: string) => s.trim().toUpperCase();

export function parseBatchList(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map(normBatchNo).filter(Boolean))].slice(0, 50);
}

export interface RecallStorePlan {
  storeId: string;
  batchWrites: { batchId: string; batchNumber: string; qty: 0; recalled: true }[];
  inventory: DerivedInventory;
  ledger: LedgerPlan[];
  unitsRemoved: number;
}

/**
 * Pulls stock of the recalled batches off the shelf in every store: each matching
 * batch is marked recalled and set to 0, with a RECALL_REMOVAL ledger line.
 * An empty batch list recalls every batch of the product.
 */
export function planRecall(
  productId: string,
  batchNumbers: string[],
  stores: { storeId: string; reorderThreshold: number; batches: BatchState[] }[],
  nowMs: number,
): { stores: RecallStorePlan[]; unitsRemoved: number; matchedBatchIds: string[]; wholeProduct: boolean } {
  const wanted = new Set(batchNumbers.map(normBatchNo));
  const wholeProduct = wanted.size === 0;
  const out: RecallStorePlan[] = [];
  const matched: string[] = [];
  for (const s of stores) {
    const batches = s.batches.map((b) => ({ ...b }));
    const hits = batches.filter((b) => wholeProduct || wanted.has(normBatchNo(b.batchNumber)));
    if (!hits.length) continue;
    let running = deriveInventory(batches, s.reorderThreshold, nowMs).onHand;
    const plan: RecallStorePlan = { storeId: s.storeId, batchWrites: [], ledger: [], unitsRemoved: 0, inventory: null as never };
    for (const b of hits) {
      matched.push(b.batchId);
      const was = b.recalled ? 0 : b.qty;
      b.qty = 0;
      b.recalled = true;
      plan.batchWrites.push({ batchId: b.batchId, batchNumber: b.batchNumber, qty: 0, recalled: true });
      if (was > 0) {
        running = Math.round((running - was) * 1000) / 1000;
        plan.unitsRemoved = Math.round((plan.unitsRemoved + was) * 1000) / 1000;
        plan.ledger.push({ productId, batchId: b.batchId, movement: 'RECALL_REMOVAL', qtyDelta: -was, balanceAfter: running });
      }
    }
    plan.inventory = deriveInventory(batches, s.reorderThreshold, nowMs);
    out.push(plan);
  }
  if (!matched.length) throw new ComplianceError('NOTHING_TO_RECALL', wholeProduct ? 'No stock of this product in any store' : 'None of these batch numbers are in stock or on record');
  return { stores: out, unitsRemoved: Math.round(out.reduce((a, s) => a + s.unitsRemoved, 0) * 1000) / 1000, matchedBatchIds: matched, wholeProduct };
}

/** Recalled packets must never leave the store: blocks dispatch of an order holding one. */
export function recalledInOrder(lines: { productId: string; name: string; batchAllocations: { batchId: string }[] }[], recalledBatchIds: Set<string>): string[] {
  return lines.filter((l) => l.batchAllocations.some((a) => recalledBatchIds.has(a.batchId))).map((l) => l.name);
}

/* ------------------------------------------------------------------ */
/* HSN master                                                           */
/* ------------------------------------------------------------------ */

export interface HsnInput {
  hsnCode: string;
  description: string;
  gstSlab: number;
}

export function validateHsn(i: HsnInput): { hsnCode: string; description: string; gstSlab: GstSlab } {
  const hsnCode = String(i.hsnCode ?? '').trim();
  if (!isValidHsn(hsnCode)) throw new ComplianceError('BAD_HSN', 'HSN must be 4, 6 or 8 digits');
  const description = String(i.description ?? '').trim();
  if (description.length < 3 || description.length > 120) throw new ComplianceError('BAD_HSN', 'Write a short description (3–120 letters)');
  if (!(GST_SLABS as readonly number[]).includes(i.gstSlab)) throw new ComplianceError('BAD_HSN', 'GST rate must be 0, 5, 12, 18 or 28%');
  return { hsnCode, description, gstSlab: i.gstSlab as GstSlab };
}

/** Most specific master row for a product HSN: 8 → 6 → 4 digits. */
export function resolveHsn<T extends { hsnCode: string }>(code: string, master: T[]): T | null {
  for (const len of [8, 6, 4]) {
    if (code.length < len) continue;
    const hit = master.find((m) => m.hsnCode === code.slice(0, len));
    if (hit) return hit;
  }
  return null;
}

/** Products whose GST rate changes when a master row is added or edited. */
export function productsAffectedByHsn<P extends { productId: string; hsnCode: string; gstSlab: number }>(products: P[], masterAfter: { hsnCode: string; gstSlab: number }[]): { productId: string; from: number; to: GstSlab }[] {
  const out: { productId: string; from: number; to: GstSlab }[] = [];
  for (const p of products) {
    const m = resolveHsn(p.hsnCode, masterAfter);
    if (m && m.gstSlab !== p.gstSlab) out.push({ productId: p.productId, from: p.gstSlab, to: m.gstSlab as GstSlab });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Delivery zones                                                       */
/* ------------------------------------------------------------------ */

export interface ZoneInput {
  zoneId?: string;
  name: string;
  geometryJson: string;
  storeIds: string[];
  baseDeliveryFee: Paise;
  freeDeliveryAbove: Paise;
  surgeMultiplierBps: number;
  isActive: boolean;
}

export function rectangleGeometry(south: number, west: number, north: number, east: number): string {
  if (![south, west, north, east].every(Number.isFinite) || south >= north || west >= east) throw new ComplianceError('BAD_ZONE', 'South must be below north and west left of east');
  return JSON.stringify({ type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
}

export function validateZone(i: ZoneInput, knownStoreIds: string[]): ZoneInput & { geometry: ZoneGeometry } {
  const name = String(i.name ?? '').trim();
  if (name.length < 2 || name.length > 60) throw new ComplianceError('BAD_ZONE', 'Give the zone a name');
  let geometry: ZoneGeometry;
  try {
    geometry = parseZoneGeometry(i.geometryJson);
  } catch (e) {
    throw new ComplianceError('BAD_ZONE', e instanceof Error ? e.message : 'Area is not valid GeoJSON');
  }
  if (i.geometryJson.length > 200_000) throw new ComplianceError('BAD_ZONE', 'Area outline is too detailed');
  const storeIds = [...new Set(i.storeIds ?? [])];
  if (!storeIds.length) throw new ComplianceError('BAD_ZONE', 'Pick at least one store that delivers in this zone');
  const unknown = storeIds.filter((s) => !knownStoreIds.includes(s));
  if (unknown.length) throw new ComplianceError('BAD_ZONE', `Unknown or non-delivery store: ${unknown.join(', ')}`);
  for (const [k, v] of [['Delivery fee', i.baseDeliveryFee], ['Free delivery above', i.freeDeliveryAbove]] as const) {
    if (!Number.isSafeInteger(v) || v < 0 || v > 100_000_00) throw new ComplianceError('BAD_ZONE', `${k} must be a rupee amount`);
  }
  if (!Number.isInteger(i.surgeMultiplierBps) || i.surgeMultiplierBps < 10_000 || i.surgeMultiplierBps > 30_000) throw new ComplianceError('BAD_ZONE', 'Surge must be between 1.0× and 3.0×');
  return { ...i, name, storeIds, isActive: !!i.isActive, geometry };
}
