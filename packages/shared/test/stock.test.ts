import { describe, expect, it } from 'vitest';
import { allocateFefo, deriveInventory, planAdjust, planInward, planSale, StockError, summarizeGstr1, type BatchState, type SaleSnapshot } from '../src/index.js';

const NOW = Date.parse('2026-11-24T06:00:00Z');
const DAY = 86_400_000;

const batch = (id: string, qty: number, expiryInDays: number | null, extra: Partial<BatchState> = {}): BatchState => ({
  batchId: id,
  batchNumber: id.toUpperCase(),
  mfgMs: NOW - 30 * DAY,
  expiryMs: expiryInDays === null ? null : NOW + expiryInDays * DAY,
  receivedMs: NOW - 10 * DAY,
  qty,
  recalled: false,
  purchasePrice: 6000,
  mrp: 9500,
  ...extra,
});

function snapshot(over: Partial<SaleSnapshot> = {}): SaleSnapshot {
  return {
    nowMs: NOW,
    store: { storeId: 'S1', vendorId: 'V1', name: 'Johari Bazaar Store', stateCode: '08', addressLine: 'Johari Bazaar', city: 'Jaipur', pincode: '302003', gstin: null, fssaiLicenseNo: null, isActive: true },
    vendor: { vendorId: 'V1', legalName: 'Pansari Express Retail LLP', tradeName: 'Pansari Express', gstin: '27AAPFU0939F1ZV', fssaiLicenseNo: '12226999000123', stateCode: '08', invoicePrefix: 'PX', registeredAddress: 'Jaipur' },
    products: {
      kapur: { productId: 'kapur', name: 'Kapur 50 g', hsnCode: '2914', gstSlab: 18, cessRate: 0, taxType: 'INCLUSIVE', unit: 'PAC', complianceStatus: 'APPROVED' },
      supari: { productId: 'supari', name: 'Supari loose', hsnCode: '0802', gstSlab: 5, cessRate: 0, taxType: 'INCLUSIVE', unit: 'KGS', complianceStatus: 'PENDING_REVIEW' },
    },
    inventory: {
      kapur: { productId: 'kapur', productName: 'Kapur 50 g', sellingPrice: 8500, mrp: 9500, onHand: 15, reorderThreshold: 5, aisleBinCode: 'A1', isListed: true },
      supari: { productId: 'supari', productName: 'Supari loose', sellingPrice: 56000, mrp: 60000, onHand: 3, reorderThreshold: 1, aisleBinCode: 'B2', isListed: true },
    },
    batches: {
      kapur: [batch('late', 10, 200), batch('early', 3, 20), batch('expired', 4, -1), batch('recalled', 9, 50, { recalled: true })],
      supari: [batch('s1', 3, 90, { mrp: 60000 })],
    },
    counterLastSeq: 41,
    ...over,
  };
}

describe('FEFO + derived inventory', () => {
  it('sells the earliest expiry first and skips expired/recalled batches', () => {
    const b = snapshot().batches.kapur!;
    const { allocations, shortBy } = allocateFefo(b, 5, NOW);
    expect(allocations.map((a) => [a.batchId, a.qty])).toEqual([['early', 3], ['late', 2]]);
    expect(shortBy).toBe(0);
    const d = deriveInventory(b, 5, NOW);
    expect(d).toMatchObject({ onHand: 17, sellable: 13, nextBatchNumber: 'EARLY', lowStock: false, expiringSoon: false });
    expect(deriveInventory([batch('x', 2, 10)], 5, NOW)).toMatchObject({ lowStock: true, expiringSoon: true });
  });
});

describe('planSale', () => {
  it('plans a counter sale: FEFO writes, ledger, next invoice number, intra-state tax', () => {
    const plan = planSale({ channel: 'POS_WALKIN', items: [{ productId: 'kapur', qty: 4 }, { productId: 'kapur', qty: 1 }], payment: { method: 'CASH', status: 'PAID', providerRef: null }, actorUid: 'staff1' }, snapshot());
    expect(plan.invoiceNo).toBe('PX/26-27/000042');
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]!.batchAllocations).toEqual([{ batchId: 'early', qty: 3 }, { batchId: 'late', qty: 2 }]);
    expect(plan.batchWrites).toEqual([{ productId: 'kapur', batchId: 'early', qty: 0 }, { productId: 'kapur', batchId: 'late', qty: 8 }]);
    expect(plan.ledger.map((l) => [l.movement, l.qtyDelta, l.balanceAfter])).toEqual([['POS_WALKIN_SALE', -3, 14], ['POS_WALKIN_SALE', -2, 12]]);
    expect(plan.inventoryWrites[0]).toMatchObject({ onHand: 12, sellable: 8, nextBatchNumber: 'LATE' });
    expect(plan.computation.supplyType).toBe('INTRA_STATE');
    expect(plan.computation.totals.grandTotal).toBe(42500);
    expect(plan.computation.lines[0]!.batchNumber).toBe('EARLY');
  });

  it('keeps counter sales intra-state even for an out-of-state GSTIN buyer, but not online deliveries', () => {
    const buyer = { gstin: '27AAPFU0939F1ZV', placeOfSupplyStateCode: '27' };
    const counter = planSale({ channel: 'POS_WALKIN', items: [{ productId: 'kapur', qty: 1 }], payment: { method: 'CASH', status: 'PAID', providerRef: null }, buyer, actorUid: 'u' }, snapshot());
    expect(counter.computation.kind).toBe('B2B');
    expect(counter.computation.supplyType).toBe('INTRA_STATE');
    const online = planSale({ channel: 'ONLINE', items: [{ productId: 'kapur', qty: 1 }], payment: { method: 'UPI_INTENT', status: 'PAID', providerRef: 'x' }, buyer, actorUid: 'u' }, snapshot());
    expect(online.computation.supplyType).toBe('INTER_STATE');
  });

  it('refuses out-of-stock, unlisted/unapproved (for guests), above-MRP and bad quantities', () => {
    const req = (productId: string, qty: number, channel: 'POS_WALKIN' | 'OFFLINE_QR' = 'POS_WALKIN') => planSale({ channel, items: [{ productId, qty }], payment: { method: 'CASH', status: 'PAID', providerRef: null }, actorUid: 'u' }, snapshot());
    expect(() => req('kapur', 14)).toThrow(StockError);
    try {
      req('kapur', 14);
    } catch (e) {
      expect((e as StockError).code).toBe('OUT_OF_STOCK');
      expect((e as StockError).available).toBe(13);
    }
    expect(() => req('supari', 0.25, 'OFFLINE_QR')).toThrow(/not available/);
    expect(req('supari', 0.25).computation.lines[0]!.qty).toBe(0.25);
    expect(() => req('kapur', 1.5)).toThrow(/Invalid quantity/);
    const s = snapshot();
    s.inventory.kapur!.sellingPrice = 9900;
    expect(() => planSale({ channel: 'POS_WALKIN', items: [{ productId: 'kapur', qty: 1 }], payment: { method: 'CASH', status: 'PAID', providerRef: null }, actorUid: 'u' }, s)).toThrow(/above its MRP/);
  });
});

describe('planInward + planAdjust', () => {
  const base = { nowMs: NOW, unit: 'PAC' as const, reorderThreshold: 5 };
  it('adds a new batch or tops up a matching one, refusing conflicts and expired stock', () => {
    const p = planInward({ productId: 'kapur', batchNumber: 'K-26', mfgMs: NOW - DAY, expiryMs: NOW + 300 * DAY, qty: 20, purchasePrice: 6000, mrp: 9500, reference: 'BILL-77' }, { ...base, batches: [], newBatchId: 'b-new' });
    expect(p.isNewBatch).toBe(true);
    expect(p.ledger).toMatchObject({ movement: 'INWARD_PO', qtyDelta: 20, balanceAfter: 20 });
    const top = planInward({ productId: 'kapur', batchNumber: 'k-26', mfgMs: NOW - DAY, expiryMs: NOW + 300 * DAY, qty: 5, purchasePrice: 6000, mrp: 9500, reference: 'BILL-78' }, { ...base, batches: [p.batch], newBatchId: 'unused' });
    expect(top.isNewBatch).toBe(false);
    expect(top.batch.qty).toBe(25);
    expect(() => planInward({ productId: 'kapur', batchNumber: 'K-26', mfgMs: null, expiryMs: NOW + 10 * DAY, qty: 5, purchasePrice: 6000, mrp: 9500, reference: 'x' }, { ...base, batches: [p.batch], newBatchId: 'n' })).toThrow(/different expiry/);
    expect(() => planInward({ productId: 'kapur', batchNumber: 'OLD', mfgMs: null, expiryMs: NOW - DAY, qty: 5, purchasePrice: 6000, mrp: 9500, reference: 'x' }, { ...base, batches: [], newBatchId: 'n' })).toThrow(/expired/);
  });
  it('handles damage, returns and cycle counts with reasons', () => {
    const bs = [batch('a', 10, 100)];
    expect(planAdjust({ productId: 'kapur', batchId: 'a', movement: 'DAMAGED_WRITE_OFF', qty: 2, reason: 'Packet torn' }, { ...base, batches: bs }).ledger).toMatchObject({ qtyDelta: -2, balanceAfter: 8 });
    expect(planAdjust({ productId: 'kapur', batchId: 'a', movement: 'CYCLE_COUNT_ADJUSTMENT', countedQty: 7, reason: 'Monthly count' }, { ...base, batches: bs }).ledger.qtyDelta).toBe(-3);
    expect(planAdjust({ productId: 'kapur', batchId: 'a', movement: 'CUSTOMER_RETURN', qty: 1, reason: 'Unopened return' }, { ...base, batches: bs }).batch.qty).toBe(11);
    expect(() => planAdjust({ productId: 'kapur', batchId: 'a', movement: 'DAMAGED_WRITE_OFF', qty: 11, reason: 'x torn' }, { ...base, batches: bs })).toThrow(/Only 10/);
    expect(() => planAdjust({ productId: 'kapur', batchId: 'a', movement: 'DAMAGED_WRITE_OFF', qty: 1, reason: '' }, { ...base, batches: bs })).toThrow(/reason/);
  });
});

describe('GSTR-1 summary', () => {
  it('splits B2B, B2CS and HSN tables and lists the document range', () => {
    const b2c = planSale({ channel: 'POS_WALKIN', items: [{ productId: 'kapur', qty: 2 }], payment: { method: 'CASH', status: 'PAID', providerRef: null }, actorUid: 'u' }, snapshot());
    const b2b = planSale({ channel: 'POS_WALKIN', items: [{ productId: 'kapur', qty: 1 }], payment: { method: 'CASH', status: 'PAID', providerRef: null }, buyer: { gstin: '27AAPFU0939F1ZV' }, actorUid: 'u' }, snapshot({ counterLastSeq: 42 }));
    const s = summarizeGstr1(
      [
        { invoiceNo: b2c.invoiceNo, issuedMs: NOW, kind: 'B2C', buyerGstin: null, placeOfSupplyStateCode: '08', computation: b2c.computation },
        { invoiceNo: b2b.invoiceNo, issuedMs: NOW + 1, kind: 'B2B', buyerGstin: '27AAPFU0939F1ZV', placeOfSupplyStateCode: '08', computation: b2b.computation },
      ],
      { fromMs: NOW - DAY, toMs: NOW + DAY, b2clThreshold: 1_00_000_00 },
    );
    expect(s.b2b).toHaveLength(1);
    expect(s.b2cs).toEqual([expect.objectContaining({ pos: '08', rate: 18, supplyType: 'INTRA_STATE' })]);
    expect(s.hsnB2B[0]!.qty).toBe(1);
    expect(s.hsnB2C[0]!.qty).toBe(2);
    expect(s.documents).toEqual({ from: 'PX/26-27/000042', to: 'PX/26-27/000043', issued: 2, cancelled: 0 });
    expect(s.totals.invoiceValue).toBe(25500);
  });
});
