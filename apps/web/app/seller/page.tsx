'use client';
import Link from 'next/link';
import { AlertTriangle, CalendarClock, PackagePlus, ScanBarcode } from 'lucide-react';
import { Badge, Button, Card, CardTitle, EmptyState, Skeleton, Stat } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import { daysUntil, fmtDate, fmtTime, rs } from '@/lib/utils';
import { PageHead, useSeller } from '@/components/seller';

function startOfIstDay(now = Date.now()) {
  const ist = now + 330 * 60_000;
  return ist - (ist % 86_400_000) - 330 * 60_000;
}

export default function Dashboard() {
  const data = useData();
  const { storeId, store, user } = useSeller();
  const from = startOfIstDay();
  const invoices = useResource(() => (user.role === 'super_admin' ? Promise.resolve([]) : data.listInvoices({ fromMs: from, toMs: Date.now() + 60_000, storeId: storeId || undefined })), [data, storeId]);
  const stock = useResource(() => (storeId && user.role !== 'super_admin' ? data.listInventory(storeId) : Promise.resolve([])), [data, storeId]);
  const recalls = useResource(() => (user.role === 'super_admin' ? Promise.resolve([]) : data.listRecalls()), [data]);
  const activeRecalls = (recalls.data ?? []).filter((r) => r.status === 'ACTIVE');

  if (user.role === 'super_admin') return <AdminHome />;

  const inv = invoices.data ?? [];
  const sum = (f: (x: (typeof inv)[number]) => boolean) => inv.filter(f).reduce((a, x) => a + x.grandTotal, 0);
  const tax = inv.reduce((a, x) => a + x.computation.totals.totalTax, 0);
  const low = (stock.data ?? []).filter((r) => r.isListed && r.lowStock);
  const expiring = (stock.data ?? []).filter((r) => r.nearestExpiryMs !== null && (daysUntil(r.nearestExpiryMs) ?? 99) <= 15).sort((a, b) => (a.nearestExpiryMs ?? 0) - (b.nearestExpiryMs ?? 0));

  return (
    <>
      <PageHead
        title={store ? store.name : 'Dashboard'}
        sub={`Today, ${fmtDate(Date.now(), { weekday: 'long', day: 'numeric', month: 'long' })}`}
        actions={
          <>
            <Button variant="haldi" asChild>
              <Link href="/pos">
                <ScanBarcode className="size-4" /> New bill
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/seller/inventory?receive=1">
                <PackagePlus className="size-4" /> Receive stock
              </Link>
            </Button>
          </>
        }
      />
      {activeRecalls.length ? (
        <div className="mb-4 grid gap-1 rounded-2xl border border-danger/30 bg-danger/8 p-4 text-sm" role="alert">
          <div className="flex items-center gap-2 font-bold text-danger">
            <AlertTriangle className="size-4" /> Product recall — keep these off the shelf
          </div>
          {activeRecalls.map((r) => (
            <div key={r.id}>
              <b>{r.productName}</b> · {r.batchNumbers.length ? `batch ${r.batchNumbers.join(', ')}` : 'all batches'} — {r.reason}. Stock was already written off; set any packets aside for return.
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {invoices.loading ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[104px] rounded-2xl" />)
        ) : (
          <>
            <Stat tone="brand" label="Sales today" value={rs(sum(() => true))} sub={`${inv.length} bill${inv.length === 1 ? '' : 's'}`} />
            <Stat label="Cash" value={rs(sum((x) => x.paymentMethod === 'CASH'))} sub="Collected at the till" />
            <Stat label="UPI / card" value={rs(sum((x) => x.paymentMethod !== 'CASH'))} sub="Counter QR and walk-in in-app payments" />
            <Stat label="GST collected" value={rs(tax)} sub="CGST + SGST + IGST" />
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <div className="flex items-center justify-between">
            <CardTitle>Running low</CardTitle>
            <Badge tone={low.length ? 'warn' : 'good'}>{low.length}</Badge>
          </div>
          <ul className="mt-3 grid gap-2">
            {stock.loading ? <Skeleton /> : null}
            {low.slice(0, 7).map((r) => (
              <li key={r.productId} className="flex items-center justify-between gap-3 text-[14px]">
                <span className="truncate">{r.product.name}</span>
                <span className="num font-bold text-warn">
                  {r.onHand} left <span className="font-normal text-muted">/ {r.reorderThreshold}</span>
                </span>
              </li>
            ))}
            {!stock.loading && !low.length ? <li className="text-sm text-muted">Everything is above its reorder level.</li> : null}
          </ul>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <CardTitle>Expiring within 15 days</CardTitle>
            <Badge tone={expiring.length ? 'bad' : 'good'}>{expiring.length}</Badge>
          </div>
          <ul className="mt-3 grid gap-2">
            {expiring.slice(0, 7).map((r) => {
              const d = daysUntil(r.nearestExpiryMs)!;
              return (
                <li key={r.productId} className="flex items-center justify-between gap-3 text-[14px]">
                  <span className="truncate">
                    {r.product.name} <span className="text-muted">· {r.nextBatchNumber}</span>
                  </span>
                  <span className={`num inline-flex items-center gap-1 font-bold ${d <= 7 ? 'text-danger' : 'text-warn'}`}>
                    <CalendarClock className="size-4" /> {d} day{d === 1 ? '' : 's'}
                  </span>
                </li>
              );
            })}
            {!stock.loading && !expiring.length ? <li className="text-sm text-muted">No batch expires in the next 15 days.</li> : null}
          </ul>
          {expiring.length ? <p className="mt-3 text-[13px] text-muted">FEFO already sells these first. Expired batches are blocked from sale automatically.</p> : null}
        </Card>
        <Card>
          <CardTitle>Today&apos;s bills</CardTitle>
          <ul className="mt-3 grid gap-2">
            {inv.slice(0, 7).map((x) => (
              <li key={x.invoiceId} className="flex items-center justify-between gap-3 text-[14px]">
                <span className="min-w-0">
                  <span className="num font-semibold">{x.invoiceNo}</span> <span className="text-muted">· {fmtTime(x.issuedMs)}</span>
                </span>
                <span className="flex items-center gap-2">
                  {x.kind === 'B2B' ? <Badge tone="brand">B2B</Badge> : null}
                  <span className="num font-bold">{rs(x.grandTotal)}</span>
                </span>
              </li>
            ))}
          </ul>
          {!invoices.loading && !inv.length ? (
            <EmptyState title="No bills yet today">
              <Link className="font-semibold text-kum underline" href="/pos">
                Open the POS counter
              </Link>
            </EmptyState>
          ) : null}
        </Card>
      </div>
      {invoices.error || stock.error ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-danger">
          <AlertTriangle className="size-4" /> {invoices.error ?? stock.error}
        </p>
      ) : null}
    </>
  );
}

function AdminHome() {
  const data = useData();
  const products = useResource(() => data.listProducts(), [data]);
  const pending = (products.data ?? []).filter((p) => p.complianceStatus === 'PENDING_REVIEW');
  return (
    <>
      <PageHead title="Admin" sub="You are viewing the seller portal as super admin." />
      <Card>
        <CardTitle>{pending.length} product{pending.length === 1 ? '' : 's'} to review</CardTitle>
        <p className="mt-1 text-sm text-muted">Unapproved products can still be billed at the counter but are hidden from walk-in and online customers.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/admin/review">Review listings</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin">Open the admin portal</Link>
          </Button>
        </div>
      </Card>
    </>
  );
}
