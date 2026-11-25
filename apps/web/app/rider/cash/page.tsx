'use client';
import { RIDER_COD_CASH_LIMIT, RIDER_PAY_PER_DROP } from '@pansari/shared';
import { ErrorNote } from '@/components/common';
import { Card, EmptyState, Skeleton } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import { cn, fmtTime, rs } from '@/lib/utils';

export default function RiderCash() {
  const data = useData();
  const me = useResource(() => data.myRider(), [data]);
  const ledger = useResource(() => data.riderCash(), [data]);
  const payouts = useResource(() => data.listPayouts(), [data]);
  const r = me.data;
  return (
    <div className="grid gap-3">
      <h1 className="text-2xl font-extrabold tracking-tight">Cash & pay</h1>
      {me.error ? <ErrorNote>{me.error}</ErrorNote> : null}
      {!r ? (
        <Skeleton className="h-28 rounded-2xl" />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Card>
            <div className="text-[12px] font-semibold text-muted">Cash in hand</div>
            <div className={cn('num text-2xl font-extrabold', r.codCashInHand > RIDER_COD_CASH_LIMIT * 0.8 && 'text-danger')}>{rs(r.codCashInHand)}</div>
            <div className="mt-1 text-[12px] text-muted">Hand it in at the store counter. Above {rs(RIDER_COD_CASH_LIMIT)} you cannot take more cash orders.</div>
          </Card>
          <Card>
            <div className="text-[12px] font-semibold text-muted">Earned, not yet paid</div>
            <div className="num text-2xl font-extrabold">{rs(r.earningsBalance)}</div>
            <div className="mt-1 text-[12px] text-muted">{rs(RIDER_PAY_PER_DROP)} per delivery. Paid out by the shop.</div>
          </Card>
        </div>
      )}
      <h2 className="mt-2 text-lg font-bold">Payments to you</h2>
      {payouts.data && !payouts.data.length ? <p className="text-sm text-muted">No payments yet. The shop pays your earnings by UPI, bank or cash and records it here.</p> : null}
      <ul className="grid gap-2">
        {(payouts.data ?? []).map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
            <span>
              <b>Paid by {p.method === 'BANK' ? 'bank transfer' : p.method === 'UPI' ? 'UPI' : 'cash'}</b>
              <span className="num block text-[12px] text-muted">
                {fmtTime(p.atMs)}
                {p.reference ? ` · ref ${p.reference}` : ''}
              </span>
            </span>
            <span className="num font-bold text-leaf">+{rs(p.amount)}</span>
          </li>
        ))}
      </ul>
      <h2 className="mt-2 text-lg font-bold">Cash ledger</h2>
      {ledger.loading && !ledger.data ? <Skeleton className="h-20 rounded-2xl" /> : null}
      {ledger.data && !ledger.data.length ? <EmptyState title="No cash yet">Cash-on-delivery money you collect and hand in is listed here.</EmptyState> : null}
      <ul className="grid gap-2">
        {(ledger.data ?? []).map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
            <span>
              <b>{x.kind === 'COLLECT' ? 'Collected' : 'Handed in at store'}</b>
              <span className="num block text-[12px] text-muted">
                {fmtTime(x.atMs)}
                {x.orderId ? ` · #${x.orderId}` : ''}
              </span>
            </span>
            <span className="text-right">
              <span className={cn('num block font-bold', x.amount < 0 ? 'text-leaf' : '')}>{x.amount > 0 ? '+' : '−'}{rs(Math.abs(x.amount))}</span>
              <span className="num text-[12px] text-muted">left {rs(x.balanceAfter)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
