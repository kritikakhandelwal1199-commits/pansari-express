import type { Paise } from '../money.js';

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below100(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  const o = ONES[n % 10]!;
  return o ? `${t} ${o}` : t;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r) parts.push(below100(r));
  return parts.join(' ');
}

/** Integer → words in the Indian system (thousand, lakh, crore). */
export function integerToIndianWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`Cannot convert ${n}`);
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 1_00_00_000);
  let rest = n % 1_00_00_000;
  if (crore) parts.push(`${integerToIndianWords(crore)} Crore`);
  const lakh = Math.floor(rest / 1_00_000);
  rest %= 1_00_000;
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

/** 123456 paise → "Rupees One Thousand Two Hundred Thirty Four and Fifty Six Paise Only" */
export function amountInWords(p: Paise): string {
  const abs = Math.abs(Math.round(p));
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  const neg = p < 0 ? 'Minus ' : '';
  const r = `Rupees ${integerToIndianWords(rupees)}`;
  return paise ? `${neg}${r} and ${below100(paise)} Paise Only` : `${neg}${r} Only`;
}
