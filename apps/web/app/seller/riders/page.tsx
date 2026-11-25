'use client';
import * as React from 'react';
import { Banknote, Phone } from 'lucide-react';
import { PAYOUT_METHODS, RIDER_COD_CASH_LIMIT, type PayoutMethod } from '@pansari/shared';
import { ErrorNote, useToast } from '@/components/common';
import { KYC_STATUS } from '@/components/phase4';
import { PageHead, useSeller } from '@/components/seller';
import { Badge, Button, Card, CardTitle, Dialog, DialogContent, EmptyState, Field, Input, Select, Skeleton } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { RiderProfile } from '@/lib/data/types';
import { cn, errMsg, fmtTime, rs, toPaise } from '@/lib/utils';

export default function RidersPage() {
  const { storeId, store, user } = useSeller();
  const data = useData();
  const toast = useToast();
  const riders = useResource(() => (storeId ? data.listStoreRiders(storeId) : Promise.resolve([])), [data, storeId]);
  const [cashFor, setCashFor] = React.useState<RiderProfile | null>(null);
  const [mode, setMode] = React.useState<'cash' | 'ledger' | 'pay'>('cash');
  const [method, setMethod] = React.useState<PayoutMethod>('UPI');
  const [refNo, setRefNo] = React.useState('');
  const isOwner = user.role === 'seller';
  const payouts = useResource(() => (cashFor && mode !== 'cash' && isOwner ? data.listPayouts(cashFor.uid) : Promise.resolve([])), [data, cashFor?.uid, mode]);
  const [amount, setAmount] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const ledger = useResource(() => (cashFor ? data.riderCash(cashFor.uid) : Promise.resolve([])), [data, cashFor?.uid]);

  async function receive() {
    if (!cashFor) return;
    setBusy(true);
    setErr(null);
    try {
      const paise = toPaise(amount) ?? 0;
      const r = await data.receiveCodCash(storeId, cashFor.uid, paise);
      toast({ tone: 'good', text: `Received ${rs(paise)} from ${cashFor.name} · ${rs(r.codCashInHand)} still with them` });
      setCashFor(null);
      riders.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function pay() {
    if (!cashFor) return;
    setBusy(true);
    setErr(null);
    try {
      const paise = toPaise(amount) ?? 0;
      const r = await data.payRider(cashFor.uid, paise, method, refNo);
      toast({ tone: 'good', text: `Recorded ${rs(paise)} paid to ${cashFor.name} · ${rs(r.earningsBalance)} still unpaid` });
      setCashFor(null);
      riders.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  const list = riders.data ?? [];
  const totalCash = list.reduce((a, r) => a + r.codCashInHand, 0);

  return (
    <>
      <PageHead title="Riders & cash" sub={`Riders who collect from ${store?.name ?? 'this store'}. Count the cash a rider hands in, then confirm the amount here — it comes off their cash in hand.`} />
      {riders.loading && !riders.data ? <Skeleton className="h-40 rounded-2xl" /> : null}
      {riders.error ? <ErrorNote>{riders.error}</ErrorNote> : null}
      {riders.data && !list.length ? <EmptyState title="No riders at this store">Ask the admin to add a rider with this store as their home store.</EmptyState> : null}
      {list.length ? <p className="mb-3 text-sm">Cash with riders now: <b className="num">{rs(totalCash)}</b></p> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((r) => (
          <Card key={r.uid} className="grid gap-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle>{r.name}</CardTitle>
                <div className="num text-sm text-muted">{r.vehicleNumber ?? r.vehicleType.toLowerCase()}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge tone={r.isOnline ? 'good' : 'neutral'}>{r.isOnline ? 'On shift' : 'Off shift'}</Badge>
                {r.kycStatus !== 'VERIFIED' ? <Badge tone={KYC_STATUS[r.kycStatus].tone}>{KYC_STATUS[r.kycStatus].label}</Badge> : null}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-xl bg-surface-2 p-2">
                <div className="text-[12px] text-muted">Cash in hand</div>
                <div className={cn('num text-lg font-extrabold', r.codCashInHand > RIDER_COD_CASH_LIMIT * 0.8 && 'text-danger')}>{rs(r.codCashInHand)}</div>
              </div>
              <div className="rounded-xl bg-surface-2 p-2">
                <div className="text-[12px] text-muted">Earned, unpaid</div>
                <div className="num text-lg font-extrabold">{rs(r.earningsBalance)}</div>
              </div>
              <div className="rounded-xl bg-surface-2 p-2">
                <div className="text-[12px] text-muted">Orders on hand</div>
                <div className="num text-lg font-extrabold">{r.activeOrderIds.length}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={r.codCashInHand <= 0} onClick={() => (setErr(null), setMode('cash'), setAmount(String(r.codCashInHand / 100)), setCashFor(r))}>
                <Banknote className="size-4" /> Receive cash
              </Button>
              {r.phone ? (
                <Button size="sm" variant="outline" asChild>
                  <a href={`tel:${r.phone}`}>
                    <Phone className="size-4" /> Call
                  </a>
                </Button>
              ) : null}
              {isOwner ? (
                <Button size="sm" variant="outline" disabled={r.earningsBalance <= 0} onClick={() => (setErr(null), setMode('pay'), setMethod('UPI'), setRefNo(''), setAmount(String(r.earningsBalance / 100)), setCashFor(r))}>
                  Pay rider
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => (setErr(null), setMode('ledger'), setCashFor(r))}>
                Cash ledger
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={!!cashFor} onOpenChange={(v) => !v && setCashFor(null)}>
        <DialogContent title={cashFor ? `${mode === 'cash' ? 'Receive cash from' : mode === 'pay' ? 'Pay' : 'Cash ledger ·'} ${cashFor.name}` : ''} description={cashFor && mode === 'cash' ? `They hold ${rs(cashFor.codCashInHand)}. Enter what you counted.` : cashFor && mode === 'pay' ? `Unpaid earnings ${rs(cashFor.earningsBalance)}. Pay them by UPI, bank or cash first, then record it here.` : undefined}>
          {cashFor && mode === 'cash' ? (
            <>
              <Field label="Amount received ₹">
                <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus className="num text-xl" />
              </Field>
              {err ? <ErrorNote>{err}</ErrorNote> : null}
              <Button size="lg" variant="leaf" disabled={busy || !(toPaise(amount) ?? 0)} onClick={receive}>
                Confirm cash received
              </Button>
            </>
          ) : null}
          {cashFor && mode === 'pay' ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Amount paid ₹">
                  <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="num" />
                </Field>
                <Field label="Paid by">
                  <Select value={method} onChange={(e) => setMethod(e.target.value as PayoutMethod)}>
                    {PAYOUT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m === 'BANK' ? 'Bank transfer' : m === 'UPI' ? 'UPI' : 'Cash'}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {method !== 'CASH' ? (
                <Field label="UPI / bank reference (UTR)">
                  <Input value={refNo} onChange={(e) => setRefNo(e.target.value)} maxLength={60} placeholder="412345678901" />
                </Field>
              ) : null}
              {err ? <ErrorNote>{err}</ErrorNote> : null}
              <Button size="lg" variant="leaf" disabled={busy || !(toPaise(amount) ?? 0)} onClick={pay}>
                Record payment
              </Button>
            </>
          ) : null}
          {mode !== 'cash' && (payouts.data ?? []).length ? (
            <div className="grid gap-1 text-sm">
              <div className="font-semibold text-muted">Payments made</div>
              {(payouts.data ?? []).slice(0, 10).map((p) => (
                <div key={p.id} className="flex justify-between gap-2 border-b border-line py-1">
                  <span>
                    {p.method} <span className="num text-[12px] text-muted">{fmtTime(p.atMs)}{p.reference ? ` · ${p.reference}` : ''}</span>
                  </span>
                  <span className="num font-semibold">{rs(p.amount)}</span>
                </div>
              ))}
            </div>
          ) : null}
          {mode === 'pay' ? null : <div className="grid max-h-64 gap-1 overflow-auto text-sm">
            {(ledger.data ?? []).slice(0, 30).map((x) => (
              <div key={x.id} className="flex justify-between gap-2 border-b border-line py-1">
                <span>
                  {x.kind === 'COLLECT' ? 'Collected' : 'Handed in'} <span className="num text-[12px] text-muted">{fmtTime(x.atMs)}{x.orderId ? ` · #${x.orderId}` : ''}</span>
                </span>
                <span className="num font-semibold">{x.amount > 0 ? '+' : '−'}{rs(Math.abs(x.amount))}</span>
              </div>
            ))}
            {ledger.data && !ledger.data.length ? <span className="text-muted">No cash movements yet.</span> : null}
          </div>}
        </DialogContent>
      </Dialog>
    </>
  );
}
