'use client';
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, LogOut, Smartphone } from 'lucide-react';
import { Brand, ErrorNote } from '@/components/common';
import { Button, Card, Field, Input } from '@/components/ui';
import { useData, useStaff } from '@/lib/data/provider';
import { errMsg } from '@/lib/utils';

function LoginInner() {
  const data = useData();
  const { user } = useStaff();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/seller';
  const [phone, setPhone] = React.useState('');
  const [code, setCode] = React.useState('');
  const [vid, setVid] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const forShop = next.startsWith('/shop');
  const all = data.demoAccounts?.() ?? [];
  const accounts = forShop ? [...all].sort((a, b) => Number(b.label.startsWith('Customer')) - Number(a.label.startsWith('Customer'))) : all;

  const e164 = (v: string) => {
    const d = v.replace(/\D/g, '');
    return d.length === 10 ? `+91${d}` : d.length === 12 && d.startsWith('91') ? `+${d}` : v.trim();
  };

  async function send(p = phone) {
    setBusy(true);
    setError(null);
    try {
      const r = await data.sendOtp(e164(p));
      setVid(r.verificationId);
      setPhone(p);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function verify(c = code) {
    if (!vid) return;
    setBusy(true);
    setError(null);
    try {
      const u = await data.verifyOtp(vid, c);
      router.replace(u.role === 'staff' && next === '/seller' ? '/pos' : next);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function quick(p: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await data.sendOtp(p);
      const u = await data.verifyOtp(r.verificationId, '123456');
      router.replace(u.role === 'staff' && next === '/seller' ? '/pos' : next);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-[calc(100dvh-28px)] max-w-md content-center gap-6 px-4 py-10">
      <Brand sub={forShop ? 'Sign in to order — any mobile number works' : 'Sign in'} />
      {user ? (
        <Card className="flex items-center justify-between gap-3">
          <div className="text-sm">
            Signed in as <b>{user.displayName ?? user.phone}</b> ({user.role.replace('_', ' ')})
          </div>
          <Button variant="outline" size="sm" onClick={() => data.signOut()}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </Card>
      ) : null}
      <Card className="grid gap-4">
        {!vid ? (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <Field label="Mobile number" hint="We will send a 6-digit OTP.">
              <Input inputMode="tel" autoComplete="tel" placeholder="98XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
            </Field>
            <Button type="submit" size="lg" disabled={busy || phone.replace(/\D/g, '').length < 10}>
              {busy ? <Loader2 className="size-5 animate-spin" /> : <Smartphone className="size-5" />} Send OTP
            </Button>
          </form>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <Field label={`OTP sent to ${e164(phone)}`}>
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
            </Field>
            <Button type="submit" size="lg" disabled={busy || code.length !== 6}>
              {busy ? <Loader2 className="size-5 animate-spin" /> : null} Verify and continue
            </Button>
            <button type="button" className="text-sm font-semibold text-muted underline" onClick={() => setVid(null)}>
              Use a different number
            </button>
          </form>
        )}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </Card>

      {accounts.length ? (
        <section className="grid gap-2">
          <h2 className="text-sm font-bold text-muted">Demo accounts — one tap</h2>
          {accounts.map((a) => (
            <button key={a.phone} disabled={busy} onClick={() => quick(a.phone)} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left hover:border-haldi disabled:opacity-60">
              <span>
                <span className="block font-bold">{a.label}</span>
                <span className="text-[13px] text-muted">{a.note}</span>
              </span>
              <span className="num text-[13px] text-muted">{a.phone.replace('+91', '')}</span>
            </button>
          ))}
        </section>
      ) : null}
    </main>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginInner />
    </React.Suspense>
  );
}
