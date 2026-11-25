'use client';
import * as React from 'react';
import { PackagePlus, X } from 'lucide-react';
import { ErrorNote, useToast } from '@/components/common';
import { ProductFinder, useStaffApp } from '@/components/staff';
import { Button, Card, CardTitle, Field, Input, Skeleton } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { ProductInfo } from '@/lib/data/types';
import { errMsg, rs, toPaise } from '@/lib/utils';

const blank = { batchNumber: '', mfgDate: '', expiryDate: '', qty: '', purchasePrice: '', mrp: '', reference: '' };

export default function ReceivePage() {
  const { storeId, store } = useStaffApp();
  const data = useData();
  const toast = useToast();
  const products = useResource(() => data.listProducts(), [data]);
  const [p, setP] = React.useState<ProductInfo | null>(null);
  const [f, setF] = React.useState(blank);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [last, setLast] = React.useState<string | null>(null);

  function pick(x: ProductInfo) {
    setP(x);
    setErr(null);
    setF((cur) => ({ ...blank, reference: cur.reference, mrp: String(x.mrp / 100) }));
  }
  async function save() {
    if (!p) return;
    setBusy(true);
    setErr(null);
    try {
      const qty = Number(f.qty);
      const r = await data.inwardStock({ storeId, productId: p.productId, batchNumber: f.batchNumber.trim(), mfgDate: f.mfgDate || null, expiryDate: f.expiryDate || null, qty, purchasePrice: toPaise(f.purchasePrice) ?? -1, mrp: toPaise(f.mrp) ?? -1, reference: f.reference.trim() });
      const msg = `${p.name}: +${qty} · now ${r.onHand} on hand`;
      setLast(msg);
      toast({ tone: 'good', text: msg });
      if (r.warning) toast({ tone: 'bad', text: r.warning });
      setP(null);
      setF((cur) => ({ ...blank, reference: cur.reference }));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="grid gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Receive stock</h1>
        <p className="text-sm text-muted">{store?.name} · one line per batch on the supplier bill</p>
      </div>
      <Field label="Supplier bill / PO number" hint="Kept on every ledger line so you can trace the purchase.">
        <Input value={f.reference} onChange={set('reference')} placeholder="SUP-INV-4471" />
      </Field>
      {products.loading && !products.data ? <Skeleton className="h-12 rounded-xl" /> : null}
      {!p ? <ProductFinder products={products.data ?? []} onPick={pick} /> : null}
      {p ? (
        <Card className="grid gap-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle>{p.name}</CardTitle>
              <div className="num text-sm text-muted">
                {p.netQuantity} · MRP on file {rs(p.mrp)}
              </div>
            </div>
            <Button variant="ghost" size="icon" aria-label="Choose another product" onClick={() => setP(null)}>
              <X className="size-5" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Batch number">
              <Input value={f.batchNumber} onChange={set('batchNumber')} autoFocus />
            </Field>
            <Field label={`Quantity (${p.unit})`}>
              <Input inputMode="decimal" value={f.qty} onChange={set('qty')} />
            </Field>
            <Field label="Mfg date">
              <Input type="date" value={f.mfgDate} onChange={set('mfgDate')} />
            </Field>
            <Field label="Expiry date" hint={p.fssaiRequired ? 'Needed for food items' : 'Leave empty if none'}>
              <Input type="date" value={f.expiryDate} onChange={set('expiryDate')} />
            </Field>
            <Field label="Purchase price ₹ / unit">
              <Input inputMode="decimal" value={f.purchasePrice} onChange={set('purchasePrice')} />
            </Field>
            <Field label="MRP ₹ on this batch">
              <Input inputMode="decimal" value={f.mrp} onChange={set('mrp')} />
            </Field>
          </div>
          {err ? <ErrorNote>{err}</ErrorNote> : null}
          <Button size="lg" disabled={busy || !f.batchNumber.trim() || !f.qty || !f.reference.trim()} onClick={save}>
            <PackagePlus className="size-5" /> Add to stock
          </Button>
        </Card>
      ) : null}
      {last ? <p className="text-sm text-muted">Last added: {last}</p> : null}
    </div>
  );
}
