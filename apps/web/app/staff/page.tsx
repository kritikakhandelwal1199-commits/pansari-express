'use client';
import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Bike, RefreshCw } from 'lucide-react';
import { ErrorNote, useToast } from '@/components/common';
import { RiderPicker } from '@/components/phase4';
import { useStaffApp } from '@/components/staff';
import { Badge, Button, Card, EmptyState, Skeleton } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { OrderRow } from '@/lib/data/types';
import { ORDER_STATUS, PAYMENT_LABEL } from '@/lib/labels';
import { errMsg, fmtTime, rs } from '@/lib/utils';

const QUEUE: OrderRow['status'][] = ['PLACED', 'ACCEPTED', 'PICKING', 'PACKED'];

export default function PickQueue() {
  const { storeId, store } = useStaffApp();
  const data = useData();
  const toast = useToast();
  const orders = useResource(() => data.listOnlineOrders(storeId), [data, storeId]);
  const [busy, setBusy] = React.useState<string | null>(null);
  React.useEffect(() => {
    const t = setInterval(orders.reload, 15_000);
    return () => clearInterval(t);
  }, [storeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = (orders.data ?? []).filter((o) => QUEUE.includes(o.status)).sort((a, b) => QUEUE.indexOf(a.status) - QUEUE.indexOf(b.status) || a.placedMs - b.placedMs);
  async function accept(o: OrderRow) {
    setBusy(o.orderId);
    try {
      await data.advanceOrder(o.orderId, 'ACCEPTED');
      orders.reload();
    } catch (e) {
      toast({ tone: 'bad', text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Pick & pack</h1>
          <p className="text-sm text-muted">{store?.name} · oldest first</p>
        </div>
        <Button variant="outline" size="sm" onClick={orders.reload}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      </div>
      {orders.loading && !orders.data ? <Skeleton className="h-32 rounded-2xl" /> : null}
      {orders.error ? <ErrorNote>{orders.error}</ErrorNote> : null}
      {orders.data && !list.length ? <EmptyState title="Nothing to pack">New delivery orders for this store show up here.</EmptyState> : null}
      <div className="grid gap-3">
        {list.map((o) => {
          const st = ORDER_STATUS[o.status];
          const units = o.lines.reduce((a, l) => a + l.qty, 0);
          return (
            <Card key={o.orderId} className="grid gap-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <span className="num text-[13px] text-muted">{fmtTime(o.placedMs)}</span>
                  </div>
                  <div className="mt-1 font-bold">
                    {o.lines.length} item{o.lines.length === 1 ? '' : 's'} · {units} unit{units === 1 ? '' : 's'}
                  </div>
                  <div className="num text-[13px] text-muted">#{o.orderId}</div>
                </div>
                <div className="text-right">
                  <div className="num font-extrabold">{rs(o.grandTotal)}</div>
                  <div className="text-[12px] text-muted">{PAYMENT_LABEL[o.payment.method]}</div>
                </div>
              </div>
              {o.riderName ? (
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Bike className="size-4 text-muted" /> {o.riderName} will collect
                </div>
              ) : null}
              {o.status !== 'PLACED' ? <RiderPicker compact order={o} storeId={storeId} onDone={orders.reload} /> : null}
              <div className="flex flex-wrap gap-2">
                {o.status === 'PLACED' ? (
                  <Button disabled={busy === o.orderId} onClick={() => accept(o)}>
                    Accept order
                  </Button>
                ) : null}
                {o.status === 'ACCEPTED' || o.status === 'PICKING' ? (
                  <Button asChild>
                    <Link href={`/staff/pick?id=${o.orderId}`}>
                      {o.status === 'ACCEPTED' ? 'Start picking' : 'Continue picking'} <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                ) : null}
                {o.status === 'PACKED' ? <span className="text-sm text-muted">{o.riderUid ? 'Packed — waiting for the rider to collect.' : 'Packed — send it out from Online orders in the seller portal, or assign a rider.'}</span> : null}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
