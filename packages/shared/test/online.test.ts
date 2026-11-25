import { describe, expect, it } from 'vitest';
import {
  canTransition,
  checkOnlinePayment,
  classify,
  customerCanCancel,
  deliveryCharge,
  deliveryFee,
  DEMO_ZONES,
  extractOrderId,
  hashDeliveryOtp,
  newDeliveryOtp,
  nextForwardStatus,
  OrderError,
  parseZoneGeometry,
  planCancelRestock,
  planSale,
  pointInGeometry,
  reply,
  type BatchState,
  type SaleSnapshot,
} from '../src/index.js';

const NOW = Date.parse('2026-11-24T06:00:00Z');
const DAY = 86_400_000;
const b = (id: string, qty: number, days: number, recalled = false): BatchState => ({ batchId: id, batchNumber: id.toUpperCase(), mfgMs: null, expiryMs: NOW + days * DAY, receivedMs: NOW - DAY, qty, recalled, purchasePrice: 5000, mrp: 9500 });

const snap = (): SaleSnapshot => ({
  nowMs: NOW,
  store: { storeId: 'S1', vendorId: 'V1', name: 'Johari', stateCode: '08', addressLine: 'Johari Bazaar', city: 'Jaipur', pincode: '302003', gstin: null, fssaiLicenseNo: null, isActive: true },
  vendor: { vendorId: 'V1', legalName: 'PX LLP', tradeName: 'PX', gstin: '27AAPFU0939F1ZV', fssaiLicenseNo: null, stateCode: '08', invoicePrefix: 'PX', registeredAddress: 'Jaipur' },
  products: { kapur: { productId: 'kapur', name: 'Kapur', hsnCode: '2914', gstSlab: 18, cessRate: 0, taxType: 'INCLUSIVE', unit: 'PAC', complianceStatus: 'APPROVED' } },
  inventory: { kapur: { productId: 'kapur', productName: 'Kapur', sellingPrice: 8500, mrp: 9500, onHand: 13, reorderThreshold: 5, aisleBinCode: 'A1', isListed: true } },
  batches: { kapur: [b('late', 10, 200), b('early', 3, 20)] },
  counterLastSeq: 0,
});

describe('online orders', () => {
  it('charges delivery below the free threshold, with surge, and waives it above', () => {
    const z = { baseDeliveryFee: 2500, freeDeliveryAbove: 49_900, surgeMultiplierBps: 10_000 };
    expect(deliveryFee(20_000, z)).toBe(2500);
    expect(deliveryFee(49_900, z)).toBe(0);
    expect(deliveryFee(20_000, { ...z, surgeMultiplierBps: 15_000 })).toBe(3750);
    expect(deliveryCharge(60_000, z)).toEqual([]);
  });

  it('bills the delivery charge as an 18% SAC line, with IGST for another state', () => {
    const charges = deliveryCharge(17_000, { baseDeliveryFee: 2500, freeDeliveryAbove: 49_900, surgeMultiplierBps: 10_000 });
    const intra = planSale({ channel: 'ONLINE', items: [{ productId: 'kapur', qty: 2 }], payment: { method: 'COD', status: 'PENDING', providerRef: null }, buyer: { placeOfSupplyStateCode: '08' }, actorUid: 'c1', charges }, snap());
    expect(intra.computation.lines).toHaveLength(2);
    const fee = intra.computation.lines[1]!;
    expect(fee.hsnCode).toBe('996813');
    expect(fee.total).toBe(2500);
    expect(fee.cgst).toBe(fee.sgst);
    expect(fee.taxable + fee.cgst + fee.sgst).toBe(2500);
    expect(Math.abs(fee.taxable - 2119)).toBeLessThanOrEqual(1);
    expect(intra.computation.totals.grandTotal).toBe(17_000 + 2500);
    expect(intra.ledger.every((l) => l.movement === 'ONLINE_SALE')).toBe(true);

    const inter = planSale({ channel: 'ONLINE', items: [{ productId: 'kapur', qty: 1 }], payment: { method: 'COD', status: 'PENDING', providerRef: null }, buyer: { placeOfSupplyStateCode: '09' }, actorUid: 'c1', charges }, snap());
    expect(inter.computation.supplyType).toBe('INTER_STATE');
    expect(inter.computation.totals.igst).toBeGreaterThan(0);
  });

  it('ignores charges on counter sales', () => {
    const p = planSale({ channel: 'POS_WALKIN', items: [{ productId: 'kapur', qty: 1 }], payment: { method: 'CASH', status: 'PAID', providerRef: null }, actorUid: 's', charges: [{ code: 'DELIVERY', name: 'x', sac: '996813', amount: 2500, gstSlab: 18 }] }, snap());
    expect(p.computation.lines).toHaveLength(1);
  });

  it('restocks a cancelled order into the exact batches it came from', () => {
    const s = snap();
    const sale = planSale({ channel: 'ONLINE', items: [{ productId: 'kapur', qty: 5 }], payment: { method: 'WALLET', status: 'PAID', providerRef: null }, actorUid: 'c1' }, s);
    expect(sale.lines[0]!.batchAllocations).toEqual([{ batchId: 'early', qty: 3 }, { batchId: 'late', qty: 2 }]);
    const after = { kapur: s.batches.kapur!.map((x) => ({ ...x, qty: sale.batchWrites.find((w) => w.batchId === x.batchId)!.qty })) };
    const r = planCancelRestock(sale.lines, { nowMs: NOW, batches: after, reorderThreshold: { kapur: 5 } });
    expect(r.batchWrites).toEqual([{ productId: 'kapur', batchId: 'early', qty: 3 }, { productId: 'kapur', batchId: 'late', qty: 10 }]);
    expect(r.ledger.map((l) => [l.movement, l.qtyDelta, l.balanceAfter])).toEqual([['ORDER_CANCEL_RESTOCK', 3, 11], ['ORDER_CANCEL_RESTOCK', 2, 13]]);
    expect(r.inventoryWrites[0]!.onHand).toBe(13);
  });

  it('enforces the status machine and cancel windows', () => {
    expect(canTransition('PLACED', 'ACCEPTED')).toBe(true);
    expect(canTransition('PACKED', 'DELIVERED')).toBe(false);
    expect(canTransition('OUT_FOR_DELIVERY', 'CANCELLED')).toBe(false);
    expect(nextForwardStatus('PACKED')).toBe('OUT_FOR_DELIVERY');
    expect(nextForwardStatus('DELIVERED')).toBeNull();
    expect(customerCanCancel('ACCEPTED')).toBe(true);
    expect(customerCanCancel('PICKING')).toBe(false);
  });

  it('checks payment rules', () => {
    expect(() => checkOnlinePayment('COD', 50_000, 350_000, 0)).toThrow(OrderError);
    expect(() => checkOnlinePayment('WALLET', 20_000, 20_000, 10_000)).toThrow(/Wallet/);
    expect(() => checkOnlinePayment('UPI_INTENT', 5_000, 7_500, 0)).toThrow(/Minimum/);
    expect(() => checkOnlinePayment('CASH', 20_000, 20_000, 0)).toThrow(/payment method/);
    expect(() => checkOnlinePayment('UPI_INTENT', 20_000, 22_500, 0)).not.toThrow();
  });

  it('makes 4-digit delivery codes and hashes them per order', async () => {
    const otp = newDeliveryOtp();
    expect(otp).toMatch(/^\d{4}$/);
    expect(await hashDeliveryOtp('o-1', otp)).not.toBe(await hashDeliveryOtp('o-2', otp));
  });

  it('demo zones cover Johari Bazaar and Malviya Nagar but not Vaishali Nagar', () => {
    const z = DEMO_ZONES.map((x) => parseZoneGeometry(x.geometryJson));
    const inAny = (p: { lat: number; lng: number }) => z.some((g) => pointInGeometry(p, g));
    expect(inAny({ lat: 26.9196, lng: 75.8267 })).toBe(true);
    expect(inAny({ lat: 26.8549, lng: 75.8243 })).toBe(true);
    expect(inAny({ lat: 26.9115, lng: 75.7398 })).toBe(false);
  });
});

describe('support chatbot', () => {
  it('understands English and Hinglish', () => {
    expect(classify('Where is my order?', 'customer').intent).toBe('order_status');
    expect(classify('mera order kahan hai', 'customer').intent).toBe('order_status');
    expect(classify('saman toota hua aaya', 'customer').intent).toBe('damaged');
    expect(classify('kesar available hai kya', 'customer').intent).toBe('stock_check');
    expect(classify('what are the delivery charges', 'customer').intent).toBe('delivery_fee');
    expect(classify('upi payment failed but money deducted', 'customer').intent).toBe('payment_failed');
    expect(classify('hsn for almonds', 'seller').intent).toBe('hsn_help');
    expect(classify('show low stock', 'staff').intent).toBe('low_stock');
  });

  it('keeps operator topics away from customers', () => {
    expect(classify('show low stock', 'customer').intent).not.toBe('low_stock');
  });

  it('returns actions for live data and escalates', () => {
    expect(reply('order o-3fab2 status', { role: 'customer', misses: 0 }).actions[0]).toEqual({ type: 'ORDER_STATUS', orderId: 'o-3fab2' });
    expect(reply('is kesar available', { role: 'customer', misses: 0 }).actions[0]).toEqual({ type: 'STOCK_CHECK', query: 'kesar' });
    expect(reply('talk to a person', { role: 'customer', misses: 0 }).escalate).toBe(true);
    expect(reply('asdf qwer', { role: 'customer', misses: 0 }).escalate).toBe(false);
    expect(reply('asdf qwer', { role: 'customer', misses: 1 }).escalate).toBe(true);
    expect(extractOrderId('no id here')).toBeUndefined();
  });
});
