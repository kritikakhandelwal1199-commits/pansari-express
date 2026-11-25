'use client';
import * as React from 'react';
import { Bike, KeyRound, Loader2, MapPin, Phone, RefreshCw } from 'lucide-react';
import { nextForwardStatus, operatorCanCancel, riderHasPicked, type OrderStatus } from '@pansari/shared';
import { RiderPicker } from '@/components/phase4';
import { ErrorNote, useToast } from '@/components/common';
import { PageHead, useSeller } from '@/components/seller';
import { Badge, Button, Card, Dialog, DialogContent, EmptyState, Field, Input, Segmented, Skeleton } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { OrderRow } from '@/lib/data/types';
import { ORDER_STATUS, PAYMENT_LABEL } from '@/lib/labels';
import { errMsg, fmtTime, rs } from '@/lib/utils';

const NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  ACCEPTED: 'Accept order',
  PICKING: 'Start packing',
  PACKED: 'Mark packed',
  OUT_FOR_DELIVERY: 'Send out (issues GST bill)',
  HANDED_TO_RIDER: 'Hand to rider (issues GST bill)',
  DELIVERED: 'Delivered — enter code',
};

export default function OnlineOrdersPage() {
  const { storeId, store } = useSeller();
  const data = useData();
  const toast = useToast();
  const [tab, setTab] = React.useState<'live' | 'all'>('live');
  const orders = useResource(() => (storeId ? data.listOnlineOrders(storeId, { includeClosed: tab === 'all' }) : Promise.resolve([])), [data, storeId, tab]);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [otpFor, setOtpFor] = React.useState<OrderRow | null>(null);
  const [cancelFor, setCancelFor] = React.useState<OrderRow | null>(null);
  const [otp, setOtp] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = setInterval(orders.reload, 15_000);
    return () => clearInterval(t);
  }, [storeId, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  async function move(o: OrderRow, to: OrderStatus, extra: { otp?: string; reason?: string } = {}) {
    setBusyId(o.orderId);
    setErr(null);
    try {
      const r = await data.advanceOrder(o.orderId, to, extra);
      toast({ tone: 'good', text: r.invoiceNo && (to === 'OUT_FOR_DELIVERY' || to === 'HANDED_TO_RIDER') ? `${to === 'HANDED_TO_RIDER' ? 'With the rider' : 'On the way'} · invoice ${r.invoiceNo}` : `Order ${ORDER_STATUS[r.status].label.toLowerCase()}` });
      setOtpFor(null);
      setCancelFor(null);
      setOtp('');
      setReason('');
      orders.reload();
    } catch (e) {
      if (otpFor || cancelFor) setErr(errMsg(e));
      else toast({ tone: 'bad', text: errMsg(e) });
    } finally {
      setBusyId(null);
    }
  }

  const list = orders.data ?? [];
  const live = list.filter((o) => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status));

  return (
    <>
      <PageHead
        title="Online orders"
        sub={`Delivery orders for ${store?.name ?? 'this store'}. Stock was reserved when the customer ordered; the GST bill is issued when you send it out.`}
        actions={
          <>
            <Segmented value={tab} onChange={setTab} options={[{ value: 'live', label: `Live (${live.length})` }, { value: 'all', label: 'All' }]} />
            <Button variant="outline" size="sm" onClick={orders.reload}>
              <RefreshCw className="size-4" /> Refresh
            </Button>
          </>
        }
      />
      {orders.loading && !orders.data ? <Skeleton className="h-40 rounded-2xl" /> : null}
      {orders.error ? <ErrorNote>{orders.error}</ErrorNote> : null}
      {orders.data && !list.length ? <EmptyState title="No delivery orders yet">Customers order from the shop page; orders for this store appear here.</EmptyState> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((o) => {
          const st = ORDER_STATUS[o.status];
          const withRider = !!o.riderUid && riderHasPicked(o.status);
          const next = withRider ? null : o.riderUid && o.status === 'PACKED' ? 'HANDED_TO_RIDER' : nextForwardStatus(o.status);
          return (
            <Card key={o.orderId} className="grid gap-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <span className="num text-[13px] text-muted">{fmtTime(o.placedMs)}</span>
                  </div>
                  <div className="num mt-1 text-[13px] text-muted">#{o.orderId}{o.invoiceNo ? ` · ${o.invoiceNo}` : ''}</div>
                </div>
                <div className="text-right">
                  <div className="num text-xl font-extrabold">{rs(o.grandTotal)}</div>
                  <div className="text-[12px] text-muted">
                    {PAYMENT_LABEL[o.payment.method]} · {o.payment.status === 'PAID' ? 'paid' : o.payment.status === 'REFUNDED' ? 'refunded' : 'collect on delivery'}
                  </div>
                </div>
              </div>
              <ul className="rounded-xl bg-surface-2 p-3 text-sm">
                {o.lines.map((l) => (
                  <li key={l.productId} className="flex justify-between gap-2">
                    <span>{l.name}</span>
                    <span className="num font-bold">× {l.qty}</span>
                  </li>
                ))}
              </ul>
              <div className="grid gap-1 text-sm">
                {o.customerName || o.customerPhone ? (
                  <div className="flex items-center gap-2">
                    <Phone className="size-4 text-muted" /> {o.customerName ?? 'Customer'} {o.customerPhone ? <a className="num font-semibold text-kum" href={`tel:${o.customerPhone}`}>{o.customerPhone}</a> : null}
                  </div>
                ) : null}
                {o.deliveryAddress ? (
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-muted" />
                    <span>
                      {o.deliveryAddress.line1}
                      {o.deliveryAddress.line2 ? `, ${o.deliveryAddress.line2}` : ''}, {o.deliveryAddress.pincode}
                    </span>
                  </div>
                ) : null}
                {o.cancelReason ? <div className="font-semibold text-danger">{o.cancelReason}</div> : null}
                {withRider ? (
                  <div className="flex items-center gap-2 font-semibold">
                    <Bike className="size-4 text-muted" /> {o.status === 'DELIVERED' ? `Delivered by ${o.riderName ?? 'the rider'}` : `${o.riderName ?? 'Rider'} has this order — they confirm delivery with the customer’s code`}
                  </div>
                ) : null}
              </div>
              <RiderPicker order={o} storeId={storeId} onDone={orders.reload} />
              {next || (operatorCanCancel(o.status) && !withRider) ? (
                <div className="flex flex-wrap gap-2">
                  {next ? (
                    <Button variant={next === 'DELIVERED' ? 'leaf' : 'default'} disabled={busyId === o.orderId} onClick={() => (next === 'DELIVERED' ? setOtpFor(o) : move(o, next))}>
                      {busyId === o.orderId ? <Loader2 className="size-4 animate-spin" /> : next === 'DELIVERED' ? <KeyRound className="size-4" /> : next === 'OUT_FOR_DELIVERY' || next === 'HANDED_TO_RIDER' ? <Bike className="size-4" /> : null}
                      {NEXT_LABEL[next]}
                    </Button>
                  ) : null}
                  {operatorCanCancel(o.status) ? (
                    <Button variant="ghost" className="text-danger" onClick={() => setCancelFor(o)}>
                      {o.status === 'PLACED' ? 'Reject' : 'Cancel'}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>

      <Dialog open={!!otpFor} onOpenChange={(v) => !v && (setOtpFor(null), setErr(null))}>
        <DialogContent title="Confirm delivery" description="Ask the customer for the 4-digit code shown on their order page.">
          <Field label="Delivery code">
            <Input inputMode="numeric" maxLength={4} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus className="num text-center text-2xl tracking-[0.4em]" />
          </Field>
          {otpFor?.payment.status === 'PENDING' ? <p className="rounded-xl bg-haldi/20 p-2 text-sm font-semibold">Collect {rs(otpFor.grandTotal)} in cash before confirming.</p> : null}
          {err ? <ErrorNote>{err}</ErrorNote> : null}
          <Button size="lg" variant="leaf" disabled={otp.length !== 4 || !!busyId} onClick={() => otpFor && move(otpFor, 'DELIVERED', { otp })}>
            Mark delivered
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelFor} onOpenChange={(v) => !v && (setCancelFor(null), setErr(null))}>
        <DialogContent title={cancelFor?.status === 'PLACED' ? 'Reject order' : 'Cancel order'} description="Stock goes back to the same batches. A paid order is refunded to the customer's wallet.">
          <Field label="Reason shown to the customer">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Item damaged in store" maxLength={140} autoFocus />
          </Field>
          {err ? <ErrorNote>{err}</ErrorNote> : null}
          <Button variant="destructive" disabled={reason.trim().length < 3 || !!busyId} onClick={() => cancelFor && move(cancelFor, cancelFor.status === 'PLACED' ? 'REJECTED' : 'CANCELLED', { reason })}>
            Confirm
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
