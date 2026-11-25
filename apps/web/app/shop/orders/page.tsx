'use client';
import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, Package } from 'lucide-react';
import { ErrorNote } from '@/components/common';
import { useShop } from '@/components/shop';
import { Badge, Button, EmptyState, Skeleton } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import { ORDER_STATUS } from '@/lib/labels';
import { fmtTime, rs } from '@/lib/utils';

export default function OrdersPage() {
  const shop = useShop();
  const data = useData();
  const orders = useResource(() => (shop.isCustomer ? data.myOrders() : Promise.resolve([])), [data, shop.user?.uid, shop.isCustomer]);

  React.useEffect(() => {
    const live = orders.data?.some((o) => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status));
    if (!live) return;
    const t = setInterval(orders.reload, 10_000);
    return () => clearInterval(t);
  }, [orders.data]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="mx-auto max-w-2xl px-4 pt-5">
      <h1 className="mb-4 text-2xl font-extrabold">Your orders</h1>
      {shop.ready && !shop.isCustomer ? (
        <EmptyState title="Sign in to see your orders">
          <Button asChild className="mt-2">
            <Link href="/login?next=/shop/orders">Sign in</Link>
          </Button>
        </EmptyState>
      ) : null}
      {orders.loading && !orders.data ? <Skeleton className="h-24 rounded-2xl" /> : null}
      {orders.error ? <ErrorNote>{orders.error}</ErrorNote> : null}
      {shop.isCustomer && orders.data?.length === 0 ? (
        <EmptyState title="No orders yet">
          <Link href="/shop" className="font-bold text-kum underline">
            Start shopping
          </Link>
        </EmptyState>
      ) : null}
      <ul className="grid gap-3">
        {orders.data?.map((o) => {
          const st = ORDER_STATUS[o.status];
          return (
            <li key={o.orderId}>
              <Link href={`/shop/orders/view?id=${o.orderId}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-haldi">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2">
                  <Package className="size-5 text-kum" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <span className="num text-[13px] text-muted">{fmtTime(o.placedMs)}</span>
                  </span>
                  <span className="mt-1 block truncate text-sm">{o.lines.map((l) => `${l.name} × ${l.qty}`).join(', ')}</span>
                </span>
                <span className="num font-extrabold">{rs(o.grandTotal)}</span>
                <ChevronRight className="size-4 text-muted" />
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
