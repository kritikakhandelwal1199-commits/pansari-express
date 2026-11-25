'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import QRCode from 'qrcode';
import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react';
import { useData, useStaff } from '@/lib/data/provider';
import type { AppUser } from '@/lib/data/types';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ Brand */
export function Brand({ className, sub }: { className?: string; sub?: string }) {
  return (
    <Link href="/" className={cn('group inline-flex flex-col leading-none', className)}>
      <span className="font-brand text-[26px] text-kum">Pansari Express</span>
      {sub ? <span className="mt-1 text-xs font-semibold text-muted">{sub}</span> : null}
    </Link>
  );
}

/* ------------------------------------------------------------------ QR */
export function Qr({ value, size = 200, className, label }: { value: string; size?: number; className?: string; label?: string }) {
  const path = React.useMemo(() => {
    const q = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const n = q.modules.size;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.modules.get(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
    return { d, n: n + 4 };
  }, [value]);
  return (
    <svg viewBox={`0 0 ${path.n} ${path.n}`} width={size} height={size} className={cn('h-auto max-w-full rounded-lg bg-white', className)} role="img" aria-label={label ?? 'QR code'} shapeRendering="crispEdges">
      <rect width={path.n} height={path.n} fill="#fff" />
      <path d={path.d} fill="#1a0f0a" />
    </svg>
  );
}

/* ------------------------------------------------------------------ Toasts */
type Toast = { id: number; tone: 'good' | 'bad' | 'info'; text: string };
const ToastCtx = React.createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => React.useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);
  const push = React.useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { ...t, id }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3800);
  }, []);
  React.useEffect(() => {
    const on = (e: Event) => push((e as CustomEvent<Omit<Toast, 'id'>>).detail);
    window.addEventListener('px-toast', on);
    return () => window.removeEventListener('px-toast', on);
  }, [push]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8 }}
              className={cn('pointer-events-auto flex max-w-md items-center gap-2 rounded-2xl border px-4 py-3 text-[15px] font-semibold shadow-xl', t.tone === 'bad' ? 'border-danger/40 bg-surface text-danger' : 'border-line bg-[#1e120b] text-[#fff6e6]')}
            >
              {t.tone === 'bad' ? <TriangleAlert className="size-5 shrink-0" /> : <CheckCircle2 className="size-5 shrink-0 text-haldi" />}
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------------------------------------------ Staff guard */
export function RequireStaff({ roles, children }: { roles: AppUser['role'][]; children: (u: AppUser) => React.ReactNode }) {
  const { user, ready } = useStaff();
  const router = useRouter();
  const path = usePathname();
  const allowed = !!user && roles.includes(user.role);
  React.useEffect(() => {
    if (ready && !user) router.replace(`/login?next=${encodeURIComponent(path || '/seller')}`);
  }, [ready, user, router, path]);
  if (!ready || !user) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-muted">
        <Loader2 className="size-6 animate-spin" aria-label="Loading" />
      </div>
    );
  }
  if (!allowed) return <NotStaff user={user} />;
  return <>{children(user)}</>;
}

function NotStaff({ user }: { user: AppUser }) {
  const data = useData();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  async function setup() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await data.bootstrap!();
      setMsg(`Done — ${r.stores} stores and ${r.products} products loaded. Opening People & roles — add the shop owner next…`);
      setTimeout(() => window.location.assign(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/admin/users`), 1200);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Setup failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto grid min-h-[60vh] max-w-md place-items-center px-6 text-center">
      <div>
        <p className="text-lg font-bold">This area is for shop staff</p>
        <p className="mt-1 text-muted">You are signed in as a {user.role.replace('_', ' ')}. Sign in with a shop account to continue.</p>
        <Link href="/login" className="mt-4 inline-block font-semibold text-kum underline">
          Switch account
        </Link>
        {data.bootstrap && user.role === 'customer' ? (
          <div className="mt-8 grid gap-2 rounded-2xl border border-line bg-surface p-4">
            <p className="text-sm text-muted">New installation? The admin number set in deploy can run first-time setup once.</p>
            <button disabled={busy} onClick={setup} className="h-11 rounded-xl bg-kum px-4 font-semibold text-kum-ink disabled:opacity-50">
              {busy ? 'Setting up…' : 'First-time setup: make me the super admin'}
            </button>
            {msg ? <p className="text-sm">{msg}</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Store picker (remembered) */
export function useSelectedStore(storeIds: string[]) {
  const [storeId, setStoreId] = React.useState<string>('');
  React.useEffect(() => {
    if (!storeIds.length) return;
    let saved = '';
    try {
      saved = localStorage.getItem('pansari-store') ?? '';
    } catch {}
    setStoreId((cur) => (cur && storeIds.includes(cur) ? cur : storeIds.includes(saved) ? saved : storeIds[0]!));
  }, [storeIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (id: string) => {
    setStoreId(id);
    try {
      localStorage.setItem('pansari-store', id);
    } catch {}
  };
  return [storeId, choose] as const;
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/8 px-3 py-2 text-sm font-medium text-danger" role="alert">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function DemoRibbon() {
  const path = usePathname();
  if ((process.env.NEXT_PUBLIC_DATA_MODE ?? 'demo') !== 'demo' || path?.startsWith('/pos')) return null;
  return <div className="no-print bg-haldi px-4 py-1 text-center text-[13px] font-semibold text-[#3a1d05]">Demo mode: sample shop data saved in this browser only. OTP for every number is 123456.</div>;
}
