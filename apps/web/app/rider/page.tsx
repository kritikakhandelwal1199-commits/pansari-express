'use client';
import * as React from 'react';
import Link from 'next/link';
import { Banknote, Camera, Check, KeyRound, Loader2, MapPin, Navigation, Phone, Power, RefreshCw, Store } from 'lucide-react';
import { riderNextStatus, RIDER_COD_CASH_LIMIT, RIDER_PING_INTERVAL_MS } from '@pansari/shared';
import { ErrorNote, useToast } from '@/components/common';
import { KYC_STATUS } from '@/components/phase4';
import { Badge, Button, Card, Dialog, DialogContent, EmptyState, Field, Input, Skeleton } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { OrderRow } from '@/lib/data/types';
import { ORDER_STATUS, PAYMENT_LABEL } from '@/lib/labels';
import { cn, errMsg, fmtTime, rs } from '@/lib/utils';

function here(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((res) => navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { timeout: 4000, maximumAge: 60_000 }));
}

const cashDue = (o: OrderRow) => o.payment.method === 'COD' && o.payment.status !== 'PAID';

export default function RiderHome() {
  const data = useData();
  const toast = useToast();
  const me = useResource(() => data.myRider(), [data]);
  const orders = useResource(() => data.riderOrders(), [data]);
  const stores = useResource(() => data.deliveryStores(), [data]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [deliver, setDeliver] = React.useState<OrderRow | null>(null);
  const [otp, setOtp] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = setInterval(() => {
      orders.reload();
      me.reload();
    }, 15_000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const r = me.data;
  const list = orders.data ?? [];
  const live = list.filter((o) => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status));
  const carrying = !!r?.isOnline && live.some((o) => o.status === 'HANDED_TO_RIDER' || o.status === 'OUT_FOR_DELIVERY');

  // While carrying orders, share location so the customer can see the rider on the way.
  React.useEffect(() => {
    if (!carrying) return;
    const send = () => void here().then((p) => (p ? data.pingRiderLocation(p).catch(() => undefined) : undefined));
    send();
    const t = setInterval(send, RIDER_PING_INTERVAL_MS);
    return () => clearInterval(t);
  }, [carrying]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pod(o: OrderRow, f: File | undefined) {
    if (!f) return;
    setBusy(`pod-${o.orderId}`);
    try {
      await data.attachPod(o.orderId, { file: f, fileName: f.name });
      toast({ tone: 'good', text: 'Delivery photo saved' });
      orders.reload();
    } catch (e) {
      toast({ tone: 'bad', text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }
  const PodButton = ({ o }: { o: OrderRow }) =>
    o.hasPod ? (
      <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-leaf">
        <Check className="size-4" /> Photo added
      </span>
    ) : (
      <label className="inline-flex h-9 w-fit cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold">
        {busy === `pod-${o.orderId}` ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />} Add delivery photo
        <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={(e) => void pod(o, e.target.files?.[0])} />
      </label>
    );
  const done = list.filter((o) => o.status === 'DELIVERED');
  const home = stores.data?.find((s) => s.storeId === r?.homeStoreId);

  async function shift(on: boolean) {
    setBusy('shift');
    try {
      await data.setRiderShift(on, on ? await here() : null);
      toast({ tone: 'good', text: on ? 'You are on shift — the store can give you orders' : 'Off shift' });
      me.reload();
    } catch (e) {
      toast({ tone: 'bad', text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }
  async function step(o: OrderRow, extra: { otp?: string } = {}) {
    const to = riderNextStatus(o.status);
    if (!to) return;
    setBusy(o.orderId);
    setErr(null);
    try {
      const res = await data.advanceOrder(o.orderId, to, extra);
      toast({ tone: 'good', text: to === 'HANDED_TO_RIDER' ? `Collected · bill ${res.invoiceNo ?? ''}` : to === 'OUT_FOR_DELIVERY' ? 'Trip started — customer can see you are on the way' : cashDue(o) ? `Delivered · keep ${rs(o.grandTotal)} cash safe` : 'Delivered' });
      setDeliver(null);
      setOtp('');
      orders.reload();
      me.reload();
    } catch (e) {
      if (deliver) setErr(errMsg(e));
      else toast({ tone: 'bad', text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  if (me.error) {
    return (
      <EmptyState title="Rider account not ready">
        {me.error}
      </EmptyState>
    );
  }
  if (!r) return <Skeleton className="h-40 rounded-2xl" />;
  const kyc = KYC_STATUS[r.kycStatus];

  return (
    <div className="grid gap-3">
      <Card className={cn('grid gap-3', r.isOnline ? 'border-leaf/40 bg-leaf/5' : '')}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-extrabold">{r.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <Badge tone={kyc.tone}>{kyc.label}</Badge>
              {home ? (
                <span className="inline-flex items-center gap-1">
                  <Store className="size-4" /> {home.name}
                </span>
              ) : null}
            </div>
          </div>
          <Button size="lg" variant={r.isOnline ? 'outline' : 'leaf'} disabled={busy === 'shift' || (!r.isOnline && r.kycStatus !== 'VERIFIED')} onClick={() => shift(!r.isOnline)}>
            {busy === 'shift' ? <Loader2 className="size-5 animate-spin" /> : <Power className="size-5" />}
            {r.isOnline ? 'Go off shift' : 'Go on shift'}
          </Button>
        </div>
        {carrying ? <p className="flex items-center gap-2 text-[13px] font-semibold text-leaf"><MapPin className="size-4" /> Sharing your location with customers while you carry orders</p> : null}
        {r.kycStatus !== 'VERIFIED' ? (
          <p className="text-sm">
            {r.kycStatus === 'UNDER_REVIEW' ? 'Your documents are with the compliance team. You can go on shift once they are verified.' : 'Upload your driving licence, vehicle RC and masked Aadhaar to start delivering.'}{' '}
            <Link href="/rider/kyc" className="font-semibold text-kum underline">
              My documents
            </Link>
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Link href="/rider/cash" className="rounded-xl bg-surface-2 p-3">
            <div className="text-[12px] font-semibold text-muted">Cash in hand</div>
            <div className={cn('num text-xl font-extrabold', r.codCashInHand > RIDER_COD_CASH_LIMIT * 0.8 && 'text-danger')}>{rs(r.codCashInHand)}</div>
          </Link>
          <Link href="/rider/cash" className="rounded-xl bg-surface-2 p-3">
            <div className="text-[12px] font-semibold text-muted">Earned (unpaid)</div>
            <div className="num text-xl font-extrabold">{rs(r.earningsBalance)}</div>
          </Link>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Your deliveries</h2>
        <Button variant="ghost" size="sm" onClick={orders.reload}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      </div>
      {orders.loading && !orders.data ? <Skeleton className="h-32 rounded-2xl" /> : null}
      {orders.error ? <ErrorNote>{orders.error}</ErrorNote> : null}
      {orders.data && !live.length ? <EmptyState title={r.isOnline ? 'Waiting for an order' : 'No deliveries'}>{r.isOnline ? 'When the store gives you an order it appears here.' : 'Go on shift to get orders.'}</EmptyState> : null}

      {live.map((o) => {
        const st = ORDER_STATUS[o.status];
        const a = o.deliveryAddress;
        const next = riderNextStatus(o.status);
        return (
          <Card key={o.orderId} className="grid gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Badge tone={st.tone}>{st.label}</Badge>
                <div className="num mt-1 text-[13px] text-muted">
                  #{o.orderId} · {o.storeName}
                </div>
              </div>
              <div className="text-right">
                {cashDue(o) ? (
                  <>
                    <div className="num text-xl font-extrabold text-warn">{rs(o.grandTotal)}</div>
                    <div className="text-[12px] font-bold text-warn">Collect cash</div>
                  </>
                ) : (
                  <>
                    <div className="num text-lg font-bold">{rs(o.grandTotal)}</div>
                    <div className="text-[12px] text-muted">{PAYMENT_LABEL[o.payment.method]} · paid</div>
                  </>
                )}
              </div>
            </div>
            {a ? (
              <div className="grid gap-1 text-sm">
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted" />
                  <span>
                    {o.customerName ? <b>{o.customerName} · </b> : null}
                    {a.line1}
                    {a.line2 ? `, ${a.line2}` : ''}, {a.pincode}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a href={`https://www.google.com/maps/dir/?api=1&destination=${a.location.lat},${a.location.lng}`} target="_blank" rel="noreferrer">
                      <Navigation className="size-4" /> Directions
                    </a>
                  </Button>
                  {o.customerPhone ? (
                    <Button variant="outline" size="sm" asChild>
                      <a href={`tel:${o.customerPhone}`}>
                        <Phone className="size-4" /> Call
                      </a>
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <ul className="rounded-xl bg-surface-2 p-3 text-sm">
              {o.lines.map((l) => (
                <li key={l.productId} className="flex justify-between gap-2">
                  <span>{l.name}</span>
                  <span className="num font-bold">× {l.qty}</span>
                </li>
              ))}
            </ul>
            {o.status === 'OUT_FOR_DELIVERY' ? <PodButton o={o} /> : null}
            {o.status === 'ACCEPTED' || o.status === 'PICKING' ? <p className="text-sm font-semibold text-muted">The store is packing this order. Head to {o.storeName}.</p> : null}
            {next ? (
              <Button size="lg" variant={next === 'DELIVERED' ? 'leaf' : 'default'} disabled={busy === o.orderId} onClick={() => (next === 'DELIVERED' ? (setErr(null), setOtp(''), setDeliver(o)) : step(o))}>
                {busy === o.orderId ? <Loader2 className="size-5 animate-spin" /> : next === 'DELIVERED' ? <KeyRound className="size-5" /> : null}
                {next === 'HANDED_TO_RIDER' ? 'I have collected the bag' : next === 'OUT_FOR_DELIVERY' ? 'Start trip' : 'Deliver — enter code'}
              </Button>
            ) : null}
          </Card>
        );
      })}

      {done.length ? (
        <>
          <h2 className="mt-2 text-lg font-bold">Delivered today</h2>
          {done.map((o) => (
            <div key={o.orderId} className="grid gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="num">
                  #{o.orderId} · {fmtTime(o.statusHistory.at(-1)?.at ?? o.placedMs)}
                </span>
                <span className="num font-bold">{o.payment.method === 'COD' ? `${rs(o.grandTotal)} cash` : 'paid online'}</span>
              </div>
              <PodButton o={o} />
            </div>
          ))}
        </>
      ) : null}

      <Dialog open={!!deliver} onOpenChange={(v) => !v && setDeliver(null)}>
        <DialogContent title="Hand over the order" description="Ask the customer for the 4-digit code on their order page. Never deliver without it.">
          {deliver && cashDue(deliver) ? (
            <p className="flex items-center gap-2 rounded-xl bg-haldi/25 p-3 text-[15px] font-bold">
              <Banknote className="size-5" /> Collect {rs(deliver.grandTotal)} in cash first
            </p>
          ) : null}
          <Field label="Delivery code">
            <Input inputMode="numeric" maxLength={4} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus className="num text-center text-3xl tracking-[0.4em]" />
          </Field>
          {err ? <ErrorNote>{err}</ErrorNote> : null}
          <Button size="lg" variant="leaf" disabled={otp.length !== 4 || !!busy} onClick={() => deliver && step(deliver, { otp })}>
            Delivered
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
