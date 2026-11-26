import { describe, expect, it } from 'vitest';
import { DemoDataClient } from '@/lib/data/demo';

const fresh = () => new DemoDataClient({ storage: null, sessionStorage: null });
const login = async (c: DemoDataClient, phone: string) => c.verifyOtp((await c.sendOtp(phone)).verificationId, '123456');
const PRIYA = '+919999999994';
const OWNER = '+919999999991';

describe('demo backend — online delivery', () => {
  it('checks serviceability by pincode and location', async () => {
    const c = fresh();
    expect((await c.checkDelivery({ pincode: '302003' })).storeId).toBe('S1');
    expect((await c.checkDelivery({ pincode: '302017' })).storeId).toBe('S2');
    expect((await c.checkDelivery({ pincode: '305001' })).reason).toBe('OUTSIDE_ZONES');
    expect((await c.checkDelivery({ pincode: '110001' })).reason).toBe('UNKNOWN_PINCODE');
    const near = await c.checkDelivery({ pincode: '000000', location: { lat: 26.92, lng: 75.82 } });
    expect(near.serviceable).toBe(true);
    expect(near.etaMinutes).toBeLessThanOrEqual(10);
  });

  it('customer orders with delivery fee, store packs and dispatches, invoice issued at dispatch, OTP delivers', async () => {
    const c = fresh();
    await login(c, PRIYA);
    const prof = await c.myProfile();
    expect(prof.walletBalance).toBe(20_000);
    const addr = prof.addresses[0]!;
    const catalog = await c.shopCatalog('S1');
    expect(catalog.every((r) => r.product.complianceStatus === 'APPROVED' && r.sellingPrice > 0)).toBe(true);

    await expect(c.placeOrder({ addressId: addr.id, storeId: 'S2', items: [{ productId: 'kapur-50', qty: 2 }], paymentMethod: 'COD' })).rejects.toThrow(/another store/);
    await expect(c.placeOrder({ addressId: addr.id, storeId: 'S1', items: [{ productId: 'kapur-50', qty: 2 }], paymentMethod: 'UPI_INTENT', simulateOutcome: 'fail' })).rejects.toThrow(/declined/);

    const before = (await c.shopCatalog('S1')).find((r) => r.productId === 'kapur-50')!.onHand;
    const placed = await c.placeOrder({ addressId: addr.id, storeId: 'S1', items: [{ productId: 'kapur-50', qty: 2 }], paymentMethod: 'COD' });
    expect(placed.grandTotal).toBe(17_000 + 2_500); // ₹170 items + ₹25 delivery
    expect((await c.shopCatalog('S1')).find((r) => r.productId === 'kapur-50')!.onHand).toBe(before - 2);
    const mine = await c.getOrder(placed.orderId);
    expect(mine!.deliveryOtp).toMatch(/^\d{4}$/);
    expect(mine!.charges[0]!.amount).toBe(2_500);
    expect(mine!.invoiceNo).toBeNull();
    const otp = mine!.deliveryOtp!;

    await c.signOut();
    await login(c, OWNER);
    const queue = await c.listOnlineOrders('S1');
    expect(queue[0]!.orderId).toBe(placed.orderId);
    expect(queue[0]!.deliveryOtp).toBeNull();
    await expect(c.advanceOrder(placed.orderId, 'PACKED')).rejects.toThrow(/Cannot move/);
    for (const s of ['ACCEPTED', 'PICKING', 'PACKED'] as const) await c.advanceOrder(placed.orderId, s);
    const disp = await c.advanceOrder(placed.orderId, 'OUT_FOR_DELIVERY');
    expect(disp.invoiceNo).toMatch(/^PX\/\d\d-\d\d\/000001$/);
    await expect(c.advanceOrder(placed.orderId, 'DELIVERED', { otp: '0000' === otp ? '1111' : '0000' })).rejects.toThrow(/delivery code/);
    await c.advanceOrder(placed.orderId, 'DELIVERED', { otp });
    const inv = (await c.listInvoices({ fromMs: 0, toMs: Date.now() + 1000 }))[0]!;
    expect(inv.computation.lines.map((l) => l.hsnCode)).toContain('996813');
    expect(inv.paymentMethod).toBe('COD');

    await c.signOut();
    await login(c, PRIYA);
    const done = await c.getOrder(placed.orderId);
    expect(done!.status).toBe('DELIVERED');
    expect(done!.payment.status).toBe('PAID');
    expect(done!.deliveryOtp).toBeNull();
    expect((await c.myInvoicePdf(done!.invoiceId!)).size).toBeGreaterThan(1000);
  });

  it('wallet pays, cancel restocks and refunds instantly; late cancel is blocked', async () => {
    const c = fresh();
    await login(c, PRIYA);
    const addr = (await c.myProfile()).addresses[0]!;
    await expect(c.placeOrder({ addressId: addr.id, storeId: 'S1', items: [{ productId: 'kaju-500', qty: 1 }], paymentMethod: 'WALLET' })).rejects.toThrow(/Wallet balance/);
    await c.topUpWallet(100_000);
    const o = await c.placeOrder({ addressId: addr.id, storeId: 'S1', items: [{ productId: 'kaju-500', qty: 1 }], paymentMethod: 'WALLET' });
    const bal = (await c.myProfile()).walletBalance;
    expect(bal).toBe(120_000 - o.grandTotal);
    const r = await c.cancelMyOrder(o.orderId, 'Ordered by mistake');
    expect(r.refunded).toBe(o.grandTotal);
    expect((await c.myProfile()).walletBalance).toBe(120_000);
    expect((await c.walletTxns()).map((t) => t.kind).slice(0, 3)).toEqual(['REFUND', 'ORDER_DEBIT', 'TOPUP']);

    const o2 = await c.placeOrder({ addressId: addr.id, storeId: 'S1', items: [{ productId: 'kaju-500', qty: 1 }], paymentMethod: 'UPI_INTENT' });
    await c.signOut();
    await login(c, OWNER);
    await c.advanceOrder(o2.orderId, 'ACCEPTED');
    await c.advanceOrder(o2.orderId, 'PICKING');
    const ledger = await c.listLedger('S1');
    expect(ledger.some((l) => l.movement === 'ORDER_CANCEL_RESTOCK')).toBe(true);
    await c.signOut();
    await login(c, PRIYA);
    await expect(c.cancelMyOrder(o2.orderId, 'late')).rejects.toThrow(/started packing/);
  });

  it('only customers can order; tickets reach the shop owner', async () => {
    const c = fresh();
    await login(c, OWNER);
    await expect(c.placeOrder({ addressId: 'x', storeId: 'S1', items: [], paymentMethod: 'COD' })).rejects.toThrow(/customer account/);
    await c.signOut();
    await login(c, PRIYA);
    const t = await c.createSupportTicket({ category: 'DAMAGED_ITEM', subject: 'Ghee jar leaking', transcript: [{ from: 'user', text: 'leak', at: Date.now() }] });
    expect((await c.listSupportTickets()).map((x) => x.id)).toEqual([t.ticketId]);
    await c.signOut();
    await login(c, OWNER);
    const all = await c.listSupportTickets();
    expect(all[0]!.priority).toBe('HIGH');
    await c.setTicketStatus!(t.ticketId, 'RESOLVED');
    expect((await c.listSupportTickets())[0]!.status).toBe('RESOLVED');
  });
});
