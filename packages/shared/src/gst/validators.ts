import { isValidStateCode } from '../states.js';

const GSTIN_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Regular-taxpayer GSTIN layout: SS PPPPPPPPPP E Z C */
const GSTIN_REGULAR = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/** Any 15-char GSTIN-shaped id (TDS/TCS, UN bodies, NRTP use other layouts). */
const GSTIN_GENERIC = /^[0-9]{2}[0-9A-Z]{13}$/;

/**
 * GSTIN check digit — Luhn mod 36 over the first 14 characters.
 */
export function gstinCheckChar(first14: string): string {
  if (first14.length !== 14) throw new RangeError('Need exactly 14 characters');
  let factor = 2;
  let sum = 0;
  const mod = GSTIN_CHARSET.length;
  for (let i = first14.length - 1; i >= 0; i--) {
    const cp = GSTIN_CHARSET.indexOf(first14[i]!);
    if (cp < 0) throw new RangeError(`Invalid GSTIN character "${first14[i]}"`);
    let digit = factor * cp;
    factor = factor === 2 ? 1 : 2;
    digit = Math.floor(digit / mod) + (digit % mod);
    sum += digit;
  }
  return GSTIN_CHARSET[(mod - (sum % mod)) % mod]!;
}

export interface GstinCheck {
  valid: boolean;
  reason?: string;
  stateCode?: string;
  pan?: string;
  isRegularTaxpayer?: boolean;
}

export function validateGstin(raw: string): GstinCheck {
  const g = (raw ?? '').trim().toUpperCase();
  if (!GSTIN_GENERIC.test(g)) return { valid: false, reason: 'GSTIN must be 15 characters: 2-digit state code followed by 13 letters/digits' };
  const stateCode = g.slice(0, 2);
  if (!isValidStateCode(stateCode)) return { valid: false, reason: `Unknown state code ${stateCode}` };
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return { valid: false, reason: 'Check digit does not match — likely a typo' };
  const isRegularTaxpayer = GSTIN_REGULAR.test(g);
  return { valid: true, stateCode, pan: isRegularTaxpayer ? g.slice(2, 12) : undefined, isRegularTaxpayer };
}

export const isValidPan = (v: string) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test((v ?? '').trim().toUpperCase());
/** FSSAI licence / registration numbers are 14 digits. */
export const isValidFssai = (v: string) => /^[0-9]{14}$/.test((v ?? '').trim());
/** HSN must be 4, 6 or 8 digits (length required depends on turnover). */
export const isValidHsn = (v: string) => /^(\d{4}|\d{6}|\d{8})$/.test((v ?? '').trim());
export const isValidPincode = (v: string) => /^[1-9][0-9]{5}$/.test((v ?? '').trim());
/** Indian mobile in E.164. */
export const isValidIndianMobile = (v: string) => /^\+91[6-9][0-9]{9}$/.test((v ?? '').trim());
