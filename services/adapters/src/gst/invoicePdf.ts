/**
 * GST invoice PDFs — A4 and 80 mm thermal — rendered with pdf-lib (pure JS, works
 * in Cloud Functions, browsers and React Native). QR codes are drawn as vector
 * modules, so no image encoding is needed.
 *
 * Standard PDF fonts cannot render "₹" or Devanagari, so text is reduced to
 * printable ASCII and amounts use "Rs.". Embed a Unicode font (e.g. Noto Sans +
 * Noto Sans Devanagari via @pdf-lib/fontkit) when Hindi item names are needed.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { eInvoiceDate, formatINR, stateName, type ComputedLine } from '@pansari/shared';
import type { InvoiceRenderModel, PdfFormat } from './GstAdapter.js';

const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.35, 0.35, 0.35);
const LIGHT = rgb(0.93, 0.93, 0.93);
const RED = rgb(0.7, 0.05, 0.1);

export function ascii(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/₹/g, 'Rs.')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/×/g, 'x')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

const amt = (p: number) => formatINR(p, { symbol: '' });

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = ascii(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const tryLine = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(tryLine, size) <= maxWidth) {
      cur = tryLine;
      continue;
    }
    if (cur) lines.push(cur);
    // hard-break very long tokens (e.g. IRN hashes)
    let rest = w;
    while (font.widthOfTextAtSize(rest, size) > maxWidth) {
      let i = rest.length;
      while (i > 1 && font.widthOfTextAtSize(rest.slice(0, i), size) > maxWidth) i--;
      lines.push(rest.slice(0, i));
      rest = rest.slice(i);
    }
    cur = rest;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function drawQr(page: PDFPage, payload: string, x: number, yTop: number, size: number) {
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 2;
  const cell = size / (n + quiet * 2);
  page.drawRectangle({ x, y: yTop - size, width: size, height: size, color: rgb(1, 1, 1) });
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && qr.modules.get(r, c)) c++;
      page.drawRectangle({
        x: x + (quiet + start) * cell,
        y: yTop - (quiet + r + 1) * cell,
        width: (c - start) * cell + 0.05,
        height: cell + 0.05,
        color: BLACK,
      });
    }
  }
}

function textRight(page: PDFPage, s: string, rightX: number, y: number, font: PDFFont, size: number, color = BLACK) {
  const t = ascii(s);
  page.drawText(t, { x: rightX - font.widthOfTextAtSize(t, size), y, size, font, color });
}

function textCenter(page: PDFPage, s: string, cx: number, y: number, font: PDFFont, size: number, color = BLACK) {
  const t = ascii(s);
  page.drawText(t, { x: cx - font.widthOfTextAtSize(t, size) / 2, y, size, font, color });
}

const pos = (m: InvoiceRenderModel) => `${stateName(m.computation.placeOfSupplyStateCode)} (${m.computation.placeOfSupplyStateCode})`;

/* ================================================================== */
/* A4                                                                  */
/* ================================================================== */

async function renderA4(m: InvoiceRenderModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${m.invoiceNo}`);
  doc.setAuthor(ascii(m.seller.legalName));
  doc.setCreator('Pansari Express');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28;
  const H = 841.89;
  const M = 36;
  const CW = W - 2 * M;
  const c = m.computation;
  const intra = c.supplyType === 'INTRA_STATE';
  const hasCess = c.totals.cess > 0;

  let page = doc.addPage([W, H]);
  let y = H - M;

  // ---- title
  textCenter(page, m.title ?? 'TAX INVOICE', W / 2, y - 14, bold, 15);
  textRight(page, 'Original for Recipient', W - M, y - 12, font, 7.5, GREY);
  y -= 26;
  if (m.isMockIrn) {
    textCenter(page, 'TEST MODE: IRN generated locally, not registered on the GST IRP', W / 2, y - 8, bold, 8, RED);
    y -= 14;
  }

  // ---- seller + meta box
  const half = CW / 2;
  const left: { t: string; f: PDFFont; s: number }[] = [
    { t: m.seller.tradeName, f: bold, s: 12 },
    ...(m.seller.legalName && m.seller.legalName !== m.seller.tradeName ? [{ t: m.seller.legalName, f: font, s: 8.5 }] : []),
    ...(m.seller.storeName ? [{ t: `Store: ${m.seller.storeName}`, f: font, s: 8.5 }] : []),
    ...wrap(m.seller.address, font, 8.5, half - 16).map((t) => ({ t, f: font, s: 8.5 })),
    { t: `GSTIN: ${m.seller.gstin ?? 'Unregistered'}`, f: bold, s: 8.5 },
    ...(m.seller.fssaiLicenseNo ? [{ t: `FSSAI Lic. No: ${m.seller.fssaiLicenseNo}`, f: font, s: 8.5 }] : []),
    { t: `State: ${stateName(m.seller.stateCode)} (${m.seller.stateCode})`, f: font, s: 8.5 },
    ...(m.seller.phone ? [{ t: `Phone: ${m.seller.phone}`, f: font, s: 8.5 }] : []),
  ];
  const right: [string, string][] = [
    ['Invoice No', m.invoiceNo],
    ['Invoice Date', eInvoiceDate(m.invoiceDate)],
    ['Place of Supply', pos(m)],
    ['Supply Type', intra ? 'Intra-state (CGST + SGST)' : 'Inter-state (IGST)'],
    ['Invoice Type', c.kind],
    ...(m.orderRef ? ([['Order Ref', m.orderRef]] as [string, string][]) : []),
    ...(m.paymentMode ? ([['Payment', m.paymentMode]] as [string, string][]) : []),
  ];
  const lh = 11.5;
  const boxH = Math.max(left.reduce((a, l) => a + (l.s > 10 ? 15 : lh), 0), right.length * lh) + 14;
  page.drawRectangle({ x: M, y: y - boxH, width: CW, height: boxH, borderColor: BLACK, borderWidth: 0.7 });
  page.drawLine({ start: { x: M + half, y }, end: { x: M + half, y: y - boxH }, thickness: 0.5, color: BLACK });
  let ly = y - 16;
  for (const l of left) {
    page.drawText(ascii(l.t), { x: M + 8, y: ly, size: l.s, font: l.f });
    ly -= l.s > 10 ? 15 : lh;
  }
  let ry = y - 16;
  for (const [k, v] of right) {
    page.drawText(ascii(k), { x: M + half + 8, y: ry, size: 8.5, font, color: GREY });
    page.drawText(ascii(v), { x: M + half + 90, y: ry, size: 8.5, font: bold });
    ry -= lh;
  }
  y -= boxH;

  // ---- buyer box
  const buyerLines = [
    `Bill To: ${m.buyer.name ?? 'Walk-in customer'}`,
    ...(m.buyer.gstin ? [`GSTIN: ${m.buyer.gstin}`] : []),
    ...(m.buyer.address ? wrap(m.buyer.address, font, 8.5, CW - 16) : []),
  ];
  const irnLines = m.irn ? [...wrap(`IRN: ${m.irn}`, font, 7.5, CW - 16), `Ack No: ${m.ackNo ?? '-'}    Ack Date: ${m.ackDate ?? '-'}`] : [];
  const bH = (buyerLines.length + irnLines.length) * lh + 10;
  page.drawRectangle({ x: M, y: y - bH, width: CW, height: bH, borderColor: BLACK, borderWidth: 0.7 });
  let by = y - 14;
  buyerLines.forEach((t, i) => {
    page.drawText(ascii(t), { x: M + 8, y: by, size: 8.5, font: i === 0 ? bold : font });
    by -= lh;
  });
  irnLines.forEach((t) => {
    page.drawText(ascii(t), { x: M + 8, y: by, size: 7.5, font, color: GREY });
    by -= lh;
  });
  y -= bH + 10;

  // ---- items table
  type Col = { h: string; w: number; right?: boolean; v: (l: ComputedLine) => string };
  const itemW = 145 - (hasCess ? 40 : 0);
  const cols: Col[] = [
    { h: '#', w: 18, v: (l) => String(l.slNo) },
    { h: 'Item', w: itemW, v: (l) => l.name + (l.batchNumber ? ` (Batch ${l.batchNumber}${l.expiryDate ? `, Exp ${l.expiryDate}` : ''})` : '') },
    { h: 'HSN', w: 46, v: (l) => l.hsnCode },
    { h: 'Qty', w: 34, right: true, v: (l) => `${l.qty} ${l.unit}` },
    { h: 'Rate', w: 50, right: true, v: (l) => amt(l.unitPrice) },
    { h: 'Taxable', w: 56, right: true, v: (l) => amt(l.taxable) },
    { h: 'GST%', w: 30, right: true, v: (l) => String(l.gstSlab) },
    ...(intra
      ? [
          { h: 'CGST', w: 44, right: true, v: (l: ComputedLine) => amt(l.cgst) },
          { h: 'SGST', w: 44, right: true, v: (l: ComputedLine) => amt(l.sgst) },
        ]
      : [{ h: 'IGST', w: 88, right: true, v: (l: ComputedLine) => amt(l.igst) }]),
    ...(hasCess ? [{ h: 'Cess', w: 40, right: true, v: (l: ComputedLine) => amt(l.cess) }] : []),
    { h: 'Total', w: 56, right: true, v: (l) => amt(l.total) },
  ];

  const drawHeader = () => {
    page.drawRectangle({ x: M, y: y - 16, width: CW, height: 16, color: LIGHT });
    let x = M;
    for (const col of cols) {
      if (col.right) textRight(page, col.h, x + col.w - 3, y - 11, bold, 7.5);
      else page.drawText(col.h, { x: x + 3, y: y - 11, size: 7.5, font: bold });
      x += col.w;
    }
    y -= 16;
  };
  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - M;
    textRight(page, `${m.invoiceNo} (continued)`, W - M, y - 8, font, 8, GREY);
    y -= 18;
    drawHeader();
  };

  drawHeader();
  for (const l of c.lines) {
    const nameLines = wrap(cols[1]!.v(l), font, 7.5, cols[1]!.w - 6);
    const rowH = nameLines.length * 9 + 5;
    if (y - rowH < M + 60) newPage();
    let x = M;
    for (const [i, col] of cols.entries()) {
      if (i === 1) {
        nameLines.forEach((t, j) => page.drawText(t, { x: x + 3, y: y - 10 - j * 9, size: 7.5, font }));
      } else if (col.right) {
        textRight(page, col.v(l), x + col.w - 3, y - 10, font, 7.5);
      } else {
        page.drawText(ascii(col.v(l)), { x: x + 3, y: y - 10, size: 7.5, font });
      }
      x += col.w;
    }
    y -= rowH;
    page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.3, color: GREY });
  }

  // ---- HSN summary
  const hsnCols: { h: string; w: number; v: (r: (typeof c.hsnSummary)[number]) => string }[] = [
    { h: 'HSN', w: 80, v: (r) => r.hsnCode },
    { h: 'Taxable', w: 80, v: (r) => amt(r.taxable) },
    { h: 'Rate', w: 50, v: (r) => `${r.gstSlab}%` },
    { h: 'CGST', w: 65, v: (r) => amt(r.cgst) },
    { h: 'SGST', w: 65, v: (r) => amt(r.sgst) },
    { h: 'IGST', w: 65, v: (r) => amt(r.igst) },
    { h: 'Cess', w: 50, v: (r) => amt(r.cess) },
    { h: 'Total Tax', w: CW - 455, v: (r) => amt(r.totalTax) },
  ];
  const hsnH = 16 + c.hsnSummary.length * 12 + 22;
  if (y - hsnH - 170 < M) {
    page = doc.addPage([W, H]);
    y = H - M;
  }
  y -= 12;
  page.drawText('HSN / SAC summary', { x: M, y: y - 8, size: 8.5, font: bold });
  y -= 14;
  page.drawRectangle({ x: M, y: y - 14, width: CW, height: 14, color: LIGHT });
  let hx = M;
  for (const col of hsnCols) {
    textRight(page, col.h, hx + col.w - 4, y - 10, bold, 7.5);
    hx += col.w;
  }
  y -= 14;
  for (const r of c.hsnSummary) {
    hx = M;
    for (const col of hsnCols) {
      textRight(page, col.v(r), hx + col.w - 4, y - 10, font, 7.5);
      hx += col.w;
    }
    y -= 12;
  }
  page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.5, color: BLACK });

  // ---- totals + words + QR
  y -= 10;
  const t = c.totals;
  const totals: [string, number, boolean][] = [
    ['Taxable value', t.taxable, false],
    ...(intra ? ([['CGST', t.cgst, false], ['SGST', t.sgst, false]] as [string, number, boolean][]) : ([['IGST', t.igst, false]] as [string, number, boolean][])),
    ...(hasCess ? ([['Cess', t.cess, false]] as [string, number, boolean][]) : []),
    ['Round off', t.roundOff, false],
    ['Grand Total (Rs.)', t.grandTotal, true],
  ];
  const tx = M + CW - 200;
  let ty = y;
  for (const [k, v, isBold] of totals) {
    page.drawText(k, { x: tx, y: ty - 10, size: isBold ? 10.5 : 8.5, font: isBold ? bold : font });
    textRight(page, amt(v), M + CW, ty - 10, isBold ? bold : font, isBold ? 10.5 : 8.5);
    ty -= isBold ? 16 : 12;
  }
  const qrSize = 110;
  let wy = y;
  if (m.qrPayload) {
    drawQr(page, m.qrPayload, M, y, qrSize);
    if (m.qrCaption) page.drawText(ascii(m.qrCaption), { x: M, y: y - qrSize - 10, size: 7, font, color: GREY });
  }
  const wordsX = m.qrPayload ? M + qrSize + 12 : M;
  const wordsW = tx - wordsX - 12;
  page.drawText('Amount in words', { x: wordsX, y: wy - 10, size: 7.5, font, color: GREY });
  wy -= 20;
  for (const line of wrap(c.amountInWords, bold, 8.5, wordsW)) {
    page.drawText(line, { x: wordsX, y: wy, size: 8.5, font: bold });
    wy -= 11;
  }
  if (t.discount) {
    wy -= 4;
    page.drawText(`Discount allowed: Rs. ${amt(t.discount)} (deducted before tax)`, { x: wordsX, y: wy, size: 7.5, font, color: GREY });
    wy -= 11;
  }
  y = Math.min(ty, y - (m.qrPayload ? qrSize + 16 : 0), wy) - 14;

  // ---- declaration + signature
  const decl = [
    'Declaration: We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
    ...(m.footerNote ? [m.footerNote] : []),
    'This is a computer generated invoice and does not require a physical signature.',
  ];
  for (const d of decl) {
    for (const line of wrap(d, font, 7.5, CW - 180)) {
      page.drawText(line, { x: M, y, size: 7.5, font, color: GREY });
      y -= 10;
    }
  }
  textRight(page, `For ${m.seller.tradeName}`, M + CW, y + 10 * decl.length, bold, 8.5);
  textRight(page, 'Authorised Signatory', M + CW, y - 8, font, 7.5, GREY);

  // ---- page numbers
  const pages = doc.getPages();
  pages.forEach((p, i) => textCenter(p, `Page ${i + 1} of ${pages.length}`, W / 2, 18, font, 7, GREY));
  return doc.save();
}

/* ================================================================== */
/* 80 mm thermal                                                       */
/* ================================================================== */

type Row =
  | { k: 'text'; t: string; size: number; bold?: boolean; align?: 'left' | 'center' }
  | { k: 'kv'; l: string; r: string; size: number; bold?: boolean }
  | { k: 'rule' }
  | { k: 'gap'; h: number }
  | { k: 'qr'; payload: string; size: number };

async function renderThermal(m: InvoiceRenderModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Receipt ${m.invoiceNo}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 226.77; // 80 mm
  const M = 9;
  const CW = W - 2 * M;
  const c = m.computation;
  const intra = c.supplyType === 'INTRA_STATE';

  const rows: Row[] = [];
  const text = (t: string, size = 7.5, b = false, align: 'left' | 'center' = 'left') => {
    for (const line of wrap(t, b ? bold : font, size, CW)) rows.push({ k: 'text', t: line, size, bold: b, align });
  };
  const kv = (l: string, r: string, size = 7.5, b = false) => rows.push({ k: 'kv', l, r, size, bold: b });

  text(m.title ?? 'TAX INVOICE', 9, true, 'center');
  text(m.seller.tradeName, 11, true, 'center');
  if (m.seller.storeName) text(m.seller.storeName, 7.5, false, 'center');
  text(m.seller.address, 7, false, 'center');
  text(`GSTIN: ${m.seller.gstin ?? 'Unregistered'}`, 7.5, true, 'center');
  if (m.seller.fssaiLicenseNo) text(`FSSAI: ${m.seller.fssaiLicenseNo}`, 7, false, 'center');
  if (m.seller.phone) text(`Ph: ${m.seller.phone}`, 7, false, 'center');
  rows.push({ k: 'rule' });
  kv('Invoice', m.invoiceNo, 7.5, true);
  kv('Date', eInvoiceDate(m.invoiceDate));
  kv('Place of supply', pos(m));
  if (m.buyer.name || m.buyer.gstin) {
    kv('Customer', m.buyer.name ?? '-');
    if (m.buyer.gstin) kv('Cust. GSTIN', m.buyer.gstin);
  }
  if (m.paymentMode) kv('Payment', m.paymentMode);
  rows.push({ k: 'rule' });
  for (const l of c.lines) {
    text(`${l.slNo}. ${l.name}`, 7.5, true);
    kv(`  ${l.qty} x ${amt(l.unitPrice)}  HSN ${l.hsnCode}  GST ${l.gstSlab}%`, amt(l.total), 7);
  }
  rows.push({ k: 'rule' });
  kv('Taxable value', amt(c.totals.taxable));
  if (intra) {
    kv('CGST', amt(c.totals.cgst));
    kv('SGST', amt(c.totals.sgst));
  } else kv('IGST', amt(c.totals.igst));
  if (c.totals.cess) kv('Cess', amt(c.totals.cess));
  kv('Round off', amt(c.totals.roundOff));
  if (c.totals.discount) kv('You saved (discount)', amt(c.totals.discount), 7);
  rows.push({ k: 'gap', h: 2 });
  kv('TOTAL Rs.', amt(c.totals.grandTotal), 10.5, true);
  text(c.amountInWords, 6.5);
  rows.push({ k: 'rule' });
  text('GST break-up', 7, true);
  for (const r of c.hsnSummary) {
    kv(`HSN ${r.hsnCode} @${r.gstSlab}%  on ${amt(r.taxable)}`, amt(r.totalTax), 6.5);
  }
  if (m.irn) {
    rows.push({ k: 'rule' });
    text(`IRN: ${m.irn}`, 6);
    text(`Ack ${m.ackNo ?? '-'}  ${m.ackDate ?? ''}`, 6);
  }
  if (m.isMockIrn) text('TEST MODE: IRN not registered on IRP', 6.5, true, 'center');
  if (m.qrPayload) {
    rows.push({ k: 'gap', h: 4 });
    rows.push({ k: 'qr', payload: m.qrPayload, size: 120 });
    if (m.qrCaption) text(m.qrCaption, 6.5, false, 'center');
  }
  rows.push({ k: 'gap', h: 4 });
  if (m.footerNote) text(m.footerNote, 6.5, false, 'center');
  text('Thank you! Computer generated invoice.', 7, false, 'center');

  const heightOf = (r: Row) => (r.k === 'text' || r.k === 'kv' ? r.size + 3 : r.k === 'rule' ? 7 : r.k === 'gap' ? r.h : r.size + 4);
  const H = Math.max(200, rows.reduce((a, r) => a + heightOf(r), 0) + 2 * M);
  const page = doc.addPage([W, H]);
  let y = H - M;
  for (const r of rows) {
    const h = heightOf(r);
    if (r.k === 'text') {
      const f = r.bold ? bold : font;
      if (r.align === 'center') textCenter(page, r.t, W / 2, y - r.size, f, r.size);
      else page.drawText(r.t, { x: M, y: y - r.size, size: r.size, font: f });
    } else if (r.k === 'kv') {
      const f = r.bold ? bold : font;
      const rightW = f.widthOfTextAtSize(ascii(r.r), r.size);
      const leftLines = wrap(r.l, f, r.size, CW - rightW - 6);
      page.drawText(leftLines[0] ?? '', { x: M, y: y - r.size, size: r.size, font: f });
      textRight(page, r.r, W - M, y - r.size, f, r.size);
    } else if (r.k === 'rule') {
      page.drawLine({ start: { x: M, y: y - 3.5 }, end: { x: W - M, y: y - 3.5 }, thickness: 0.5, color: BLACK, dashArray: [2, 1.5] });
    } else if (r.k === 'qr') {
      drawQr(page, r.payload, (W - r.size) / 2, y, r.size);
    }
    y -= h;
  }
  return doc.save();
}

export async function renderInvoicePdf(model: InvoiceRenderModel, format: PdfFormat): Promise<Uint8Array> {
  if (!model.invoiceNo || !model.computation?.lines?.length) throw new Error('Invoice model needs an invoice number and at least one line');
  return format === 'A4' ? renderA4(model) : renderThermal(model);
}
