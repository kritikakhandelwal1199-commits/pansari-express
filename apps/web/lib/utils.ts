import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatINR } from '@pansari/shared';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const rs = (paise: number) => formatINR(paise);
/** Rupees text → paise (accepts "245", "245.5", "1,245.50"). */
export function toPaise(v: string): number | null {
  const n = Number(String(v).replace(/[,₹\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function fmtDate(ms: number | null | undefined, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', ...opts });
}
export function fmtTime(ms: number) {
  return new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export const daysUntil = (ms: number | null) => (ms === null ? null : Math.ceil((ms - Date.now()) / 86_400_000));

export function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: string }).message).replace(/^Firebase:\s*/, '');
  return 'Something went wrong';
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Opens a PDF in a new tab (falls back to download when pop-ups are blocked). */
export function openPdf(blob: Blob, fileName: string) {
  if ((globalThis as { __PX_PREVIEW__?: boolean }).__PX_PREVIEW__) {
    window.dispatchEvent(new CustomEvent('px-toast', { detail: { tone: 'info', text: `${fileName} is ready — PDF downloads are switched off in this preview window, they work in the app` } }));
    return;
  }
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank', 'noopener');
  if (!w) downloadBlob(blob, fileName);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Deployment sub-path (e.g. "/pansari-express" on GitHub Pages), "" at the domain root. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** Absolute URL → in-app path for <Link>/router (drops origin and base path); null if it is another site. */
export function toAppPath(url: string): string | null {
  try {
    const u = new URL(url, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
    if (typeof window !== 'undefined' && u.origin !== window.location.origin) return null;
    const path = BASE_PATH && u.pathname.startsWith(BASE_PATH) ? u.pathname.slice(BASE_PATH.length) || '/' : u.pathname;
    return path + u.search;
  } catch {
    return null;
  }
}
