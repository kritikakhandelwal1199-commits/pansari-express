'use client';
import * as React from 'react';
import { CheckCircle2, Loader2, TriangleAlert, Undo2 } from 'lucide-react';
import { normBatchNo, type BatchState } from '@pansari/shared';
import { ErrorNote, useToast } from '@/components/common';
import { PageHead } from '@/components/seller';
import { Badge, Button, Card, CardTitle, Dialog, DialogContent, EmptyState, Field, Input, Select, Skeleton } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { RecallResult } from '@/lib/data/types';
import { errMsg, fmtDate, fmtTime } from '@/lib/utils';

interface BatchGroup {
  batchNumber: string;
  qty: number;
  stores: string[];
  expiryMs: number | null;
  recalled: boolean;
}

export default function RecallsPage() {
  const data = useData();
  const toast = useToast();
  const products = useResource(() => data.listAllProducts(), [data]);
  const stores = useResource(() => data.listStores(), [data]);
  const recalls = useResource(() => data.listRecalls(), [data]);
  const [productId, setProductId] = React.useState('');
  const [picked, setPicked] = React.useState<string[]>([]);
  const [whole, setWhole] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<(RecallResult & { productName: string }) | null>(null);
  const storeName = (id: string) => stores.data?.find((s) => s.storeId === id)?.name ?? id;

  const batches = useResource<BatchGroup[]>(async () => {
    if (!productId || !stores.data) return [];
    const per = await Promise.all(stores.data.map(async (s) => ({ s: s.storeId, list: await data.listBatches(s.storeId, productId).catch(() => [] as BatchState[]) })));
    const map = new Map<string, BatchGroup>();
    for (const { s, list } of per)
      for (const b of list) {
        const k = normBatchNo(b.batchNumber);
        const g = map.get(k) ?? { batchNumber: b.batchNumber, qty: 0, stores: [], expiryMs: b.expiryMs, recalled: true };
        g.qty += b.recalled ? 0 : b.qty;
        if (!g.stores.includes(s) && b.qty > 0) g.stores.push(s);
        g.recalled = g.recalled && b.recalled;
        map.set(k, g);
      }
    return [...map.values()].sort((a, b) => (a.expiryMs ?? Infinity) - (b.expiryMs ?? Infinity));
  }, [data, productId, stores.data]);

  React.useEffect(() => {
    setPicked([]);
    setWhole(false);
  }, [productId]);

  const product = products.data?.find((p) => p.productId === productId);
  const ready = !!productId && reason.trim().length >= 5 && (whole || picked.length > 0);

  async function raise() {
    setBusy(true);
    setErr(null);
    try {
      const r = await data.createRecall({ productId, batchNumbers: whole ? [] : picked, reason: reason.trim() });
      setResult({ ...r, productName: product?.name ?? productId });
      toast({ tone: 'good', text: `Recall raised · ${r.unitsRemoved} unit(s) pulled off shelves` });
      setConfirm(false);
      setReason('');
      setPicked([]);
      setWhole(false);
      batches.reload();
      recalls.reload();
      products.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function complete(id: string) {
    try {
      await data.completeRecall(id);
      recalls.reload();
    } catch (e) {
      toast({ tone: 'bad', text: errMsg(e) });
    }
  }

  return (
    <>
      <PageHead title="Product recalls" sub="Raising a recall takes the batches off every shelf at once (stock ledger: Recall), stops them being sold or dispatched, and shows how many units already went to customers." />
      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <Card className="grid content-start gap-3">
          <CardTitle>Raise a recall</CardTitle>
          <Field label="Product">
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Choose a product</option>
              {(products.data ?? []).map((p) => (
                <option key={p.productId} value={p.productId}>
                  {p.name}
                  {p.complianceStatus === 'RECALLED' ? ' (recalled)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          {productId ? (
            <fieldset className="grid gap-1.5">
              <legend className="mb-1 text-sm font-semibold text-muted">Batches on record</legend>
              {batches.loading && !batches.data ? <Skeleton className="h-16 rounded-xl" /> : null}
              {batches.data && !batches.data.length ? <p className="text-sm text-muted">No batches of this product in any store.</p> : null}
              {(batches.data ?? []).map((b) => (
                <label key={b.batchNumber} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" className="size-4" disabled={whole || b.recalled} checked={whole || picked.includes(b.batchNumber)} onChange={() => setPicked((x) => (x.includes(b.batchNumber) ? x.filter((y) => y !== b.batchNumber) : [...x, b.batchNumber]))} />
                    <span className="num font-bold">{b.batchNumber}</span>
                    {b.recalled ? <Badge tone="bad">Recalled</Badge> : null}
                  </span>
                  <span className="num text-right text-[13px] text-muted">
                    {b.qty} on shelf · {b.stores.map(storeName).join(', ') || '—'}
                    {b.expiryMs ? ` · exp ${fmtDate(b.expiryMs)}` : ''}
                  </span>
                </label>
              ))}
              <label className="mt-1 flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" className="size-4" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> Recall every batch and unpublish the product
              </label>
            </fieldset>
          ) : null}
          <Field label="Reason" hint="Who asked for it and what is wrong — the shop sees this on the stock ledger.">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Supplier notice KP-2026-11: moisture in packing" />
          </Field>
          <Button variant="destructive" disabled={!ready} onClick={() => (setErr(null), setConfirm(true))}>
            <Undo2 className="size-4" /> Raise recall
          </Button>
          {result ? (
            <div className="grid gap-1 rounded-xl border border-leaf/30 bg-leaf/8 p-3 text-sm">
              <div className="flex items-center gap-2 font-bold text-leaf">
                <CheckCircle2 className="size-4" /> {result.productName}: {result.unitsRemoved} unit(s) removed
              </div>
              {result.stores.map((s) => (
                <div key={s.storeId}>
                  {storeName(s.storeId)}: {s.unitsRemoved}
                </div>
              ))}
              <div>
                Already sold from these batches: <b className="num">{result.unitsSold}</b> — contact those customers from Invoices & GST.
              </div>
              {result.openOrderIds.length ? (
                <div className="flex items-start gap-2 font-semibold text-danger">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {result.openOrderIds.length} open delivery order(s) hold a recalled packet and cannot be sent out: {result.openOrderIds.join(', ')}. The store must cancel them.
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>

        <div className="grid content-start gap-3">
          {recalls.loading && !recalls.data ? <Skeleton className="h-32 rounded-2xl" /> : null}
          {recalls.data && !recalls.data.length ? <EmptyState title="No recalls">Recalls you raise are listed here until you mark them complete.</EmptyState> : null}
          {(recalls.data ?? []).map((r) => (
            <Card key={r.id} className="grid gap-1.5">
              <div className="flex items-start justify-between gap-2">
                <CardTitle>{r.productName}</CardTitle>
                <Badge tone={r.status === 'ACTIVE' ? 'bad' : 'neutral'}>{r.status === 'ACTIVE' ? 'Active' : 'Completed'}</Badge>
              </div>
              <div className="num text-sm">{r.batchNumbers.length ? `Batches ${r.batchNumbers.join(', ')}` : 'All batches'} · {r.unitsRemoved} unit(s) removed</div>
              <p className="text-sm text-muted">{r.reason}</p>
              <div className="num text-[13px] text-muted">
                Raised {fmtTime(r.createdMs)}
                {r.completedMs ? ` · completed ${fmtTime(r.completedMs)}` : ''}
              </div>
              {r.status === 'ACTIVE' ? (
                <Button size="sm" variant="outline" className="w-fit" onClick={() => complete(r.id)}>
                  Mark complete
                </Button>
              ) : null}
            </Card>
          ))}
        </div>
      </div>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent title="Raise this recall?" description="Stock is written off the shelves straight away in every store. This cannot be undone from the app.">
          <p className="text-sm">
            <b>{product?.name}</b> — {whole ? 'every batch; the product is also unpublished' : `batch ${picked.join(', ')}`}.
          </p>
          {err ? <ErrorNote>{err}</ErrorNote> : null}
          <Button variant="destructive" disabled={busy} onClick={raise}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />} Yes, raise recall
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
