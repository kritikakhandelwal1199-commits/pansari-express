/**
 * GSTR-1 ready summary from issued invoices (outward supplies of goods).
 * Produces the figures for the main tables — B2B (4A), B2CL (5), B2CS (7),
 * HSN summary (12, split B2B / B2C) and documents issued (13) — so the
 * accountant can file from it or export it into the offline tool.
 *
 * B2CL = inter-state supply to an unregistered person above the notified
 * invoice-value threshold. The threshold is a parameter: confirm the current
 * value with your CA before filing.
 */
import type { Paise } from '../money.js';
import type { InvoiceComputation } from './engine.js';

export interface Gstr1InvoiceInput {
  invoiceNo: string;
  issuedMs: number;
  kind: 'B2B' | 'B2C';
  buyerGstin: string | null;
  placeOfSupplyStateCode: string;
  computation: InvoiceComputation;
  cancelled?: boolean;
}

interface TaxBucket {
  taxable: Paise;
  igst: Paise;
  cgst: Paise;
  sgst: Paise;
  cess: Paise;
}

const empty = (): TaxBucket => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
const add = (a: TaxBucket, b: TaxBucket) => {
  a.taxable += b.taxable;
  a.igst += b.igst;
  a.cgst += b.cgst;
  a.sgst += b.sgst;
  a.cess += b.cess;
};

export interface Gstr1Summary {
  period: { fromMs: number; toMs: number };
  b2b: { gstin: string; invoiceNo: string; issuedMs: number; invoiceValue: Paise; pos: string; rates: ({ rate: number } & TaxBucket)[] }[];
  b2cl: { invoiceNo: string; issuedMs: number; invoiceValue: Paise; pos: string; rates: ({ rate: number } & TaxBucket)[] }[];
  b2cs: ({ pos: string; supplyType: 'INTRA_STATE' | 'INTER_STATE'; rate: number } & TaxBucket)[];
  hsnB2B: ({ hsnCode: string; rate: number; qty: number; totalValue: Paise } & TaxBucket)[];
  hsnB2C: ({ hsnCode: string; rate: number; qty: number; totalValue: Paise } & TaxBucket)[];
  documents: { from: string | null; to: string | null; issued: number; cancelled: number };
  totals: TaxBucket & { invoiceValue: Paise; invoices: number };
}

function ratesOf(c: InvoiceComputation) {
  const m = new Map<number, TaxBucket>();
  for (const l of c.lines) {
    const b = m.get(l.gstSlab) ?? empty();
    add(b, { taxable: l.taxable, igst: l.igst, cgst: l.cgst, sgst: l.sgst, cess: l.cess });
    m.set(l.gstSlab, b);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([rate, t]) => ({ rate, ...t }));
}

export function summarizeGstr1(invoices: Gstr1InvoiceInput[], opts: { fromMs: number; toMs: number; b2clThreshold: Paise }): Gstr1Summary {
  const inPeriod = invoices.filter((i) => i.issuedMs >= opts.fromMs && i.issuedMs <= opts.toMs).sort((a, b) => a.issuedMs - b.issuedMs || a.invoiceNo.localeCompare(b.invoiceNo));
  const live = inPeriod.filter((i) => !i.cancelled);
  const out: Gstr1Summary = {
    period: { fromMs: opts.fromMs, toMs: opts.toMs },
    b2b: [],
    b2cl: [],
    b2cs: [],
    hsnB2B: [],
    hsnB2C: [],
    documents: { from: inPeriod[0]?.invoiceNo ?? null, to: inPeriod[inPeriod.length - 1]?.invoiceNo ?? null, issued: inPeriod.length, cancelled: inPeriod.length - live.length },
    totals: { ...empty(), invoiceValue: 0, invoices: live.length },
  };
  const b2cs = new Map<string, Gstr1Summary['b2cs'][number]>();
  const hsn = { B2B: new Map<string, Gstr1Summary['hsnB2B'][number]>(), B2C: new Map<string, Gstr1Summary['hsnB2C'][number]>() };

  for (const inv of live) {
    const c = inv.computation;
    const value = c.totals.grandTotal;
    add(out.totals, { taxable: c.totals.taxable, igst: c.totals.igst, cgst: c.totals.cgst, sgst: c.totals.sgst, cess: c.totals.cess });
    out.totals.invoiceValue += value;

    if (inv.kind === 'B2B' && inv.buyerGstin) {
      out.b2b.push({ gstin: inv.buyerGstin, invoiceNo: inv.invoiceNo, issuedMs: inv.issuedMs, invoiceValue: value, pos: inv.placeOfSupplyStateCode, rates: ratesOf(c) });
    } else if (c.supplyType === 'INTER_STATE' && value > opts.b2clThreshold) {
      out.b2cl.push({ invoiceNo: inv.invoiceNo, issuedMs: inv.issuedMs, invoiceValue: value, pos: inv.placeOfSupplyStateCode, rates: ratesOf(c) });
    } else {
      for (const r of ratesOf(c)) {
        const key = `${inv.placeOfSupplyStateCode}|${c.supplyType}|${r.rate}`;
        const row = b2cs.get(key) ?? { pos: inv.placeOfSupplyStateCode, supplyType: c.supplyType, rate: r.rate, ...empty() };
        add(row, r);
        b2cs.set(key, row);
      }
    }

    const target = inv.kind === 'B2B' ? hsn.B2B : hsn.B2C;
    for (const l of c.lines) {
      const key = `${l.hsnCode}|${l.gstSlab}`;
      const row = target.get(key) ?? { hsnCode: l.hsnCode, rate: l.gstSlab, qty: 0, totalValue: 0, ...empty() };
      row.qty = Math.round((row.qty + l.qty) * 1000) / 1000;
      row.totalValue += l.total;
      add(row, { taxable: l.taxable, igst: l.igst, cgst: l.cgst, sgst: l.sgst, cess: l.cess });
      target.set(key, row);
    }
  }
  const byKey = <T extends { hsnCode: string; rate: number }>(a: T, b: T) => a.hsnCode.localeCompare(b.hsnCode) || a.rate - b.rate;
  out.b2cs = [...b2cs.values()].sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate);
  out.hsnB2B = [...hsn.B2B.values()].sort(byKey);
  out.hsnB2C = [...hsn.B2C.values()].sort(byKey);
  return out;
}
