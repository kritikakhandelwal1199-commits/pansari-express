'use client';
import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Check, FileText, KeyRound, Loader2, MapPin, PartyPopper, XCircle } from 'lucide-react';
import { customerCanCancel, ONLINE_FLOW } from '@pansari/shared';
import { ErrorNote, useToast } from '@/components/common';
import { useShop } from '@/components/shop';
import { Badge, Button, Card, CardTitle, Dialog, DialogContent, Field, Input, Skeleton } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import { ORDER_STATUS, PAYMENT_LABEL } from '@/lib/labels';
import { cn, errMsg, fmtTime, openPdf, rs } from '@/lib/utils';

function OrderView() {
  const params = useSearchParams();
  const id = params.get('id') ?? '';
  const isNew = params.get('new') === '1';
  const data = useData();
  const shop = useShop();
  const toast = useToast();
  const order = useResource(() => (shop.isCustomer && id ? data.getOrder(id) : Promise.resolve(null)), [data, id, shop.isCustomer]);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const o = order.data;

  React.useEffect(() => {
    if (!o || ['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status)) return;
    const t = setInterval(order.reload, 8000);
    return () => clearInterval(t);
  }, [o?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shop.ready || (order.loading && !o)) return <main className="mx-auto max-w-2xl px-4 pt-6"><Skeleton className="h-48 rounded-2xl" /></main>;
  if (!shop.isCustomer) return <main className="mx-auto max-w-2xl px-4 pt-6"><Link className="font-bold text-kum underline" href={`/login?next=${encodeURIComponent(`/shop/orders/view?id=${id}`)}`}>Sign in to see this order</Link></main>;
  if (!o) return <main className="mx-auto max-w-2xl px-4 pt-6"><ErrorNote>{order.error ?? 'Order not found'}</ErrorNote></main>;

  const st = ORDER_STATUS[o.status];
  const closed = o.status === 'CANCELLED' || o.status === 'REJECTED';
  const stepIdx = ONLINE_FLOW.indexOf(o.status === 'HANDED_TO_RIDER' ? 'OUT_FOR_DELIVERY' : o.status);
  const at = (s: string) => o.statusHistory.find((h) => h.status === s)?.at;

  async function cancel() {
    setBusy(true);
    try {
      const r = await data.cancelMyOrder(o!.orderId, reason || 'Changed my mind');
      toast({ tone: 'good', text: r.refunded ? `Cancelled · ${rs(r.refunded)} back in your wallet` : 'Order cancelled' });
      setCancelOpen(false);
      order.reload();
      shop.reloadProfile();
      shop.reloadCatalog();
    } catch (e) {
      toast({ tone: 'bad', text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }
  async function invoice() {
    try {
      openPdf(await data.myInvoicePdf(o!.invoiceId!), `${o!.invoiceNo!.replace(/\//g, '-')}.pdf`);
    } catch (e) {
      toast({ tone: 'bad', text: errMsg(e) });
    }
  }

  return (
    <main className="mx-auto grid max-w-2xl gap-4 px-4 pt-5">
      {isNew && !closed && o.status !== 'DELIVERED' ? (
        <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex items-center gap-3 rounded-2xl bg-leaf p-4 text-white">
          <PartyPopper className="size-7" />
          <div>
            <div className="text-lg font-extrabold">Order placed!</div>
            <div className="text-sm text-white/90">{o.storeName} is getting it ready. Arriving in about {o.etaMinutes ?? 10} minutes.</div>
          </div>
        </motion.div>
      ) : null}

      <Card className="grid gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="num text-[13px] text-muted">Order {o.orderId} · {fmtTime(o.placedMs)}</div>
            <div className="mt-1 text-2xl font-extrabold">{closed ? st.label : o.status === 'DELIVERED' ? 'Delivered' : `Arriving in ~${o.etaMinutes ?? 10} min`}</div>
          </div>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>

        {o.deliveryOtp ? (
          <div className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-haldi bg-haldi/10 p-3">
            <KeyRound className="size-6 text-warn" />
            <div className="flex-1 text-sm">
              <div className="font-bold">Delivery code</div>
              <div className="text-muted">Share this only when you receive the bag.</div>
            </div>
            <div className="num text-3xl font-extrabold tracking-[0.2em]">{o.deliveryOtp}</div>
          </div>
        ) : null}

        {closed ? (
          <div className="flex items-start gap-2 rounded-xl bg-danger/8 p-3 text-sm">
            <XCircle className="mt-0.5 size-4 text-danger" />
            <div>
              <div className="font-semibold">{o.cancelReason}</div>
              {o.payment.status === 'REFUNDED' ? <div className="text-muted">{rs(o.grandTotal)} was refunded to your Pansari wallet.</div> : null}
            </div>
          </div>
        ) : (
          <ol className="grid gap-0">
            {ONLINE_FLOW.map((s, i) => {
              const done = i <= stepIdx;
              const t = at(s) ?? (s === 'OUT_FOR_DELIVERY' ? at('HANDED_TO_RIDER') : undefined);
              return (
                <li key={s} className="grid grid-cols-[28px_1fr_auto] items-start gap-3">
                  <div className="grid justify-items-center">
                    <span className={cn('grid size-7 place-items-center rounded-full border-2', done ? 'border-leaf bg-leaf text-white' : 'border-line bg-surface')}>{done ? <Check className="size-4" /> : null}</span>
                    {i < ONLINE_FLOW.length - 1 ? <span className={cn('h-6 w-0.5', i < stepIdx ? 'bg-leaf' : 'bg-line')} /> : null}
                  </div>
                  <div className={cn('pt-0.5 font-semibold', !done && 'text-muted')}>{ORDER_STATUS[s].label}</div>
                  <div className="num pt-1 text-[12px] text-muted">{t ? fmtTime(t).split(', ')[1] : ''}</div>
                </li>
              );
            })}
          </ol>
        )}

        <div className="flex flex-wrap gap-2">
          {o.invoiceId ? (
            <Button variant="outline" onClick={invoice}>
              <FileText className="size-4" /> GST invoice {o.invoiceNo}
            </Button>
          ) : null}
          {customerCanCancel(o.status) ? (
            <Button variant="ghost" className="text-danger" onClick={() => setCancelOpen(true)}>
              Cancel order
            </Button>
          ) : null}
        </div>
      </Card>

      <Card className="grid gap-2">
        <CardTitle>Items</CardTitle>
        {o.lines.map((l) => (
          <div key={l.productId} className="flex justify-between gap-3 text-[15px]">
            <span>
              {l.name} <span className="text-muted">× {l.qty}</span>
            </span>
            <span className="num">{rs(Math.round(l.unitPrice * l.qty))}</span>
          </div>
        ))}
        {o.charges.map((c) => (
          <div key={c.code} className="flex justify-between text-[15px]">
            <span>{c.name}</span>
            <span className="num">{rs(c.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t border-line pt-2 font-extrabold">
          <span>Total ({PAYMENT_LABEL[o.payment.method]}{o.payment.status === 'PENDING' ? ', pay on delivery' : ''})</span>
          <span className="num">{rs(o.grandTotal)}</span>
        </div>
        <div className="text-[12px] text-muted">Includes GST {rs(o.totalTax)}</div>
      </Card>

      {o.deliveryAddress ? (
        <Card className="flex items-start gap-3 text-sm">
          <MapPin className="mt-0.5 size-5 text-kum" />
          <div>
            <div className="font-bold">{o.deliveryAddress.label}</div>
            <div className="text-muted">
              {o.deliveryAddress.line1}
              {o.deliveryAddress.line2 ? `, ${o.deliveryAddress.line2}` : ''}, {o.deliveryAddress.city} {o.deliveryAddress.pincode}
            </div>
          </div>
        </Card>
      ) : null}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent title="Cancel this order?" description={o.payment.status === 'PAID' ? `${rs(o.grandTotal)} will go back to your Pansari wallet right away.` : 'Nothing has been charged.'}>
          <Field label="Reason (optional)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ordered by mistake" maxLength={140} />
          </Field>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>
              Keep order
            </Button>
            <Button variant="destructive" className="flex-1" onClick={cancel} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Cancel order
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}

export default function OrderViewPage() {
  return (
    <React.Suspense fallback={null}>
      <OrderView />
    </React.Suspense>
  );
}
