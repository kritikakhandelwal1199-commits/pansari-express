/**
 * Product-wise GST computation.
 *
 * - Intra-state supply (seller state == place of supply): rate split 50/50 into CGST + SGST.
 * - Inter-state supply: full rate as IGST.
 * - INCLUSIVE prices: the shelf price already contains GST + cess; taxable value is
 *   back-calculated and any paise rounding is absorbed into taxable value so the
 *   line total always equals what the customer was shown.
 * - EXCLUSIVE prices: tax is added on top of the taxable value.
 *
 * All arithmetic is in integer paise. Tax is computed per line (not on the
 * invoice total) so each line and the HSN summary reconcile exactly.
 */
import { GST_SLABS, type GstSlab, type TaxType, type Uqc } from '../schema.js';
import { assertPaise, roundHalfUp, type Paise } from '../money.js';
import { isValidStateCode } from '../states.js';
import { isValidHsn, validateGstin } from './validators.js';
import { amountInWords } from './words.js';

export interface TaxLineInput {
  productId: string;
  name: string;
  hsnCode: string;
  qty: number; // up to 3 decimals for loose goods (e.g. 0.25 KGS)
  unit: Uqc;
  unitPrice: Paise; // shelf price per unit (inclusive or exclusive per taxType)
  taxType: TaxType;
  gstSlab: GstSlab;
  cessRate?: number; // percent of taxable value
  discount?: Paise; // whole-line discount, taken off before tax
  batchNumber?: string | null;
  expiryDate?: string | null; // dd/mm/yyyy
}

export interface InvoiceContext {
  sellerStateCode: string;
  placeOfSupplyStateCode: string;
  buyerGstin?: string | null;
  /** Round grand total to the nearest rupee (default true). */
  roundToRupee?: boolean;
}

export interface ComputedLine extends Required<Omit<TaxLineInput, 'batchNumber' | 'expiryDate'>> {
  slNo: number;
  batchNumber: string | null;
  expiryDate: string | null;
  gross: Paise;
  taxable: Paise;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  cess: Paise;
  totalTax: Paise;
  total: Paise;
}

export interface HsnSummaryRow {
  hsnCode: string;
  gstSlab: number;
  cessRate: number;
  qty: number;
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  cess: Paise;
  totalTax: Paise;
}

export interface InvoiceTotals {
  gross: Paise;
  discount: Paise;
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  cess: Paise;
  totalTax: Paise;
  preRound: Paise;
  roundOff: Paise;
  grandTotal: Paise;
}

export interface InvoiceComputation {
  supplyType: 'INTRA_STATE' | 'INTER_STATE';
  kind: 'B2C' | 'B2B';
  sellerStateCode: string;
  placeOfSupplyStateCode: string;
  buyerGstin: string | null;
  lines: ComputedLine[];
  hsnSummary: HsnSummaryRow[];
  totals: InvoiceTotals;
  amountInWords: string;
}

export class GstValidationError extends Error {
  constructor(message: string, readonly field: string) {
    super(message);
    this.name = 'GstValidationError';
  }
}

const MAX_LINES = 200;

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function validateLine(l: TaxLineInput, i: number) {
  const f = (k: string) => `lines[${i}].${k}`;
  if (!l.productId) throw new GstValidationError('productId required', f('productId'));
  if (!l.name?.trim()) throw new GstValidationError('name required', f('name'));
  if (!isValidHsn(l.hsnCode)) throw new GstValidationError(`HSN "${l.hsnCode}" must be 4, 6 or 8 digits`, f('hsnCode'));
  if (!(Number.isFinite(l.qty) && l.qty > 0 && round3(l.qty) === l.qty)) throw new GstValidationError('qty must be > 0 with at most 3 decimals', f('qty'));
  assertPaise(l.unitPrice, f('unitPrice'));
  if (l.unitPrice < 0) throw new GstValidationError('unitPrice cannot be negative', f('unitPrice'));
  if (!(GST_SLABS as readonly number[]).includes(l.gstSlab)) throw new GstValidationError(`GST slab ${l.gstSlab}% not allowed`, f('gstSlab'));
  if (l.taxType !== 'INCLUSIVE' && l.taxType !== 'EXCLUSIVE') throw new GstValidationError('taxType must be INCLUSIVE or EXCLUSIVE', f('taxType'));
  const cess = l.cessRate ?? 0;
  if (!(Number.isFinite(cess) && cess >= 0 && cess <= 300)) throw new GstValidationError('cessRate out of range', f('cessRate'));
  const disc = l.discount ?? 0;
  assertPaise(disc, f('discount'));
  if (disc < 0) throw new GstValidationError('discount cannot be negative', f('discount'));
}

function computeLine(l: TaxLineInput, slNo: number, intra: boolean): ComputedLine {
  const gstRate = l.gstSlab;
  const cessRate = l.cessRate ?? 0;
  const gross = roundHalfUp(l.qty * l.unitPrice);
  const discount = l.discount ?? 0;
  if (discount > gross) throw new GstValidationError('discount exceeds line value', `lines[${slNo - 1}].discount`);
  const afterDiscount = gross - discount;

  const taxesOn = (taxable: number) => {
    const half = intra ? roundHalfUp((taxable * gstRate) / 200) : 0;
    const igst = intra ? 0 : roundHalfUp((taxable * gstRate) / 100);
    const cess = roundHalfUp((taxable * cessRate) / 100);
    return { cgst: half, sgst: half, igst, cess, total: half * 2 + igst + cess };
  };

  let taxable: number;
  let t: ReturnType<typeof taxesOn>;
  if (l.taxType === 'EXCLUSIVE') {
    taxable = afterDiscount;
    t = taxesOn(taxable);
  } else {
    // Back-calculate, then push any paise difference into taxable value so
    // taxable + taxes === the inclusive amount the customer saw.
    taxable = roundHalfUp((afterDiscount * 100) / (100 + gstRate + cessRate));
    t = taxesOn(taxable);
    taxable += afterDiscount - (taxable + t.total);
  }

  return {
    slNo,
    productId: l.productId,
    name: l.name.trim(),
    hsnCode: l.hsnCode,
    qty: l.qty,
    unit: l.unit,
    unitPrice: l.unitPrice,
    taxType: l.taxType,
    gstSlab: l.gstSlab,
    cessRate,
    discount,
    batchNumber: l.batchNumber ?? null,
    expiryDate: l.expiryDate ?? null,
    gross,
    taxable,
    cgstRate: intra ? gstRate / 2 : 0,
    sgstRate: intra ? gstRate / 2 : 0,
    igstRate: intra ? 0 : gstRate,
    cgst: t.cgst,
    sgst: t.sgst,
    igst: t.igst,
    cess: t.cess,
    totalTax: t.total,
    total: taxable + t.total,
  };
}

export function computeInvoice(lines: TaxLineInput[], ctx: InvoiceContext): InvoiceComputation {
  if (!isValidStateCode(ctx.sellerStateCode)) throw new GstValidationError(`Unknown seller state code ${ctx.sellerStateCode}`, 'sellerStateCode');
  if (!isValidStateCode(ctx.placeOfSupplyStateCode)) throw new GstValidationError(`Unknown place of supply ${ctx.placeOfSupplyStateCode}`, 'placeOfSupplyStateCode');
  if (!Array.isArray(lines) || lines.length === 0) throw new GstValidationError('At least one line is required', 'lines');
  if (lines.length > MAX_LINES) throw new GstValidationError(`Max ${MAX_LINES} lines per invoice`, 'lines');

  let buyerGstin: string | null = null;
  if (ctx.buyerGstin && ctx.buyerGstin.trim()) {
    const check = validateGstin(ctx.buyerGstin);
    if (!check.valid) throw new GstValidationError(`Buyer GSTIN invalid: ${check.reason}`, 'buyerGstin');
    buyerGstin = ctx.buyerGstin.trim().toUpperCase();
  }

  lines.forEach(validateLine);
  const intra = ctx.sellerStateCode === ctx.placeOfSupplyStateCode;
  const computed = lines.map((l, i) => computeLine(l, i + 1, intra));

  const summary = new Map<string, HsnSummaryRow>();
  for (const c of computed) {
    const key = `${c.hsnCode}|${c.gstSlab}|${c.cessRate}`;
    const row = summary.get(key) ?? { hsnCode: c.hsnCode, gstSlab: c.gstSlab, cessRate: c.cessRate, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, totalTax: 0 };
    row.qty = round3(row.qty + c.qty);
    row.taxable += c.taxable;
    row.cgst += c.cgst;
    row.sgst += c.sgst;
    row.igst += c.igst;
    row.cess += c.cess;
    row.totalTax += c.totalTax;
    summary.set(key, row);
  }
  const hsnSummary = [...summary.values()].sort((a, b) => a.hsnCode.localeCompare(b.hsnCode) || a.gstSlab - b.gstSlab);

  const sum = (k: keyof ComputedLine) => computed.reduce((a, c) => a + (c[k] as number), 0);
  const preRound = sum('total');
  const grandTotal = ctx.roundToRupee === false ? preRound : roundHalfUp(preRound / 100) * 100;
  const totals: InvoiceTotals = {
    gross: sum('gross'),
    discount: sum('discount'),
    taxable: sum('taxable'),
    cgst: sum('cgst'),
    sgst: sum('sgst'),
    igst: sum('igst'),
    cess: sum('cess'),
    totalTax: sum('totalTax'),
    preRound,
    roundOff: grandTotal - preRound,
    grandTotal,
  };

  return {
    supplyType: intra ? 'INTRA_STATE' : 'INTER_STATE',
    kind: buyerGstin ? 'B2B' : 'B2C',
    sellerStateCode: ctx.sellerStateCode,
    placeOfSupplyStateCode: ctx.placeOfSupplyStateCode,
    buyerGstin,
    lines: computed,
    hsnSummary,
    totals,
    amountInWords: amountInWords(grandTotal),
  };
}
