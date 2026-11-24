/**
 * Invoice numbering under Rule 46(b) CGST Rules: consecutive serial number,
 * max 16 characters, letters/digits plus "-" and "/", unique per financial year.
 * Indian financial year runs 1 April – 31 March and is decided in IST.
 */

const IST_OFFSET_MS = 330 * 60 * 1000;

/** Calendar parts of an instant as seen in India. */
export function istParts(at: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const d = new Date(at.getTime() + IST_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** "2026-27" for any date between 1 Apr 2026 and 31 Mar 2027 (IST). */
export function financialYear(at: Date = new Date()): string {
  const { year, month } = istParts(at);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** "2026-27" → "26-27" */
export function shortFinancialYear(fy: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!m) throw new RangeError(`Bad financial year "${fy}"`);
  return `${m[1]!.slice(2)}-${m[2]}`;
}

export const INVOICE_NO_PATTERN = /^[A-Za-z0-9/-]{1,16}$/;
export const INVOICE_NO_MAX = 16;

/**
 * Builds e.g. "PX/26-27/000123". The serial is zero-padded to fill the
 * available width (up to 6 digits); throws if the serial cannot fit in 16 chars.
 */
export function formatInvoiceNo(prefix: string, fy: string, seq: number): string {
  if (!/^[A-Za-z0-9-]{1,6}$/.test(prefix)) throw new RangeError('Invoice prefix: 1–6 letters/digits/hyphen');
  if (!Number.isSafeInteger(seq) || seq < 1) throw new RangeError('Sequence must be a positive integer');
  const head = `${prefix}/${shortFinancialYear(fy)}/`;
  const room = INVOICE_NO_MAX - head.length;
  const digits = String(seq);
  if (digits.length > room) throw new RangeError(`Sequence ${seq} does not fit in a 16-character invoice number with prefix "${prefix}"`);
  const no = head + digits.padStart(Math.min(6, room), '0');
  if (!INVOICE_NO_PATTERN.test(no)) throw new RangeError(`Generated invoice number "${no}" is invalid`);
  return no;
}

/** dd/mm/yyyy in IST (e-invoice DocDtls.Dt format). */
export function eInvoiceDate(at: Date): string {
  const { year, month, day } = istParts(at);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}
