import { describe, expect, it } from 'vitest';
import { DemoDataClient, DEMO_TURNSTILE_PASS } from '@/lib/data/demo';

const fresh = () => new DemoDataClient({ storage: null, sessionStorage: null });
const login = async (c: DemoDataClient, phone: string) => c.verifyOtp((await c.sendOtp(phone)).verificationId, '123456');

describe('demo backend — end-to-end flows', () => {
  it('owner adds a product, prices it, receives stock and bills it at the counter', async () => {
    const c = fresh();
    await login(c, '+919999999991');
    await expect(c.upsertProduct({ name: 'Roli', category: 'pooja', unit: 'PAC', netQuantity: '50 g', hsnCode: '9999', taxType: 'INCLUSIVE', mrp: 2000 })).rejects.toThrow(/tax master/);
    const p = await c.upsertProduct({ name: 'Mauli kalava 10 rolls', category: 'shaadi', unit: 'PAC', netQuantity: '10 N', hsnCode: '14049010', taxType: 'INCLUSIVE', mrp: 4000 });
    expect(p.gstSlab).toBe(5);
    expect(p.sentForReview).toBe(true);
    await expect(c.setStorePrice('S1', p.productId, 4500)).rejects.toThrow(/above MRP/);
    await c.setStorePrice('S1', p.productId, 3500);
    const r = await c.inwardStock({ storeId: 'S1', productId: p.productId, batchNumber: 'MK-01', mfgDate: null, expiryDate: null, qty: 30, purchasePrice: 2000, mrp: 4000, reference: 'BILL-1' });
    expect(r.onHand).toBe(30);
    const sale = await c.commitSale({ storeId: 'S1', channel: 'POS_WALKIN', items: [{ productId: p.productId, qty: 2 }, { productId: 'kapur-50', qty: 1 }], payment: { method: 'CASH' } });
    expect(sale.invoiceNo).toMatch(/^PX\/\d\d-\d\d\/000001$/);
    expect(sale.grandTotal).toBe(7000 + 8500);
    const inv = await c.listInventory('S1');
    expect(inv.find((x) => x.productId === p.productId)!.onHand).toBe(28);
    const ledger = await c.listLedger('S1');
    expect(ledger.slice(0, 2).map((l) => l.movement)).toEqual(['POS_WALKIN_SALE', 'POS_WALKIN_SALE']);
    const pdf = await c.invoicePdf(sale.invoiceId, 'THERMAL_80MM');
    expect(pdf.size).toBeGreaterThan(1000);
    const second = await c.commitSale({ storeId: 'S1', channel: 'POS_WALKIN', items: [{ productId: 'kaju-500', qty: 1 }], payment: { method: 'UPI_QR' }, buyer: { name: 'Sharma Traders', gstin: '27AAPFU0939F1ZV' } });
    expect(second.invoiceNo).toMatch(/000002$/);
    expect(second.kind).toBe('B2B');
    const invoices = await c.listInvoices({ fromMs: 0, toMs: Date.now() + 1000 });
    expect(invoices[0]!.irn).toMatch(/^[0-9a-f]{64}$/);
    expect(invoices[0]!.computation.supplyType).toBe('INTRA_STATE');
  });

  it('enforces FEFO, expiry and staff store limits', async () => {
    const c = fresh();
    await login(c, '+919999999992'); // staff @ S1
    expect((await c.listStores()).map((s) => s.storeId)).toEqual(['S1']);
    await expect(c.listInventory('S2')).rejects.toThrow(/do not operate/);
    await expect(c.setStorePrice('S1', 'kapur-50', 8000)).rejects.toThrow(/shop owner/);
    // mehndi: 6 fresh + 3 expired → only 6 sellable
    await expect(c.commitSale({ storeId: 'S1', channel: 'POS_WALKIN', items: [{ productId: 'mehndi-12', qty: 7 }], payment: { method: 'CASH' } })).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });
    // gond: older batch GD-2608 (expires sooner) sold first
    await c.commitSale({ storeId: 'S1', channel: 'POS_WALKIN', items: [{ productId: 'gond-250', qty: 7 }], payment: { method: 'CASH' } });
    const b = await c.listBatches('S1', 'gond-250');
    expect(b.map((x) => [x.batchNumber, x.qty])).toEqual([['GD-2608', 0], ['GD-2611', 11]]);
    const damaged = await c.adjustStock({ storeId: 'S1', productId: 'gond-250', batchId: b[1]!.batchId, movement: 'DAMAGED_WRITE_OFF', qty: 1, reason: 'Packet torn' });
    expect(damaged.onHand).toBe(10);
  });

  it('walk-in QR: poster → guest session → cart → checkout QR → cashier redeems once', async () => {
    const c = fresh();
    await login(c, '+919999999991');
    const { token } = await c.signStoreQr('S1');
    await expect(c.signStoreQr('G1')).rejects.toThrow(/walk-in/);
    await expect(c.resolveStoreQr('S2', token)).rejects.toThrow(/another store/);
    await expect(c.startGuestSession('S1', token, 'bot')).rejects.toThrow(/human check/);
    const guest = await c.startGuestSession('S1', token, DEMO_TURNSTILE_PASS);
    expect(guest.role).toBe('temp_qr_guest');
    const shelf = await c.guestInventory('S1');
    expect(shelf.some((r) => r.productId === 'shatavari-100')).toBe(false); // not approved yet
    expect(shelf.find((r) => r.productId === 'gond-250')!.aisleBinCode).toBe('A1-R1-B01');
    await expect(c.guestInventory('S2')).rejects.toThrow(/Scan the store QR/);
    const cart = await c.saveGuestCart('S1', [{ productId: 'kaju-500', qty: 1 }, { productId: 'namak-1kg', qty: 2 }]);
    const ck = await c.createCheckoutToken(cart.cartId);
    const redeemed = await c.redeemCheckout(ck.token);
    expect(redeemed.cartId).toBe(cart.cartId);
    await expect(c.redeemCheckout(ck.token)).rejects.toThrow(/already used/);
    const sale = await c.commitSale({ storeId: 'S1', channel: 'OFFLINE_QR', tempCartId: cart.cartId, payment: { method: 'CASH' } });
    expect(sale.grandTotal).toBe(52000 + 5600);
    await expect(c.commitSale({ storeId: 'S1', channel: 'OFFLINE_QR', tempCartId: cart.cartId, payment: { method: 'CASH' } })).rejects.toThrow(/already billed/);
    expect((await c.listLedger('S1'))[0]!.movement).toBe('OFFLINE_QR_SALE');
  });

  it('guest pays in-app (simulated), downloads the bill and saves it to a phone account', async () => {
    const c = fresh();
    await login(c, '+919999999991');
    const { token } = await c.signStoreQr('S2');
    await c.startGuestSession('S2', token, DEMO_TURNSTILE_PASS);
    const cart = await c.saveGuestCart('S2', [{ productId: 'gond-250', qty: 1 }]);
    await expect(c.guestCommitSale({ storeId: 'S2', channel: 'OFFLINE_QR', tempCartId: cart.cartId, payment: { method: 'UPI_QR' }, simulateOutcome: 'fail' })).rejects.toThrow(/declined/);
    const sale = await c.guestCommitSale({ storeId: 'S2', channel: 'OFFLINE_QR', tempCartId: cart.cartId, payment: { method: 'UPI_QR' }, simulateOutcome: 'success' });
    expect((await c.guestInvoice(sale.invoiceId))!.grandTotal).toBe(18500);
    expect((await c.guestInvoicePdf(sale.invoiceId)).type).toBe('application/pdf');
    const ch = await c.sendGuestLinkOtp('+919812345678');
    const u = await c.confirmGuestLink(ch.verificationId, '123456');
    expect(u.role).toBe('customer');
    expect((await c.guestInvoice(sale.invoiceId))!.invoiceNo).toBe(sale.invoiceNo);
  });
});
