import { describe, expect, it } from 'vitest';
import {
  buildPickList,
  checkAssignRider,
  checkRiderStep,
  compareBins,
  ComplianceError,
  countVariance,
  kycMissing,
  matchScan,
  parseBatchList,
  planCodDeposit,
  planRecall,
  planRiderDelivered,
  pointInGeometry,
  parseZoneGeometry,
  productsAffectedByHsn,
  recalledInOrder,
  rectangleGeometry,
  resolveHsn,
  RIDER_COD_CASH_LIMIT,
  RIDER_KYC_DOCS,
  RIDER_PAY_PER_DROP,
  RiderError,
  riderNextStatus,
  rollupKyc,
  validateHsn,
  validateZone,
  type BatchState,
  type RiderState,
} from '../src/index.js';

const NOW = Date.UTC(2026, 10, 25, 6, 0, 0);
const DAY = 86_400_000;
const batch = (id: string, no: string, qty: number, expDays: number | null, recalled = false): BatchState => ({ batchId: id, batchNumber: no, mfgMs: NOW - 30 * DAY, expiryMs: expDays === null ? null : NOW + expDays * DAY, receivedMs: NOW - 20 * DAY, qty, recalled, purchasePrice: 1000, mrp: 2000 });

const rider = (p: Partial<RiderState> = {}): RiderState => ({ uid: 'r1', kycStatus: 'VERIFIED', isOnline: true, homeStoreId: 'S1', codCashInHand: 0, activeOrderIds: [], ...p });
const order = (p: Partial<Parameters<typeof checkAssignRider>[1]> = {}) => ({ orderId: 'o1', storeId: 'S1', status: 'PACKED' as const, paymentMethod: 'COD', paymentStatus: 'PENDING', grandTotal: 50_000, riderUid: null, ...p });

describe('riders', () => {
  it('assigns only verified, on-shift riders of the store, within order and cash limits', () => {
    expect(() => checkAssignRider(rider(), order())).not.toThrow();
    const code = (r: RiderState, o = order()) => {
      try {
        checkAssignRider(r, o);
        return 'OK';
      } catch (e) {
        return (e as RiderError).code;
      }
    };
    expect(code(rider({ kycStatus: 'UNDER_REVIEW' }))).toBe('KYC_NOT_VERIFIED');
    expect(code(rider({ isOnline: false }))).toBe('OFF_SHIFT');
    expect(code(rider({ homeStoreId: 'S2' }))).toBe('WRONG_STORE');
    expect(code(rider({ activeOrderIds: ['a', 'b', 'c'] }))).toBe('TOO_MANY_ORDERS');
    expect(code(rider({ activeOrderIds: ['a', 'b', 'o1'] }))).toBe('OK'); // re-assigning the same order
    expect(code(rider({ codCashInHand: RIDER_COD_CASH_LIMIT - 10_000 }))).toBe('COD_CASH_LIMIT');
    expect(code(rider({ codCashInHand: RIDER_COD_CASH_LIMIT - 10_000 }), order({ paymentMethod: 'WALLET', paymentStatus: 'PAID' }))).toBe('OK');
    expect(code(rider(), order({ status: 'PLACED' }))).toBe('BAD_STATUS');
    expect(code(rider(), order({ status: 'HANDED_TO_RIDER' }))).toBe('BAD_STATUS');
  });

  it('rider steps: pick up → start → deliver, only on their own order', () => {
    expect(riderNextStatus('PACKED')).toBe('HANDED_TO_RIDER');
    expect(riderNextStatus('HANDED_TO_RIDER')).toBe('OUT_FOR_DELIVERY');
    expect(riderNextStatus('OUT_FOR_DELIVERY')).toBe('DELIVERED');
    expect(riderNextStatus('PICKING')).toBeNull();
    expect(() => checkRiderStep('r1', { riderUid: 'r1', status: 'PACKED' }, 'HANDED_TO_RIDER')).not.toThrow();
    expect(() => checkRiderStep('r2', { riderUid: 'r1', status: 'PACKED' }, 'HANDED_TO_RIDER')).toThrow(/not assigned to you/);
    expect(() => checkRiderStep('r1', { riderUid: 'r1', status: 'PICKING' }, 'HANDED_TO_RIDER')).toThrow(/still packing/);
    expect(() => checkRiderStep('r1', { riderUid: 'r1', status: 'PACKED' }, 'DELIVERED')).toThrow(RiderError);
  });

  it('COD delivery adds cash in hand; deposits cannot exceed it', () => {
    const d = planRiderDelivered(rider({ codCashInHand: 10_000, activeOrderIds: ['o1', 'o2'] }), { orderId: 'o1', paymentMethod: 'COD', paymentStatus: 'PENDING', grandTotal: 19_500 });
    expect(d).toEqual({ cashCollected: 19_500, codCashInHand: 29_500, activeOrderIds: ['o2'], earning: RIDER_PAY_PER_DROP });
    expect(planRiderDelivered(rider(), { orderId: 'o1', paymentMethod: 'UPI_INTENT', paymentStatus: 'PAID', grandTotal: 19_500 }).cashCollected).toBe(0);
    expect(planCodDeposit(29_500, 20_000).codCashInHand).toBe(9_500);
    expect(() => planCodDeposit(29_500, 30_000)).toThrow(/holds only/);
    expect(() => planCodDeposit(29_500, 0)).toThrow(/amount/);
    expect(() => planCodDeposit(29_500, 10.5)).toThrow(/amount/);
  });

  it('KYC roll-up uses the newest upload of each required document', () => {
    const d = (docType: (typeof RIDER_KYC_DOCS)[number], status: 'PENDING' | 'VERIFIED' | 'REJECTED', t: number) => ({ docType, status, createdMs: t });
    expect(rollupKyc([], RIDER_KYC_DOCS)).toBe('PENDING');
    expect(rollupKyc([d('DRIVING_LICENSE', 'PENDING', 1)], RIDER_KYC_DOCS)).toBe('PENDING');
    const all = [d('DRIVING_LICENSE', 'VERIFIED', 1), d('VEHICLE_RC', 'PENDING', 1), d('AADHAAR_MASKED', 'PENDING', 1)];
    expect(rollupKyc(all, RIDER_KYC_DOCS)).toBe('UNDER_REVIEW');
    const rejected = [...all.slice(0, 2), d('AADHAAR_MASKED', 'REJECTED', 1)];
    expect(rollupKyc(rejected, RIDER_KYC_DOCS)).toBe('REJECTED');
    expect(kycMissing(rejected, RIDER_KYC_DOCS)).toEqual(['AADHAAR_MASKED']);
    const fixed = [...rejected, d('AADHAAR_MASKED', 'VERIFIED', 2), d('VEHICLE_RC', 'VERIFIED', 2)];
    expect(rollupKyc(fixed, RIDER_KYC_DOCS)).toBe('VERIFIED');
    expect(kycMissing(fixed, RIDER_KYC_DOCS)).toEqual([]);
  });
});

describe('picking', () => {
  it('sorts bins naturally and lists the reserved FEFO batch numbers', () => {
    expect(['A10-R1', 'A2-R1', '', 'A2-R10', 'A2-R2'].sort(compareBins)).toEqual(['A2-R1', 'A2-R2', 'A2-R10', 'A10-R1', '']);
    const list = buildPickList(
      [
        { productId: 'p2', name: 'Kesar', qty: 1, unit: 'NOS', batchAllocations: [{ batchId: 'b3', qty: 1 }] },
        { productId: 'p1', name: 'Kapur', qty: 3, unit: 'PAC', batchAllocations: [{ batchId: 'b1', qty: 2 }, { batchId: 'b2', qty: 1 }] },
        { productId: 'charge:DELIVERY', name: 'Delivery', qty: 1, unit: 'OTH', batchAllocations: [] },
      ],
      {
        p1: { aisleBinCode: 'A2-R1', barcode: '890100', batches: [{ batchId: 'b1', batchNumber: 'K-01', expiryMs: NOW + DAY }, { batchId: 'b2', batchNumber: 'K-02', expiryMs: null }] },
        p2: { aisleBinCode: 'B1-R3', barcode: null, batches: [{ batchId: 'b3', batchNumber: 'S-9', expiryMs: null }] },
      },
    );
    expect(list.map((l) => l.productId)).toEqual(['p1', 'p2']);
    expect(list[0]!.batches.map((b) => `${b.batchNumber}×${b.qty}`)).toEqual(['K-01×2', 'K-02×1']);
    expect(matchScan(list, ' 890100 ')?.productId).toBe('p1');
    expect(matchScan(list, 'p2')?.productId).toBe('p2');
    expect(matchScan(list, 'nope')).toBeNull();
  });

  it('cycle count variance lists only batches that differ', () => {
    const v = countVariance([
      { batchId: 'b1', batchNumber: 'K-01', systemQty: 10, countedQty: 8 },
      { batchId: 'b2', batchNumber: 'K-02', systemQty: 4, countedQty: 4 },
      { batchId: 'b3', batchNumber: 'K-03', systemQty: 1.25, countedQty: 1.5 },
      { batchId: 'b4', batchNumber: 'K-04', systemQty: 5, countedQty: null },
    ]);
    expect(v.counted).toBe(3);
    expect(v.changed.map((c) => [c.batchId, c.delta])).toEqual([['b1', -2], ['b3', 0.25]]);
    expect(v.netDelta).toBe(-1.75);
  });
});

describe('compliance', () => {
  it('recall pulls matching batches in every store and writes ledger lines', () => {
    const r = planRecall(
      'p1',
      parseBatchList('k-01, K-03\nk-01'),
      [
        { storeId: 'S1', reorderThreshold: 2, batches: [batch('b1', 'K-01', 5, 30), batch('b2', 'K-02', 4, 60)] },
        { storeId: 'S2', reorderThreshold: 2, batches: [batch('b3', 'K-03', 2, 30), batch('b4', 'K-01', 0, 30)] },
        { storeId: 'G1', reorderThreshold: 2, batches: [batch('b5', 'K-09', 9, 30)] },
      ],
      NOW,
    );
    expect(r.wholeProduct).toBe(false);
    expect(r.unitsRemoved).toBe(7);
    expect(r.matchedBatchIds.sort()).toEqual(['b1', 'b3', 'b4']);
    expect(r.stores.map((s) => s.storeId)).toEqual(['S1', 'S2']);
    const s1 = r.stores[0]!;
    expect(s1.inventory.onHand).toBe(4);
    expect(s1.inventory.nextBatchNumber).toBe('K-02');
    expect(s1.ledger).toEqual([{ productId: 'p1', batchId: 'b1', movement: 'RECALL_REMOVAL', qtyDelta: -5, balanceAfter: 4 }]);
    expect(r.stores[1]!.ledger).toHaveLength(1); // the empty K-01 batch is flagged but writes no ledger line
    expect(r.stores[1]!.batchWrites).toHaveLength(2);
  });

  it('whole-product recall and nothing-to-recall', () => {
    const all = planRecall('p1', [], [{ storeId: 'S1', reorderThreshold: 0, batches: [batch('b1', 'A', 1, 10), batch('b2', 'B', 2, null)] }], NOW);
    expect(all.wholeProduct).toBe(true);
    expect(all.unitsRemoved).toBe(3);
    expect(all.stores[0]!.inventory.onHand).toBe(0);
    expect(() => planRecall('p1', ['ZZ'], [{ storeId: 'S1', reorderThreshold: 0, batches: [batch('b1', 'A', 1, 10)] }], NOW)).toThrow(ComplianceError);
  });

  it('blocks dispatch of orders holding a recalled batch', () => {
    const lines = [
      { productId: 'p1', name: 'Kapur', batchAllocations: [{ batchId: 'b1' }] },
      { productId: 'p2', name: 'Kesar', batchAllocations: [{ batchId: 'b9' }] },
    ];
    expect(recalledInOrder(lines, new Set(['b9']))).toEqual(['Kesar']);
    expect(recalledInOrder(lines, new Set())).toEqual([]);
  });

  it('HSN master: validation, most-specific match, products whose rate changes', () => {
    expect(validateHsn({ hsnCode: ' 0802 ', description: 'Nuts', gstSlab: 12 }).hsnCode).toBe('0802');
    expect(() => validateHsn({ hsnCode: '080', description: 'Nuts', gstSlab: 12 })).toThrow(/4, 6 or 8/);
    expect(() => validateHsn({ hsnCode: '0802', description: 'Nuts', gstSlab: 7 })).toThrow(/GST rate/);
    const master = [{ hsnCode: '0802', gstSlab: 12 }, { hsnCode: '080211', gstSlab: 5 }];
    expect(resolveHsn('08021100', master)?.gstSlab).toBe(5);
    expect(resolveHsn('08029000', master)?.gstSlab).toBe(12);
    expect(resolveHsn('0901', master)).toBeNull();
    const affected = productsAffectedByHsn(
      [
        { productId: 'almond', hsnCode: '08021100', gstSlab: 12 },
        { productId: 'walnut', hsnCode: '08023100', gstSlab: 12 },
      ],
      master,
    );
    expect(affected).toEqual([{ productId: 'almond', from: 12, to: 5 }]);
  });

  it('zones: rectangle helper and validation', () => {
    const g = rectangleGeometry(26.8, 75.7, 26.9, 75.8);
    expect(pointInGeometry({ lat: 26.85, lng: 75.75 }, parseZoneGeometry(g))).toBe(true);
    expect(() => rectangleGeometry(26.9, 75.7, 26.8, 75.8)).toThrow(/South/);
    const base = { name: 'Raja Park', geometryJson: g, storeIds: ['S1'], baseDeliveryFee: 2500, freeDeliveryAbove: 49_900, surgeMultiplierBps: 10_000, isActive: true };
    expect(validateZone(base, ['S1', 'S2']).geometry.type).toBe('Polygon');
    expect(() => validateZone({ ...base, storeIds: ['G1'] }, ['S1', 'S2'])).toThrow(/Unknown/);
    expect(() => validateZone({ ...base, storeIds: [] }, ['S1'])).toThrow(/at least one store/);
    expect(() => validateZone({ ...base, surgeMultiplierBps: 9000 }, ['S1'])).toThrow(/Surge/);
    expect(() => validateZone({ ...base, geometryJson: '{"type":"Point"}' }, ['S1'])).toThrow(ComplianceError);
    expect(() => validateZone({ ...base, baseDeliveryFee: -1 }, ['S1'])).toThrow(/Delivery fee/);
  });
});
