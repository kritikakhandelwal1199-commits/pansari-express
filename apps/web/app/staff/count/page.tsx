'use client';
import * as React from 'react';
import { ClipboardCheck, X } from 'lucide-react';
import { countVariance, type BatchState } from '@pansari/shared';
import { ErrorNote, useToast } from '@/components/common';
import { ProductFinder, useStaffApp } from '@/components/staff';
import { Button, Card, CardTitle, Field, Input, Skeleton } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { ProductInfo } from '@/lib/data/types';
import { cn, errMsg, fmtDate } from '@/lib/utils';

export default function CountPage() {
  const { storeId, store } = useStaffApp();
  const data = useData();
  const toast = useToast();
  const products = useResource(() => data.listProducts(), [data]);
  const inv = useResource(() => data.listInventory(storeId), [data, storeId]);
  const [p, setP] = React.useState<ProductInfo | null>(null);
  const [batches, setBatches] = React.useState<BatchState[] | null>(null);
  const [counts, setCounts] = React.useState<Record<string, string>>({});
  const [reason, setReason] = React.useState('Shelf count');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function pick(x: ProductInfo) {
    setP(x);
    setErr(null);
    setCounts({});
    setBatches(null);
    try {
      setBatches((await data.listBatches(storeId, x.productId)).filter((b) => !b.recalled && (b.qty > 0 || b.expiryMs === null || b.expiryMs > Date.now())));
    } catch (e) {
      setErr(errMsg(e));
    }
  }
  const entries = (batches ?? []).map((b) => ({ batchId: b.batchId, batchNumber: b.batchNumber, systemQty: b.qty, countedQty: counts[b.batchId] === undefined || counts[b.batchId] === '' ? null : Number(counts[b.batchId]) }));
  const v = countVariance(entries);

  async function post() {
    if (!p) return;
    setBusy(true);
    setErr(null);
    try {
      let onHand = 0;
      for (const c of v.changed) onHand = (await data.adjustStock({ storeId, productId: p.productId, batchId: c.batchId, movement: 'CYCLE_COUNT_ADJUSTMENT', countedQty: c.countedQty, reason: reason.trim() })).onHand;
      toast({ tone: 'good', text: v.changed.length ? `${p.name}: ${v.changed.length} batch${v.changed.length === 1 ? '' : 'es'} corrected · ${onHand} on hand` : `${p.name}: count matches` });
      setP(null);
      setBatches(null);
      inv.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  // suggest what to count: low stock or never counted in this session
  const suggest = (inv.data ?? []).filter((r) => r.lowStock && r.onHand > 0).slice(0, 6);

  return (
    <div className="grid gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Shelf count</h1>
        <p className="text-sm text-muted">{store?.name} · count each batch on the shelf; only differences are posted to the stock ledger</p>
      </div>
      {products.loading && !products.data ? <Skeleton className="h-12 rounded-xl" /> : null}
      {!p ? (
        <>
          <ProductFinder products={products.data ?? []} onPick={pick} />
          {suggest.length ? (
            <div className="grid gap-1">
              <div className="text-sm font-semibold text-muted">Low on the shelf — worth counting</div>
              {suggest.map((r) => (
                <button key={r.productId} type="button" className="flex justify-between rounded-xl border border-line bg-surface px-3 py-2 text-left text-sm" onClick={() => pick(r.product)}>
                  <span className="font-semibold">{r.product.name}</span>
                  <span className="num text-muted">
                    {r.aisleBinCode} · {r.onHand} on hand
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <Card className="grid gap-3">
          <div className="flex items-start justify-between gap-2">
            <CardTitle>{p.name}</CardTitle>
            <Button variant="ghost" size="icon" aria-label="Choose another product" onClick={() => setP(null)}>
              <X className="size-5" />
            </Button>
          </div>
          {!batches ? <Skeleton className="h-20 rounded-xl" /> : null}
          {batches && !batches.length ? <p className="text-sm text-muted">No batches of this item at this store.</p> : null}
          {(batches ?? []).map((b) => {
            const e = entries.find((x) => x.batchId === b.batchId)!;
            const delta = e.countedQty === null ? null : Math.round((e.countedQty - b.qty) * 1000) / 1000;
            return (
              <div key={b.batchId} className="grid grid-cols-[1fr_110px] items-center gap-3 rounded-xl border border-line p-3">
                <div>
                  <div className="num font-bold">Batch {b.batchNumber}</div>
                  <div className="num text-[13px] text-muted">
                    System {b.qty}
                    {b.expiryMs ? ` · exp ${fmtDate(b.expiryMs)}` : ''}
                    {delta !== null && delta !== 0 ? <b className={cn('ml-2', delta < 0 ? 'text-danger' : 'text-leaf')}>{delta > 0 ? `+${delta}` : delta}</b> : null}
                  </div>
                </div>
                <Input aria-label={`Counted for batch ${b.batchNumber}`} inputMode="decimal" placeholder="Counted" value={counts[b.batchId] ?? ''} onChange={(ev) => setCounts({ ...counts, [b.batchId]: ev.target.value })} className="num text-center text-lg" />
              </div>
            );
          })}
          <Field label="Reason on the ledger">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={140} />
          </Field>
          {err ? <ErrorNote>{err}</ErrorNote> : null}
          <Button size="lg" disabled={busy || v.counted === 0 || reason.trim().length < 3} onClick={post}>
            <ClipboardCheck className="size-5" /> {v.changed.length ? `Post ${v.changed.length} correction${v.changed.length === 1 ? '' : 's'} (${v.netDelta > 0 ? '+' : ''}${v.netDelta})` : 'Save count'}
          </Button>
        </Card>
      )}
    </div>
  );
}
