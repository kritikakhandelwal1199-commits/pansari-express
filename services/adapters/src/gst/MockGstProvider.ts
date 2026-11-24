import {
  b64urlEncode,
  computeInvoice,
  eInvoiceDate,
  financialYear,
  istParts,
  paiseToRupees,
  sha256Hex,
  validateGstin,
  type InvoiceComputation,
  type InvoiceContext,
  type TaxLineInput,
} from '@pansari/shared';
import {
  GstAdapterError,
  type B2cQrInput,
  type EInvoiceInput,
  type EInvoiceItem,
  type EInvoicePayload,
  type GstAdapter,
  type InvoiceRenderModel,
  type IrpRegistration,
  type PartyAddress,
  type PdfFormat,
} from './GstAdapter.js';
import { renderInvoicePdf } from './invoicePdf.js';

export interface MockGstConfig {
  /** Local HMAC key that stands in for the IRP's signing key. >= 32 chars. */
  mockSigningKey: string;
  now?: () => Date;
}

const r2 = paiseToRupees;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const enc = new TextEncoder();

function party(p: PartyAddress & { gstin: string }) {
  const out: EInvoicePayload['SellerDtls'] = {
    Gstin: p.gstin,
    LglNm: p.legalName.slice(0, 100),
    Addr1: p.addr1.slice(0, 100),
    Loc: p.location.slice(0, 50),
    Pin: Number(p.pincode),
    Stcd: p.stateCode,
  };
  if (p.tradeName) out.TrdNm = p.tradeName.slice(0, 100);
  if (p.addr2) out.Addr2 = p.addr2.slice(0, 100);
  if (p.phone) out.Ph = p.phone.replace(/\D/g, '').slice(-12);
  if (p.email) out.Em = p.email.slice(0, 100);
  return out;
}

function ackDateIst(d: Date): string {
  const { year, month, day, hour, minute } = istParts(d);
  const s = new Date(d.getTime() + 330 * 60 * 1000).getUTCSeconds();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${year}-${p(month)}-${p(day)} ${p(hour)}:${p(minute)}:${p(s)}`;
}

export class MockGstProvider implements GstAdapter {
  readonly provider = 'mock-irp';
  private registered = new Map<string, { at: Date; status: 'ACT' | 'CNL' }>();

  constructor(private cfg: MockGstConfig) {
    if (cfg.mockSigningKey.length < 32) throw new Error('mockSigningKey must be at least 32 characters');
  }

  private now() {
    return this.cfg.now?.() ?? new Date();
  }

  compute(lines: TaxLineInput[], ctx: InvoiceContext): InvoiceComputation {
    return computeInvoice(lines, ctx);
  }

  buildEInvoice(input: EInvoiceInput): EInvoicePayload {
    const c = input.computation;
    if (c.kind !== 'B2B') throw new GstAdapterError('NOT_B2B', 'E-invoicing applies to B2B supplies only; use b2cUpiQr() for B2C bills');
    for (const [label, g] of [['seller', input.seller.gstin], ['buyer', input.buyer.gstin]] as const) {
      const v = validateGstin(g);
      if (!v.valid) throw new GstAdapterError('INVALID_INPUT', `${label} GSTIN invalid: ${v.reason}`);
    }
    if (input.seller.stateCode !== c.sellerStateCode) throw new GstAdapterError('INVALID_INPUT', 'Seller state code does not match the computation');
    if (!/^[A-Za-z0-9/-]{1,16}$/.test(input.docNo)) throw new GstAdapterError('INVALID_INPUT', 'Document number must be ≤16 chars (letters, digits, / and -)');
    for (const p of [input.seller, input.buyer]) {
      if (!/^[1-9][0-9]{5}$/.test(p.pincode)) throw new GstAdapterError('INVALID_INPUT', `Invalid pincode ${p.pincode}`);
    }

    const items: EInvoiceItem[] = c.lines.map((l) => {
      // Exclusive: UnitPrice is the pre-tax shelf price, discount shown separately.
      // Inclusive: price already had tax in it → report the back-calculated taxable value.
      const exclusive = l.taxType === 'EXCLUSIVE';
      const totAmt = exclusive ? r2(l.gross) : r2(l.taxable);
      const item: EInvoiceItem = {
        SlNo: String(l.slNo),
        PrdDesc: l.name.slice(0, 300),
        IsServc: 'N',
        HsnCd: l.hsnCode,
        Qty: r3(l.qty),
        FreeQty: 0,
        Unit: l.unit,
        UnitPrice: exclusive ? r3(l.unitPrice / 100) : r3(l.taxable / 100 / l.qty),
        TotAmt: totAmt,
        Discount: exclusive ? r2(l.discount) : 0,
        PreTaxVal: 0,
        AssAmt: r2(l.taxable),
        GstRt: l.gstSlab,
        IgstAmt: r2(l.igst),
        CgstAmt: r2(l.cgst),
        SgstAmt: r2(l.sgst),
        CesRt: l.cessRate,
        CesAmt: r2(l.cess),
        CesNonAdvlAmt: 0,
        StateCesRt: 0,
        StateCesAmt: 0,
        StateCesNonAdvlAmt: 0,
        OthChrg: 0,
        TotItemVal: r2(l.total),
      };
      if (l.batchNumber) item.BchDtls = { Nm: l.batchNumber.slice(0, 20), ...(l.expiryDate ? { ExpDt: l.expiryDate } : {}) };
      return item;
    });

    return {
      Version: '1.1',
      TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', EcmGstin: null, IgstOnIntra: 'N' },
      DocDtls: { Typ: input.docType, No: input.docNo, Dt: eInvoiceDate(input.docDate) },
      SellerDtls: party(input.seller),
      BuyerDtls: { ...party(input.buyer), Pos: c.placeOfSupplyStateCode },
      ItemList: items,
      ValDtls: {
        AssVal: r2(c.totals.taxable),
        CgstVal: r2(c.totals.cgst),
        SgstVal: r2(c.totals.sgst),
        IgstVal: r2(c.totals.igst),
        CesVal: r2(c.totals.cess),
        StCesVal: 0,
        Discount: 0,
        OthChrg: 0,
        RndOffAmt: r2(c.totals.roundOff),
        TotInvVal: r2(c.totals.grandTotal),
      },
    };
  }

  /**
   * IRN = SHA-256 hex of Supplier GSTIN + Financial Year (YYYY-YY) + Document Type + Document Number
   * (the same inputs the IRP hashes, so the value is stable across mock → live).
   */
  generateIrn(sellerGstin: string, fy: string, docType: string, docNo: string): Promise<string> {
    return sha256Hex(`${sellerGstin.toUpperCase()}${fy}${docType.toUpperCase()}${docNo.toUpperCase()}`);
  }

  private async mockJws(payload: unknown): Promise<string> {
    const header = b64urlEncode(enc.encode(JSON.stringify({ alg: 'HS256', kid: 'MOCK-IRP-LOCAL', typ: 'JWT' })));
    const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
    const key = await crypto.subtle.importKey('raw', enc.encode(this.cfg.mockSigningKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`)));
    return `${header}.${body}.${b64urlEncode(sig)}`;
  }

  async register(payload: EInvoicePayload): Promise<IrpRegistration> {
    const [d, m, y] = payload.DocDtls.Dt.split('/').map(Number) as [number, number, number];
    const fy = financialYear(new Date(Date.UTC(y, m - 1, d, 6, 30)));
    const irn = await this.generateIrn(payload.SellerDtls.Gstin, fy, payload.DocDtls.Typ, payload.DocDtls.No);
    if (this.registered.get(irn)?.status === 'ACT') throw new GstAdapterError('DUPLICATE_IRN', 'An active IRN already exists for this document (2150 Duplicate IRN)');
    const at = this.now();
    const ackNo = `${String(istParts(at).year).slice(2)}${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 100).toString().padStart(2, '0')}`.slice(0, 15).padEnd(15, '0');
    const ackDt = ackDateIst(at);
    const mainHsn = [...payload.ItemList].sort((a, b) => b.AssAmt - a.AssAmt)[0]?.HsnCd ?? '';
    const qrClaims = {
      SellerGstin: payload.SellerDtls.Gstin,
      BuyerGstin: payload.BuyerDtls.Gstin,
      DocNo: payload.DocDtls.No,
      DocTyp: payload.DocDtls.Typ,
      DocDt: payload.DocDtls.Dt,
      TotInvVal: payload.ValDtls.TotInvVal,
      ItemCnt: payload.ItemList.length,
      MainHsnCode: mainHsn,
      Irn: irn,
      IrnDt: ackDt,
    };
    this.registered.set(irn, { at, status: 'ACT' });
    return {
      Irn: irn,
      AckNo: ackNo,
      AckDt: ackDt,
      SignedInvoice: await this.mockJws({ data: JSON.stringify({ ...payload, Irn: irn, AckNo: ackNo, AckDt: ackDt }) }),
      SignedQRCode: await this.mockJws({ data: JSON.stringify(qrClaims) }),
      Status: 'ACT',
      isMock: true,
    };
  }

  async cancel(irn: string, reasonCode: '1' | '2' | '3' | '4', remark: string) {
    const r = this.registered.get(irn);
    if (!r) throw new GstAdapterError('NOT_FOUND', 'IRN not found');
    if (this.now().getTime() - r.at.getTime() > 24 * 3600 * 1000) throw new GstAdapterError('CANCEL_WINDOW_OVER', 'IRN can only be cancelled within 24 hours on the IRP');
    if (!['1', '2', '3', '4'].includes(reasonCode) || !remark.trim()) throw new GstAdapterError('INVALID_INPUT', 'Reason code 1–4 and a remark are required');
    r.status = 'CNL';
    return { Irn: irn, CancelDate: ackDateIst(this.now()), isMock: true };
  }

  /**
   * B2C dynamic QR: a UPI payment link carrying the invoice reference and GST
   * break-up. Parameter names follow the NPCI/CBIC dynamic-QR guidance — re-check
   * them against the current NPCI spec before go-live.
   */
  b2cUpiQr(input: B2cQrInput): string {
    const t = input.computation.totals;
    const brk = [`CGST:${r2(t.cgst).toFixed(2)}`, `SGST:${r2(t.sgst).toFixed(2)}`, `IGST:${r2(t.igst).toFixed(2)}`, `CESS:${r2(t.cess).toFixed(2)}`].join('|');
    const q = new URLSearchParams();
    q.set('pa', input.payeeVpa);
    q.set('pn', input.payeeName.slice(0, 50));
    q.set('am', r2(t.grandTotal).toFixed(2));
    q.set('cu', 'INR');
    q.set('tr', input.invoiceNo);
    q.set('tn', `Invoice ${input.invoiceNo}`);
    q.set('gstIn', input.sellerGstin);
    q.set('invoiceNo', input.invoiceNo);
    q.set('invoiceDate', eInvoiceDate(input.invoiceDate));
    q.set('gstBrkUp', brk);
    return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
  }

  renderPdf(model: InvoiceRenderModel, format: PdfFormat) {
    return renderInvoicePdf(model, format);
  }
}
