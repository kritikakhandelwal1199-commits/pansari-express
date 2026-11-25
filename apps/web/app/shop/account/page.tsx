'use client';
import * as React from 'react';
import Link from 'next/link';
import { Loader2, LogOut, MapPin, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { ErrorNote, useToast } from '@/components/common';
import { AddressForm, useShop } from '@/components/shop';
import { Button, Card, CardTitle, Dialog, DialogContent, EmptyState, Field, Input } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { Address } from '@/lib/data/types';
import { cn, errMsg, fmtTime, rs, toPaise } from '@/lib/utils';

const TXN_LABEL = { TOPUP: 'Money added', ORDER_DEBIT: 'Paid for order', REFUND: 'Refund', ADJUSTMENT: 'Adjustment' } as const;

export default function AccountPage() {
  const shop = useShop();
  const data = useData();
  const toast = useToast();
  const txns = useResource(() => (shop.isCustomer ? data.walletTxns() : Promise.resolve([])), [data, shop.user?.uid, shop.isCustomer, shop.profile?.walletBalance]);
  const [name, setName] = React.useState('');
  const [edit, setEdit] = React.useState<Address | 'new' | null>(null);
  const [topOpen, setTopOpen] = React.useState(false);
  const [amount, setAmount] = React.useState('500');
  const [fail, setFail] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => setName(shop.profile?.displayName ?? ''), [shop.profile?.displayName]);

  if (shop.ready && !shop.isCustomer) {
    return (
      <main className="mx-auto max-w-xl px-4 pt-6">
        <EmptyState title={shop.user ? 'This is a shop account' : 'Sign in to your account'}>
          <p>{shop.user ? 'Sign in with a customer mobile number to order for delivery.' : 'Track orders, save addresses and use your wallet.'}</p>
          <Button asChild className="mt-3">
            <Link href="/login?next=/shop/account">{shop.user ? 'Switch account' : 'Sign in'}</Link>
          </Button>
        </EmptyState>
      </main>
    );
  }

  async function saveName() {
    try {
      await data.saveProfileName(name);
      shop.reloadProfile();
      toast({ tone: 'good', text: 'Name saved' });
    } catch (e) {
      toast({ tone: 'bad', text: errMsg(e) });
    }
  }
  async function topUp() {
    const p = toPaise(amount);
    if (!p) return setErr('Enter an amount');
    setBusy(true);
    setErr(null);
    try {
      const r = await data.topUpWallet(p, fail ? 'fail' : 'success');
      toast({ tone: 'good', text: `Added · balance ${rs(r.balance)}` });
      setTopOpen(false);
      shop.reloadProfile();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid max-w-2xl gap-4 px-4 pt-5">
      <h1 className="text-2xl font-extrabold">Account</h1>

      <Card className="grid gap-3">
        <div className="text-sm text-muted">Signed in as {shop.user?.phone}</div>
        <div className="flex items-end gap-2">
          <Field label="Your name" className="flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" />
          </Field>
          <Button variant="outline" onClick={saveName} disabled={name.trim().length < 2 || name === shop.profile?.displayName}>
            Save
          </Button>
        </div>
      </Card>

      <Card className="grid gap-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-5 text-kum" /> Pansari wallet
          </CardTitle>
          <Button size="sm" onClick={() => setTopOpen(true)}>
            <Plus className="size-4" /> Add money
          </Button>
        </div>
        <div className="num text-3xl font-extrabold">{rs(shop.profile?.walletBalance ?? 0)}</div>
        <ul className="divide-y divide-line text-sm">
          {txns.data?.slice(0, 8).map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <span className="block font-semibold">{TXN_LABEL[t.kind]}</span>
                <span className="num text-[12px] text-muted">
                  {fmtTime(t.atMs)}
                  {t.note ? ` · ${t.note}` : ''}
                </span>
              </span>
              <span className={cn('num font-bold', t.amount > 0 ? 'text-leaf' : '')}>
                {t.amount > 0 ? '+' : '−'}
                {rs(Math.abs(t.amount))}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="grid gap-3">
        <div className="flex items-center justify-between">
          <CardTitle>Saved addresses</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setEdit('new')}>
            <Plus className="size-4" /> Add
          </Button>
        </div>
        {shop.profile?.addresses.length === 0 ? <p className="text-sm text-muted">No addresses yet.</p> : null}
        {shop.profile?.addresses.map((a) => (
          <div key={a.id} className="flex items-start gap-3 rounded-2xl border border-line p-3">
            <MapPin className="mt-0.5 size-5 shrink-0 text-kum" />
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-bold">{a.label}</div>
              <div className="text-muted">
                {a.line1}
                {a.line2 ? `, ${a.line2}` : ''}, {a.city} {a.pincode}
              </div>
            </div>
            <button onClick={() => setEdit(a)} className="rounded-lg p-2 hover:bg-surface-2" aria-label={`Edit ${a.label}`}>
              <Pencil className="size-4" />
            </button>
            <button
              onClick={async () => {
                await data.deleteAddress(a.id);
                shop.reloadProfile();
              }}
              className="rounded-lg p-2 text-danger hover:bg-danger/10"
              aria-label={`Delete ${a.label}`}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </Card>

      <Button variant="ghost" className="justify-self-start" onClick={() => data.signOut()}>
        <LogOut className="size-4" /> Sign out
      </Button>

      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)}>
        <DialogContent title={edit === 'new' ? 'New address' : 'Edit address'}>
          {edit ? (
            <AddressForm
              initial={edit === 'new' ? undefined : edit}
              onCancel={() => setEdit(null)}
              onDone={(a) => {
                shop.chooseAddress(a.id);
                shop.reloadProfile();
                setEdit(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={topOpen} onOpenChange={setTopOpen}>
        <DialogContent title="Add money to wallet" description="Test mode: no real money moves.">
          <div className="flex gap-2">
            {['200', '500', '1000'].map((v) => (
              <button key={v} onClick={() => setAmount(v)} className={cn('num h-10 flex-1 rounded-xl border font-bold', amount === v ? 'border-kum bg-kum text-kum-ink' : 'border-line')}>
                ₹{v}
              </button>
            ))}
          </div>
          <Field label="Amount (₹)">
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} /> Simulate a failed UPI payment
          </label>
          {err ? <ErrorNote>{err}</ErrorNote> : null}
          <Button size="lg" onClick={topUp} disabled={busy}>
            {busy ? <Loader2 className="size-5 animate-spin" /> : null} Pay by UPI (test)
          </Button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
