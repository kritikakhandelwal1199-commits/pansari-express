/**
 * GstAdapter — tax computation, e-invoice (IRP) payloads, invoice QR + PDFs.
 *
 * API HOLD MODE: MockGstProvider builds schema-shaped INV-01 JSON (e-invoice
 * schema v1.1), derives the IRN locally with SHA-256, and signs the invoice/QR
 * with a LOCAL test key. Nothing is sent to the IRP/GSP. A live GSP provider
 * implements the same interface later.
 */
import type { InvoiceComputation, TaxLineInput, InvoiceContext } from '@pansari/shared';

export interface PartyAddress {
  legalName: string;
  tradeName?: string;
  gstin: string | null;
  addr1: string;
  addr2?: string;
  location: string; // city / locality
  pincode: string;
  stateCode: string;
  phone?: string;
  email?: string;
}

export interface EInvoiceInput {
  computation: InvoiceComputation;
  docType: 'INV' | 'CRN' | 'DBN';
  docNo: string;
  docDate: Date;
  seller: PartyAddress & { gstin: string };
  buyer: PartyAddress & { gstin: string };
}

/** NIC e-invoice schema v1.1 (subset used for goods). Amounts in rupees. */
export interface EInvoicePayload {
  Version: '1.1';
  TranDtls: { TaxSch: 'GST'; SupTyp: 'B2B'; RegRev: 'N'; EcmGstin: null; IgstOnIntra: 'N' };
  DocDtls: { Typ: 'INV' | 'CRN' | 'DBN'; No: string; Dt: string };
  SellerDtls: Party;
  BuyerDtls: Party & { Pos: string };
  ItemList: EInvoiceItem[];
  ValDtls: {
    AssVal: number;
    CgstVal: number;
    SgstVal: number;
    IgstVal: number;
    CesVal: number;
    StCesVal: number;
    Discount: number;
    OthChrg: number;
    RndOffAmt: number;
    TotInvVal: number;
  };
}

interface Party {
  Gstin: string;
  LglNm: string;
  TrdNm?: string;
  Addr1: string;
  Addr2?: string;
  Loc: string;
  Pin: number;
  Stcd: string;
  Ph?: string;
  Em?: string;
}

export interface EInvoiceItem {
  SlNo: string;
  PrdDesc: string;
  IsServc: 'N' | 'Y';
  HsnCd: string;
  Qty: number;
  FreeQty: number;
  Unit: string;
  UnitPrice: number;
  TotAmt: number;
  Discount: number;
  PreTaxVal: number;
  AssAmt: number;
  GstRt: number;
  IgstAmt: number;
  CgstAmt: number;
  SgstAmt: number;
  CesRt: number;
  CesAmt: number;
  CesNonAdvlAmt: number;
  StateCesRt: number;
  StateCesAmt: number;
  StateCesNonAdvlAmt: number;
  OthChrg: number;
  TotItemVal: number;
  BchDtls?: { Nm: string; ExpDt?: string };
}

export interface IrpRegistration {
  Irn: string;
  AckNo: string;
  AckDt: string; // "yyyy-MM-dd HH:mm:ss" IST
  SignedInvoice: string; // JWS
  SignedQRCode: string; // JWS — encode this in the invoice QR
  Status: 'ACT' | 'CNL';
  isMock: boolean;
}

export interface B2cQrInput {
  sellerGstin: string;
  payeeVpa: string;
  payeeName: string;
  invoiceNo: string;
  invoiceDate: Date;
  computation: InvoiceComputation;
}

export interface InvoiceRenderModel {
  title?: string; // default "TAX INVOICE"
  invoiceNo: string;
  invoiceDate: Date;
  seller: { tradeName: string; legalName: string; gstin: string | null; fssaiLicenseNo: string | null; address: string; stateCode: string; phone?: string; storeName?: string };
  buyer: { name: string | null; gstin: string | null; address: string | null };
  computation: InvoiceComputation;
  orderRef?: string;
  paymentMode?: string;
  irn?: string | null;
  ackNo?: string | null;
  ackDate?: string | null;
  qrPayload?: string | null;
  qrCaption?: string;
  isMockIrn?: boolean;
  footerNote?: string;
}

export type PdfFormat = 'A4' | 'THERMAL_80MM';

export interface GstAdapter {
  readonly provider: string;
  compute(lines: TaxLineInput[], ctx: InvoiceContext): InvoiceComputation;
  buildEInvoice(input: EInvoiceInput): EInvoicePayload;
  generateIrn(sellerGstin: string, financialYear: string, docType: string, docNo: string): Promise<string>;
  register(payload: EInvoicePayload): Promise<IrpRegistration>;
  cancel(irn: string, reasonCode: '1' | '2' | '3' | '4', remark: string): Promise<{ Irn: string; CancelDate: string; isMock: boolean }>;
  b2cUpiQr(input: B2cQrInput): string;
  renderPdf(model: InvoiceRenderModel, format: PdfFormat): Promise<Uint8Array>;
}

export class GstAdapterError extends Error {
  constructor(readonly code: 'NOT_B2B' | 'INVALID_INPUT' | 'DUPLICATE_IRN' | 'NOT_FOUND' | 'CANCEL_WINDOW_OVER', message: string) {
    super(message);
    this.name = 'GstAdapterError';
  }
}
