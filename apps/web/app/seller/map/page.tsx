'use client';
import * as React from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { ErrorNote } from '@/components/common';
import { LiveMap, type MapLine, type MapPin, type MapZone } from '@/components/map';
import { PageHead, useSeller } from '@/components/seller';
import { Badge, Button, Card, CardTitle, EmptyState, Skeleton } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { OrderRow } from '@/lib/data/types';
import { fmtTime, rs } from '@/lib/utils';

const OPEN = ['PLACED', 'ACCEPTED', 'PICKING', 'PACKED', 'HANDED_TO_RIDER', 'OUT_FOR_DELIVERY'];
const ON_ROAD = ['HANDED_TO_RIDER', 'OUT_FOR_DELIVERY'];
const LABEL: Record<string, string> = { PLACED: 'New', ACCEPTED: 'Accepted', PICKING: 'Picking', PACKED: 'Packed', HANDED_TO_RIDER: 'With rider', OUT_FOR_DELIVERY: 'On the way' };

/** One screen for the store: where every open order is going and where the riders are now. */
export default function DeliveryMapPage() {
  const { storeId, store } = useSeller();
  const data = useData();
  const orders = useResource(() => (storeId ? data.listOnlineOrders(storeId) : Promise.resolve([] as OrderRow[])), [data, storeId]);
  const zones = useResource(() => data.listZones().catch(() => []), [data]);
  const open = React.useMemo(() => (orders.data ?? []).filter((o) => OPEN.includes(o.status) && o.deliveryAddress?.location), [orders.data]);
  const fixes = useResource(
    async () => {
      const onRoad = open.filter((o) => ON_ROAD.includes(o.status) && o.riderUid);
      const got = await Promise.all(onRoad.map(async (o) => [o.orderId, await data.trackRider(o.orderId).catch(() => null)] as const));
      return Object.fromEntries(got.filter(([, f]) => f));
    },
    [data, open.map((o) => o.orderId + o.status).join()],
  );
  React.useEffect(() => {
    const t = setInterval(() => {
      orders.reload();
      fixes.reload();
    }, 15_000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pins: MapPin[] = [];
  const lines: MapLine[] = [];
  if (store?.location) pins.push({ id: `store-${store.storeId}`, lat: store.location.lat, lng: store.location.lng, kind: 'store', label: store.name });
  for (const o of open) {
    const home = o.deliveryAddress!.location;
    pins.push({ id: `o-${o.orderId}`, lat: home.lat, lng: home.lng, kind: ON_ROAD.includes(o.status) ? 'home' : 'order', label: `${o.customerName ?? 'Customer'} · ${LABEL[o.status] ?? o.status} · ${rs(o.grandTotal)}` });
    const f = fixes.data?.[o.orderId];
    if (f) {
      pins.push({ id: `r-${o.orderId}`, lat: f.lat, lng: f.lng, kind: 'rider', label: `${o.riderName ?? 'Rider'} · ${f.distanceKm.toFixed(1)} km away · ~${f.etaMinutes} min` });
      lines.push({ id: `l-${o.orderId}`, from: f, to: home });
    }
  }
  const mz: MapZone[] = (zones.data ?? []).filter((z) => z.storeIds.includes(storeId)).map((z) => ({ id: z.zoneId, name: z.name, geometryJson: z.geometryJson, active: z.isActive }));

  return (
    <>
      <PageHead
        title="Delivery map"
        sub={`${store?.name ?? 'Store'} · open orders and riders on the road. Updates every 15 seconds.`}
        actions={
          <Button size="sm" variant="outline" onClick={() => (orders.reload(), fixes.reload())}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        }
      />
      {orders.error ? <ErrorNote>{orders.error}</ErrorNote> : null}
      {orders.loading && !orders.data ? (
        <Skeleton className="h-[480px] rounded-2xl" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
          <LiveMap pins={pins} zones={mz} lines={lines} height={480} fit="pins" label={`Delivery map: ${open.length} open orders`} />
          <Card className="grid content-start gap-2">
            <CardTitle>Open orders ({open.length})</CardTitle>
            {open.length === 0 ? (
              <EmptyState title="No open orders">New online orders appear here and on the map.</EmptyState>
            ) : (
              <ul className="grid gap-2">
                {open.map((o) => {
                  const f = fixes.data?.[o.orderId];
                  return (
                    <li key={o.orderId} className="rounded-xl border border-line p-2.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <b>{o.customerName ?? 'Customer'}</b>
                        <Badge tone={ON_ROAD.includes(o.status) ? 'good' : o.status === 'PLACED' ? 'warn' : 'neutral'}>{LABEL[o.status] ?? o.status}</Badge>
                      </div>
                      <div className="text-muted">
                        {o.deliveryAddress?.line1} · {rs(o.grandTotal)} · {o.payment.method === 'COD' ? 'cash on delivery' : 'paid'} · {fmtTime(o.placedMs)}
                      </div>
                      {o.riderName ? (
                        <div className="text-[13px]">
                          🛵 {o.riderName}
                          {f ? ` · ${f.distanceKm.toFixed(1)} km away · ~${f.etaMinutes} min` : ''}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            <Link href="/seller/orders" className="text-[13px] font-semibold text-kum underline">
              Manage orders
            </Link>
          </Card>
        </div>
      )}
    </>
  );
}
