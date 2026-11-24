import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeInvoice, gstinCheckChar, sha256Hex, type TaxLineInput } from '@pansari/shared';

const SELLER_GSTIN = '08ABCDE1234F1Z' + gstinCheckChar('08ABCDE1234F1Z');
import {
  AuthError,
  createAdapters,
  LocalMockAuthProvider,
  MOCK_CARD_TOKENS,
  MockPaymentProvider,
  PaymentError,
  type PaymentWebhookEvent,
  type ZoneLike,
} from '../src/index.js';

const lines: TaxLineInput[] = [
  { productId: 'p1', name: 'Gond (edible gum) 250 g', hsnCode: '1301', qty: 2, unit: 'PAC', unitPrice: 18000, taxType: 'INCLUSIVE', gstSlab: 5, batchNumber: 'GD-2611', expiryDate: '30/09/2027' },
  { productId: 'p12', name: 'Kapur (camphor) 50 g', hsnCode: '29142100', qty: 3, unit: 'PAC', unitPrice: 8500, taxType: 'INCLUSIVE', gstSlab: 18 },
  { productId: 'p22', name: 'Kaju W320 500 g', hsnCode: '08013220', qty: 1, unit: 'PAC', unitPrice: 52000, taxType: 'INCLUSIVE', gstSlab: 5 },
  { productId: 'p28', name: 'Chakki atta 5 kg', hsnCode: '1101', qty: 1, unit: 'PAC', unitPrice: 24500, taxType: 'EXCLUSIVE', gstSlab: 5, discount: 1000 },
];

describe('PaymentAdapter (mock)', () => {
  it('creates a UPI QR intent with a valid NPCI link and succeeds', async () => {
    const pay = new MockPaymentProvider({ latencyMs: 0 });
    const events: PaymentWebhookEvent[] = [];
    const sigs: [string, string][] = [];
    pay.onEvent((e, raw, sig) => {
      events.push(e);
      sigs.push([raw, sig]);
    });
    const it0 = await pay.createIntent({ orderId: 'ORD1', amount: 69000, method: 'UPI_QR', payeeVpa: 'pansari.johari@okaxis', payeeName: 'Pansari Express' });
    expect(it0.upiUri).toBe('upi://pay?pa=pansari.johari%40okaxis&pn=Pansari%20Express&am=690.00&cu=INR&tr=ORD1');
    const done = await pay.confirm(it0.intentId);
    expect(done.status).toBe('SUCCEEDED');
    expect(events[0]!.type).toBe('payment.succeeded');
    const verified = await pay.verifyWebhook(sigs[0]![0], sigs[0]![1]);
    expect(verified.orderId).toBe('ORD1');
    await expect(pay.verifyWebhook(sigs[0]![0].replace('69000', '1'), sigs[0]![1])).rejects.toBeInstanceOf(PaymentError);
  });

  it('honours fail / manual toggles, idempotency, cards and refunds', async () => {
    const pay = new MockPaymentProvider({ latencyMs: 0, outcome: 'fail' });
    const f = await pay.createIntent({ orderId: 'O2', amount: 1000, method: 'UPI_INTENT', payeeVpa: 'shop@upi' });
    expect((await pay.confirm(f.intentId)).status).toBe('FAILED');

    pay.configure({ outcome: 'manual' });
    const m = await pay.createIntent({ orderId: 'O3', amount: 1000, method: 'UPI_QR', payeeVpa: 'shop@upi', idempotencyKey: 'k3' });
    expect((await pay.createIntent({ orderId: 'O3', amount: 1000, method: 'UPI_QR', payeeVpa: 'shop@upi', idempotencyKey: 'k3' })).intentId).toBe(m.intentId);
    expect((await pay.confirm(m.intentId)).status).toBe('PENDING');
    expect((await pay.forceOutcome(m.intentId, 'success')).status).toBe('SUCCEEDED');
    const r = await pay.refund(m.intentId, 400, 'one item damaged');
    expect(r.intent.status).toBe('PARTIALLY_REFUNDED');
    await expect(pay.refund(m.intentId, 700, 'too much')).rejects.toThrow(/exceeds/);

    const card = await pay.createIntent({ orderId: 'O4', amount: 5000, method: 'CARD', cardToken: MOCK_CARD_TOKENS.decline });
    expect((await pay.confirm(card.intentId)).failureReason).toBe('CARD_DECLINED');
    await expect(pay.createIntent({ orderId: 'O5', amount: 5000, method: 'CARD', cardToken: '4111 1111 1111 1111' })).rejects.toMatchObject({ code: 'RAW_CARD_REJECTED' });

    const cod = await pay.createIntent({ orderId: 'O6', amount: 30000, method: 'COD' });
    expect((await pay.markCashCollected(cod.intentId, 'rider1')).status).toBe('SUCCEEDED');
  });
});

describe('GeoAdapter (local)', () => {
  const { geo } = createAdapters();
  const zone: ZoneLike = {
    zoneId: 'z1',
    name: 'Walled city + Raja Park',
    isActive: true,
    storeIds: ['S1'],
    geometryJson: JSON.stringify({ type: 'Polygon', coordinates: [[[75.79, 26.89], [75.85, 26.89], [75.85, 26.94], [75.79, 26.94], [75.79, 26.89]]] }),
  };
  const stores = [{ storeId: 'S1', name: 'Johari Bazaar', location: { lat: 26.9196, lng: 75.8267 }, isActive: true, acceptsOnline: true }];

  it('finds the serving store and an ETA inside the zone', () => {
    const r = geo.checkServiceability({ lat: 26.8984, lng: 75.8296 }, [zone], stores);
    expect(r.serviceable).toBe(true);
    expect(r.store?.storeId).toBe('S1');
    expect(r.etaMinutes).toBeGreaterThan(4);
  });
  it('refuses addresses outside every zone', () => {
    expect(geo.checkServiceability({ lat: 26.8549, lng: 75.8243 }, [zone], stores).reason).toBe('OUTSIDE_ZONES');
  });
  it('approximates reverse geocoding from the local gazetteer', async () => {
    expect((await geo.reverseGeocode({ lat: 26.855, lng: 75.825 })).pincode).toBe('302017');
    expect((await geo.geocodePincode('302003'))?.city).toBe('Jaipur');
    expect(geo.simulateRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, 5)).toHaveLength(5);
  });
});

describe('AuthAdapter (local mock)', () => {
  it('signs in with the Firebase-style test number and OTP 123456', async () => {
    const auth = new LocalMockAuthProvider({ resendCooldownSeconds: 0 });
    const ch = await auth.sendOtp('+91 9999999999');
    await expect(auth.verifyOtp(ch.verificationId, '000000')).rejects.toMatchObject({ code: 'INVALID_CODE' });
    const s = await auth.verifyOtp(ch.verificationId, '123456');
    expect(s.phone).toBe('+919999999999');
    expect(s.isNewUser).toBe(true);
  });
  it('enforces attempts, expiry, cooldown and the anonymous upgrade path', async () => {
    let now = 1_000_000;
    const dev: string[] = [];
    const auth = new LocalMockAuthProvider({ now: () => now, onDevOtp: (_p, c) => dev.push(c), maxAttempts: 2 });
    await expect(auth.sendOtp('12345')).rejects.toBeInstanceOf(AuthError);
    const ch = await auth.sendOtp('+919876543210');
    await expect(auth.sendOtp('+919876543210')).rejects.toMatchObject({ code: 'RESEND_TOO_SOON' });
    await expect(auth.verifyOtp(ch.verificationId, '111111')).rejects.toMatchObject({ code: 'INVALID_CODE' });
    await expect(auth.verifyOtp(ch.verificationId, '111111')).rejects.toMatchObject({ code: 'INVALID_CODE' });
    await expect(auth.verifyOtp(ch.verificationId, dev[0]!)).rejects.toMatchObject({ code: 'TOO_MANY_ATTEMPTS' });

    now += 60_000;
    const anon = await auth.signInAnonymously();
    const link = await auth.sendLinkOtp('+919999999998');
    const upgraded = await auth.linkPhone(link.verificationId, '123456');
    expect(upgraded.uid).toBe(anon.uid);
    expect(upgraded.isAnonymous).toBe(false);

    const late = await auth.sendOtp('+919999999999');
    now += 10 * 60_000;
    await expect(auth.verifyOtp(late.verificationId, '123456')).rejects.toMatchObject({ code: 'EXPIRED' });
  });
});

describe('GstAdapter (mock IRP)', () => {
  const { gst } = createAdapters();
  const seller = { legalName: 'Pansari Express Retail LLP', tradeName: 'Pansari Express', gstin: SELLER_GSTIN, addr1: 'Shop 12, Johari Bazaar', location: 'Jaipur', pincode: '302003', stateCode: '08', phone: '0141-2345678' };

  it('builds a reconciling INV-01 payload, IRN and signed QR for B2B', async () => {
    const sellerGstin = SELLER_GSTIN;
    const comp = gst.compute(lines, { sellerStateCode: '08', placeOfSupplyStateCode: '08', buyerGstin: '27AAPFU0939F1ZV' });
    const payload = gst.buildEInvoice({
      computation: comp,
      docType: 'INV',
      docNo: 'PX/26-27/000042',
      docDate: new Date('2026-11-24T10:00:00+05:30'),
      seller: { ...seller, gstin: sellerGstin },
      buyer: { legalName: 'Sharma Tent House', gstin: '27AAPFU0939F1ZV', addr1: 'Plot 4', location: 'Pune', pincode: '411001', stateCode: '27' },
    });
    expect(payload.DocDtls).toEqual({ Typ: 'INV', No: 'PX/26-27/000042', Dt: '24/11/2026' });
    expect(payload.BuyerDtls.Pos).toBe('08');
    const items = payload.ItemList;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    expect(r2(items.reduce((a, i) => a + i.AssAmt, 0))).toBe(payload.ValDtls.AssVal);
    for (const i of items) expect(r2(i.AssAmt + i.CgstAmt + i.SgstAmt + i.IgstAmt + i.CesAmt)).toBe(i.TotItemVal);
    expect(r2(payload.ValDtls.AssVal + payload.ValDtls.CgstVal + payload.ValDtls.SgstVal + payload.ValDtls.RndOffAmt)).toBe(payload.ValDtls.TotInvVal);
    expect(items[0]!.BchDtls).toEqual({ Nm: 'GD-2611', ExpDt: '30/09/2027' });

    const reg = await gst.register(payload);
    expect(reg.Irn).toBe(await sha256Hex(`${sellerGstin}2026-27INVPX/26-27/000042`));
    expect(reg.Irn).toMatch(/^[0-9a-f]{64}$/);
    expect(reg.AckNo).toMatch(/^\d{15}$/);
    expect(reg.SignedQRCode.split('.')).toHaveLength(3);
    await expect(gst.register(payload)).rejects.toMatchObject({ code: 'DUPLICATE_IRN' });
    expect((await gst.cancel(reg.Irn, '2', 'Data entry mistake')).Irn).toBe(reg.Irn);

    mkdirSync('/tmp/invoices', { recursive: true });
    const a4 = await gst.renderPdf(
      {
        invoiceNo: 'PX/26-27/000042',
        invoiceDate: new Date('2026-11-24T10:00:00+05:30'),
        seller: { tradeName: 'Pansari Express', legalName: 'Pansari Express Retail LLP', gstin: sellerGstin, fssaiLicenseNo: '12226999000123', address: 'Shop 12, Johari Bazaar, Jaipur 302003', stateCode: '08', phone: '0141-2345678', storeName: 'Johari Bazaar Store' },
        buyer: { name: 'Sharma Tent House', gstin: '27AAPFU0939F1ZV', address: 'Plot 4, Pune 411001' },
        computation: comp,
        orderRef: 'ORD-8812',
        paymentMode: 'UPI',
        irn: reg.Irn,
        ackNo: reg.AckNo,
        ackDate: reg.AckDt,
        qrPayload: reg.SignedQRCode,
        qrCaption: 'Signed e-invoice QR (test mode)',
        isMockIrn: true,
      },
      'A4',
    );
    expect(new TextDecoder().decode(a4.slice(0, 5))).toBe('%PDF-');
    writeFileSync('/tmp/invoices/sample-b2b-a4.pdf', a4);
  });

  it('refuses e-invoice for B2C and builds a B2C UPI QR + thermal receipt instead', async () => {
    const comp = computeInvoice(lines, { sellerStateCode: '08', placeOfSupplyStateCode: '08' });
    expect(() =>
      gst.buildEInvoice({ computation: comp, docType: 'INV', docNo: 'X/1', docDate: new Date(), seller, buyer: { ...seller, gstin: '27AAPFU0939F1ZV' } }),
    ).toThrow(/B2B/);
    const qr = gst.b2cUpiQr({ sellerGstin: SELLER_GSTIN, payeeVpa: 'pansari.johari@okaxis', payeeName: 'Pansari Express', invoiceNo: 'PX/26-27/000043', invoiceDate: new Date('2026-11-24T12:00:00+05:30'), computation: comp });
    expect(qr).toContain('gstBrkUp=CGST%3A');
    expect(qr).toContain('am=' + (comp.totals.grandTotal / 100).toFixed(2));
    const thermal = await gst.renderPdf(
      {
        invoiceNo: 'PX/26-27/000043',
        invoiceDate: new Date('2026-11-24T12:00:00+05:30'),
        seller: { tradeName: 'Pansari Express', legalName: 'Pansari Express Retail LLP', gstin: SELLER_GSTIN, fssaiLicenseNo: '12226999000123', address: 'Shop 12, Johari Bazaar, Jaipur 302003', stateCode: '08', storeName: 'Johari Bazaar Store' },
        buyer: { name: null, gstin: null, address: null },
        computation: comp,
        paymentMode: 'Cash',
        qrPayload: qr,
        qrCaption: 'Scan to pay / verify',
      },
      'THERMAL_80MM',
    );
    expect(new TextDecoder().decode(thermal.slice(0, 5))).toBe('%PDF-');
    writeFileSync('/tmp/invoices/sample-b2c-thermal.pdf', thermal);
  });
});
