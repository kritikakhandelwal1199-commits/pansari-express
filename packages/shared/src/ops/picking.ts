/**
 * Picking and stock counts for the staff app (Phase 4).
 */
import type { Uqc } from '../schema.js';
import type { BatchState } from '../inventory/stock.js';

/** Natural sort for bin codes like "A3-R2-B05" so A2 comes before A10. Empty bins go last. */
export function compareBins(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

export interface PickLine {
  productId: string;
  name: string;
  qty: number;
  unit: Uqc;
  aisleBinCode: string;
  barcode: string | null;
  /** Which batches to take from, first-expiry-first, as reserved when the order was placed. */
  batches: { batchNumber: string; qty: number; expiryMs: number | null }[];
}

/**
 * Builds the walk order for a picker: lines sorted by shelf bin, each with the
 * exact batch numbers FEFO reserved — so the picker takes the packet that was billed.
 */
export function buildPickList(
  lines: { productId: string; name: string; qty: number; unit: Uqc; batchAllocations: { batchId: string; qty: number }[] }[],
  shelf: Record<string, { aisleBinCode: string; barcode: string | null; batches: Pick<BatchState, 'batchId' | 'batchNumber' | 'expiryMs'>[] }>,
): PickLine[] {
  return lines
    .filter((l) => !l.productId.startsWith('charge:'))
    .map((l) => {
      const s = shelf[l.productId];
      return {
        productId: l.productId,
        name: l.name,
        qty: l.qty,
        unit: l.unit,
        aisleBinCode: s?.aisleBinCode ?? '',
        barcode: s?.barcode ?? null,
        batches: l.batchAllocations.map((a) => {
          const b = s?.batches.find((x) => x.batchId === a.batchId);
          return { batchNumber: b?.batchNumber ?? a.batchId, qty: a.qty, expiryMs: b?.expiryMs ?? null };
        }),
      };
    })
    .sort((a, b) => compareBins(a.aisleBinCode, b.aisleBinCode) || a.name.localeCompare(b.name));
}

/** Matches a scanned code to a pick line (barcode first, then product id). */
export function matchScan(lines: PickLine[], code: string): PickLine | null {
  const c = code.trim();
  if (!c) return null;
  return lines.find((l) => l.barcode && l.barcode === c) ?? lines.find((l) => l.productId === c) ?? null;
}

export interface CountEntry {
  batchId: string;
  batchNumber: string;
  systemQty: number;
  countedQty: number | null;
}

/** Variance summary for a cycle count before it is posted. */
export function countVariance(entries: CountEntry[]): { counted: number; changed: { batchId: string; batchNumber: string; delta: number; countedQty: number }[]; netDelta: number } {
  const done = entries.filter((e) => e.countedQty !== null && Number.isFinite(e.countedQty) && e.countedQty >= 0);
  const changed = done
    .map((e) => ({ batchId: e.batchId, batchNumber: e.batchNumber, countedQty: e.countedQty!, delta: Math.round((e.countedQty! - e.systemQty) * 1000) / 1000 }))
    .filter((e) => e.delta !== 0);
  return { counted: done.length, changed, netDelta: Math.round(changed.reduce((a, e) => a + e.delta, 0) * 1000) / 1000 };
}
