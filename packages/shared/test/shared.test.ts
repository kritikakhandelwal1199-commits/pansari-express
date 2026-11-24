import { describe, expect, it } from 'vitest';
import {
  amountInWords,
  computeInvoice,
  estimateEtaMinutes,
  financialYear,
  formatINR,
  formatInvoiceNo,
  GstValidationError,
  gstinCheckChar,
  haversineMeters,
  parseZoneGeometry,
  pointInGeometry,
  signToken,
  TokenError,
  validateGstin,
  verifyToken,
  type TaxLineInput,
} from '../src/index.js';

const SECRET = 'test-secret-that-is-at-least-32-chars-long!!';

const kapur: TaxLineInput = { productId: 'p12', name: 'Kapur (camphor) 50 g', hsnCode: '29142100', qty: 2, unit: 'PAC', unitPrice: 8500, taxType: 'INCLUSIVE', gstSlab: 18 };
const kaju: TaxLineInput = { productId: 'p22', name: 'Kaju W320 500 g', hsnCode: '08013220', qty: 1, unit: 'PAC', unitPrice: 52000, taxType: 'INCLUSIVE', gstSlab: 5 };
const atta: TaxLineInput = { productId: 'p28', name: 'Chakki atta 5 kg', hsnCode: '1101', qty: 1, unit: 'PAC', unitPrice: 24500, taxType: 'EXCLUSIVE', gstSlab: 5 };

describe('GSTIN', () => {
  it('accepts a GSTIN with a correct check digit', () => {
    const r = validateGstin('27AAPFU0939F1ZV');
    expect(r.valid).toBe(true);
    expect(r.stateCode).toBe('27');
    expect(r.pan).toBe('AAPFU0939F');
  });
  it('rejects a typo via the check digit', () => {
    expect(validateGstin('27AAPFU0939F1ZW').valid).toBe(false);
    expect(validateGstin('08AAPFU0939F1Z').valid).toBe(false);
  });
  it('computes check characters for Rajasthan GSTINs', () => {
    const first14 = '08ABCDE1234F1Z';
    const g = first14 + gstinCheckChar(first14);
    expect(validateGstin(g).valid).toBe(true);
  });
});

describe('Amount in words (Indian system)', () => {
  it('handles paise', () => {
    expect(amountInWords(123456)).toBe('Rupees One Thousand Two Hundred Thirty Four and Fifty Six Paise Only');
  });
  it('handles lakh and crore', () => {
    expect(amountInWords(12_34_56_789_00)).toBe('Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only');
    expect(amountInWords(100)).toBe('Rupees One Only');
  });
  it('formats INR with Indian grouping', () => {
    expect(formatINR(12345678)).toBe('₹1,23,456.78');
    expect(formatINR(99, { symbol: 'Rs.' })).toBe('Rs.0.99');
  });
});

describe('Financial year + invoice numbers', () => {
  it('switches FY at IST midnight on 1 April', () => {
    expect(financialYear(new Date('2026-03-31T18:29:00Z'))).toBe('2025-26'); // 23:59 IST
    expect(financialYear(new Date('2026-03-31T18:31:00Z'))).toBe('2026-27'); // 00:01 IST
  });
  it('builds ≤16 char numbers', () => {
    expect(formatInvoiceNo('PX', '2026-27', 123)).toBe('PX/26-27/000123');
    expect(formatInvoiceNo('JOHARI', '2026-27', 7)).toBe('JOHARI/26-27/007');
    expect(() => formatInvoiceNo('JOHARI', '2026-27', 12345)).toThrow(RangeError);
  });
});

describe('GST engine', () => {
  it('splits intra-state GST equally and keeps inclusive totals exact', () => {
    const inv = computeInvoice([kapur, kaju], { sellerStateCode: '08', placeOfSupplyStateCode: '08' });
    expect(inv.supplyType).toBe('INTRA_STATE');
    expect(inv.kind).toBe('B2C');
    for (const l of inv.lines) {
      expect(l.cgst).toBe(l.sgst);
      expect(l.igst).toBe(0);
      expect(l.taxable + l.totalTax).toBe(l.total);
      expect(l.total).toBe(l.qty * l.unitPrice); // inclusive: customer pays shelf price
    }
    expect(inv.totals.preRound).toBe(17000 + 52000);
    expect(inv.totals.grandTotal).toBe(69000);
    expect(inv.totals.roundOff).toBe(0);
    // Kapur: 170.00 incl 18% → taxable 144.07, CGST 12.97, SGST 12.96?  we keep halves equal and push diff into taxable
    const k = inv.lines[0]!;
    expect(k.cgstRate).toBe(9);
    expect(k.taxable + 2 * k.cgst).toBe(17000);
  });

  it('applies full IGST inter-state on exclusive prices and rounds the total', () => {
    const inv = computeInvoice([atta, { ...atta, productId: 'p29', name: 'Sarson tel 1 L', hsnCode: '1514', unitPrice: 16533, gstSlab: 5 }], {
      sellerStateCode: '08',
      placeOfSupplyStateCode: '07',
    });
    expect(inv.supplyType).toBe('INTER_STATE');
    expect(inv.lines[0]!.igst).toBe(1225); // 5% of 245.00
    expect(inv.lines[0]!.cgst).toBe(0);
    expect(inv.lines[1]!.igst).toBe(827); // 5% of 165.33 = 8.2665 → 8.27
    expect(inv.totals.preRound).toBe(24500 + 1225 + 16533 + 827);
    expect(inv.totals.grandTotal % 100).toBe(0);
    expect(inv.totals.grandTotal - inv.totals.preRound).toBe(inv.totals.roundOff);
    expect(Math.abs(inv.totals.roundOff)).toBeLessThanOrEqual(50);
  });

  it('groups the HSN summary and reconciles with totals', () => {
    const inv = computeInvoice([kapur, kapur, kaju, atta], { sellerStateCode: '08', placeOfSupplyStateCode: '08' });
    expect(inv.hsnSummary).toHaveLength(3);
    const sumTaxable = inv.hsnSummary.reduce((a, r) => a + r.taxable, 0);
    expect(sumTaxable).toBe(inv.totals.taxable);
    expect(inv.hsnSummary.find((r) => r.hsnCode === '29142100')!.qty).toBe(4);
  });

  it('marks invoices with a valid buyer GSTIN as B2B and rejects bad ones', () => {
    expect(computeInvoice([atta], { sellerStateCode: '08', placeOfSupplyStateCode: '27', buyerGstin: '27AAPFU0939F1ZV' }).kind).toBe('B2B');
    expect(() => computeInvoice([atta], { sellerStateCode: '08', placeOfSupplyStateCode: '27', buyerGstin: '27AAPFU0939F1ZX' })).toThrow(GstValidationError);
  });

  it('handles discounts, cess and loose quantities', () => {
    const inv = computeInvoice(
      [{ productId: 'x', name: 'Supari loose', hsnCode: '0802', qty: 0.25, unit: 'KGS', unitPrice: 56000, taxType: 'EXCLUSIVE', gstSlab: 5, discount: 1000 }, { productId: 'y', name: 'Test cess item', hsnCode: '2202', qty: 1, unit: 'BTL', unitPrice: 4000, taxType: 'INCLUSIVE', gstSlab: 28, cessRate: 12 }],
      { sellerStateCode: '08', placeOfSupplyStateCode: '08' },
    );
    expect(inv.lines[0]!.gross).toBe(14000);
    expect(inv.lines[0]!.taxable).toBe(13000);
    expect(inv.lines[1]!.total).toBe(4000);
    expect(inv.lines[1]!.cess).toBeGreaterThan(0);
  });

  it('rejects invalid input', () => {
    expect(() => computeInvoice([{ ...atta, hsnCode: '12345' }], { sellerStateCode: '08', placeOfSupplyStateCode: '08' })).toThrow(/HSN/);
    expect(() => computeInvoice([{ ...atta, gstSlab: 7 as never }], { sellerStateCode: '08', placeOfSupplyStateCode: '08' })).toThrow(/slab/);
    expect(() => computeInvoice([atta], { sellerStateCode: '99', placeOfSupplyStateCode: '08' })).toThrow(/seller state/);
  });
});

describe('Geo', () => {
  const johari = { lat: 26.9196, lng: 75.8267 };
  const malviya = { lat: 26.8549, lng: 75.8243 };
  it('computes haversine distance', () => {
    const d = haversineMeters(johari, malviya);
    expect(d).toBeGreaterThan(7000);
    expect(d).toBeLessThan(7400);
    expect(estimateEtaMinutes(d)).toBeGreaterThan(30);
  });
  it('tests points against polygons with holes', () => {
    const g = parseZoneGeometry(
      JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [[75.80, 26.90], [75.85, 26.90], [75.85, 26.94], [75.80, 26.94], [75.80, 26.90]],
          [[75.82, 26.915], [75.83, 26.915], [75.83, 26.925], [75.82, 26.925], [75.82, 26.915]],
        ],
      }),
    );
    expect(pointInGeometry({ lat: 26.905, lng: 75.81 }, g)).toBe(true);
    expect(pointInGeometry(johari, g)).toBe(false); // inside the hole
    expect(pointInGeometry(malviya, g)).toBe(false);
    expect(pointInGeometry({ lat: 26.90, lng: 75.82 }, g)).toBe(true); // on edge
  });
  it('rejects open rings', () => {
    expect(() => parseZoneGeometry(JSON.stringify({ type: 'Polygon', coordinates: [[[75.8, 26.9], [75.9, 26.9], [75.9, 27], [75.8, 27]]] }))).toThrow(/closed/);
  });
});

describe('HMAC tokens', () => {
  const secretFor = (kid: string) => (kid === 'k1' ? SECRET : undefined);
  it('round-trips a store token', async () => {
    const t = await signToken({ t: 'store', sid: 'S1', ver: 1, iat: 1_700_000_000 }, 'k1', SECRET);
    const p = await verifyToken(t, { expectedType: 'store', secretFor, nowSeconds: 1_700_000_100 });
    expect(p.sid).toBe('S1');
    expect(p.kid).toBe('k1');
  });
  it('rejects tampering, unknown keys, wrong type and expiry', async () => {
    const t = await signToken({ t: 'store', sid: 'S1', ver: 1, iat: 1_700_000_000 }, 'k1', SECRET);
    const [v, kid, , sig] = t.split('.');
    const forged = `${v}.${kid}.${btoa(JSON.stringify({ t: 'store', sid: 'S2', ver: 1, iat: 1_700_000_000 })).replace(/=+$/, '')}.${sig}`;
    await expect(verifyToken(forged, { expectedType: 'store', secretFor })).rejects.toMatchObject({ code: 'BAD_SIGNATURE' });
    await expect(verifyToken(t.replace('.k1.', '.k9.'), { expectedType: 'store', secretFor })).rejects.toMatchObject({ code: 'UNKNOWN_KEY' });
    await expect(verifyToken(t, { expectedType: 'checkout', secretFor, nowSeconds: 1_700_000_100 })).rejects.toBeInstanceOf(TokenError);
    const c = await signToken({ t: 'checkout', sid: 'S1', cid: 'c', uid: 'u', iat: 1_700_000_000, exp: 1_700_000_600, n: 'n' }, 'k1', SECRET);
    await expect(verifyToken(c, { expectedType: 'checkout', secretFor, nowSeconds: 1_700_001_000 })).rejects.toMatchObject({ code: 'EXPIRED' });
    expect((await verifyToken(c, { expectedType: 'checkout', secretFor, nowSeconds: 1_700_000_300 })).cid).toBe('c');
  });
});
