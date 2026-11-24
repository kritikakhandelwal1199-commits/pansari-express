/**
 * All money is handled as integer paise to avoid floating-point drift.
 * 1 rupee = 100 paise. Convert to rupees only for display / e-invoice JSON.
 */
export type Paise = number;

export function assertPaise(v: number, label = 'amount'): asserts v is Paise {
  if (!Number.isSafeInteger(v)) throw new RangeError(`${label} must be an integer number of paise, got ${v}`);
}

export function rupeesToPaise(rupees: number): Paise {
  if (!Number.isFinite(rupees)) throw new RangeError(`Invalid rupee amount: ${rupees}`);
  return Math.round(rupees * 100);
}

/** Paise → rupees with exactly 2 decimals as a number (for e-invoice JSON). */
export function paiseToRupees(p: Paise): number {
  return Math.round(p) / 100;
}

/** Paise → "1,23,456.78" (Indian digit grouping). */
export function formatINR(p: Paise, opts: { symbol?: string } = {}): string {
  const neg = p < 0;
  const abs = Math.abs(Math.round(p));
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  const s = String(rupees);
  let grouped: string;
  if (s.length <= 3) {
    grouped = s;
  } else {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    grouped = `${rest},${last3}`;
  }
  const symbol = opts.symbol ?? '₹';
  return `${neg ? '-' : ''}${symbol}${grouped}.${String(paise).padStart(2, '0')}`;
}

/** Round half away from zero (banker's rounding is NOT used on GST invoices). */
export function roundHalfUp(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}
