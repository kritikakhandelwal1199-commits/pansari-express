'use client';
import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { CalendarClock, Layers, PackagePlus, Search, SlidersHorizontal } from 'lucide-react';
import type { BatchState } from '@pansari/shared';
import { ErrorNote, useToast } from '@/components/common';
import { PageHead, useSeller } from '@/components/seller';
import { Badge, Button, Dialog, DialogContent, EmptyState, Field, Input, Segmented, Select, Skeleton, Table, Td, Th } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { InventoryRow, ProductInfo } from '@/lib/data/types';
import { daysUntil, errMsg, fmtDate, rs, toPaise } from '@/lib/utils';

type Modal = { kind: 'receive'; productId?: string } | { kind: 'batches'; row: InventoryRow } | { kind: 'shelf'; row: InventoryRow } | null;

function ExpiryBadge({ ms }: { ms: number | null }) {
  const d = daysUntil(ms);
  if (d === null) return <span className="text-[13px] text-muted">No expiry</span>;
  const tone = d <= 7 ? 'bad' : d <= 15 ? 'warn' : 'neutral';
  return (
    <Badge tone={tone}>
      <CalendarClock className="size-3" /> {fmtDate(ms, { month: 'short', year: 'numeric' })} · {d}d
    </Badge>
  );
}

function InventoryInner() {
  const data = useData();
  const toast = useToast();
  const params = useSearchParams();
  const { storeId, store, isOwner } = useSeller();
  const rows = useResource(() => (storeId ? data.listInventory(storeId) : Promise.resolve([])), [data, storeId]);
  const products = useResource(() => data.listProducts(), [data]);
  const [q, setQ] = React.useState('');
  const [view, setView] = React.useState<'all' | 'low' | 'expiring'>('all');
  const [modal, setModal] = React.useState<Modal>(null);

  React.useEffect(() => {
    if (params.get('receive') === '1') setModal({ kind: 'receive' });
  }, [params]);

  const list = (rows.data ?? []).filter((r) => {
    if (q && !`${r.product.name} ${r.product.barcode ?? ''} ${r.aisleBinCode}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (view === 'low') return r.lowStock;
    if (view === 'expiring') return (daysUntil(r.nearestExpiryMs) ?? 99) <= 15;
    return true;
  });
  const done = (msg: string, warn?: string | null) => {
    setModal(null);
    toast({ tone: 'good', text: msg });
    if (warn) setTimeout(() => toast({ tone: 'bad', text: warn }), 400);
    rows.reload();
  };

  return (
    <>
      <PageHead
        title="Stock"
        sub={store ? `${store.name} · counter, QR and online orders all sell from these batches` : undefined}
        actions={
          <Button onClick={() => setModal({ kind: 'receive' })}>
            <PackagePlus className="size-4" /> Receive stock
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted" />
          <Input className="pl-9" placeholder="Search item, barcode or bin" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stock" />
        </div>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'all', label: 'All' },
            { value: 'low', label: `Low (${(rows.data ?? []).filter((r) => r.lowStock).length})` },
            { value: 'expiring', label: 'Expiring' },
          ]}
        />
      </div>
      {rows.loading ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : rows.error ? (
        <ErrorNote>{rows.error}</ErrorNote>
      ) : !list.length ? (
        <EmptyState title="Nothing here">Receive stock to add items to this store.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th>Aisle / bin</Th>
              <Th className="text-right">Price</Th>
              <Th className="text-right">In stock</Th>
              <Th>Next batch (FEFO)</Th>
              <Th className="w-0" />
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.productId} className={r.isListed ? '' : 'opacity-60'}>
                <Td>
                  <div className="font-semibold">{r.product.name}</div>
                  <div className="text-[12px] text-muted">
                    {r.product.barcode ?? 'no barcode'} · GST {r.product.gstSlab}%{!r.isListed ? ' · hidden from customers' : ''}
                  </div>
                </Td>
                <Td className="num">{r.aisleBinCode || <span className="text-muted">—</span>}</Td>
                <Td className="num text-right">
                  {r.sellingPrice ? <span className="font-semibold">{rs(r.sellingPrice)}</span> : <Badge tone="bad">No price</Badge>}
                  <div className="text-[12px] text-muted">MRP {rs(r.mrp)}</div>
                </Td>
                <Td className="num text-right">
                  <span className={`text-[16px] font-extrabold ${r.lowStock ? 'text-warn' : ''}`}>{r.onHand}</span>
                  <div className="text-[12px] text-muted">reorder at {r.reorderThreshold}</div>
                </Td>
                <Td>
                  {r.nextBatchNumber ? (
                    <div className="grid justify-items-start gap-1">
                      <span className="num text-[13px] font-semibold">{r.nextBatchNumber}</span>
                      <ExpiryBadge ms={r.nearestExpiryMs} />
                    </div>
                  ) : (
                    <span className="text-[13px] text-muted">No sellable batch</span>
                  )}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setModal({ kind: 'receive', productId: r.productId })} aria-label={`Receive ${r.product.name}`}>
                      <PackagePlus className="size-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setModal({ kind: 'batches', row: r })} aria-label={`Batches of ${r.product.name}`}>
                      <Layers className="size-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setModal({ kind: 'shelf', row: r })} aria-label={`Shelf and price for ${r.product.name}`}>
                      <SlidersHorizontal className="size-4" />
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog open={!!modal} onOpenChange={(o) => !o && setModal(null)}>
        {modal?.kind === 'receive' ? <ReceiveForm storeId={storeId} products={products.data ?? []} presetProductId={modal.productId} onDone={done} /> : null}
        {modal?.kind === 'batches' ? <BatchesPanel storeId={storeId} row={modal.row} onDone={done} /> : null}
        {modal?.kind === 'shelf' ? <ShelfForm storeId={storeId} row={modal.row} isOwner={isOwner} onDone={done} /> : null}
      </Dialog>
    </>
  );
}

export default function InventoryPage() {
  return (
    <React.Suspense fallback={<Skeleton className="h-72 rounded-2xl" />}>
      <InventoryInner />
    </React.Suspense>
  );
}

function ReceiveForm({ storeId, products, presetProductId, onDone }: { storeId: string; products: ProductInfo[]; presetProductId?: string; onDone: (m: string, w?: string | null) => void }) {
  const data = useData();
  const [productId, setProductId] = React.useState(presetProductId ?? '');
  const p = products.find((x) => x.productId === productId);
  const [f, setF] = React.useState({ batchNumber: '', mfgDate: '', expiryDate: '', qty: '', purchasePrice: '', mrp: '', reference: '' });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (p && !f.mrp) setF((x) => ({ ...x, mrp: (p.mrp / 100).toString() }));
  }, [p]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!p) return setError('Choose the item');
    const purchasePrice = toPaise(f.purchasePrice);
    const mrp = toPaise(f.mrp);
    if (purchasePrice === null || !mrp) return setError('Enter purchase price and MRP');
    setBusy(true);
    setError(null);
    try {
      const r = await data.inwardStock({ storeId, productId, batchNumber: f.batchNumber.trim(), mfgDate: f.mfgDate || null, expiryDate: f.expiryDate || null, qty: Number(f.qty), purchasePrice, mrp, reference: f.reference.trim() });
      onDone(`${f.qty} × ${p.name} received · ${r.onHand} in stock`, r.warning);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <DialogContent wide title="Receive stock" description="Each supplier batch is kept separately so the earliest expiry is always sold first.">
      <form className="grid gap-4" onSubmit={submit}>
        <Field label="Item">
          <Select value={productId} onChange={(e) => setProductId(e.target.value)} required>
            <option value="">Choose…</option>
            {products.map((x) => (
              <option key={x.productId} value={x.productId}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Batch number">
            <Input value={f.batchNumber} onChange={set('batchNumber')} required maxLength={20} placeholder="GD-2611" />
          </Field>
          <Field label="Mfg date">
            <Input type="date" value={f.mfgDate} onChange={set('mfgDate')} />
          </Field>
          <Field label="Expiry / best before" hint="Leave empty for non-perishables">
            <Input type="date" value={f.expiryDate} onChange={set('expiryDate')} />
          </Field>
          <Field label={`Quantity${p ? ` (${p.unit})` : ''}`}>
            <Input value={f.qty} onChange={set('qty')} inputMode="decimal" required />
          </Field>
          <Field label="Purchase price / unit (₹)">
            <Input value={f.purchasePrice} onChange={set('purchasePrice')} inputMode="decimal" required />
          </Field>
          <Field label="MRP on this batch (₹)">
            <Input value={f.mrp} onChange={set('mrp')} inputMode="decimal" required />
          </Field>
        </div>
        <Field label="Supplier bill / PO number">
          <Input value={f.reference} onChange={set('reference')} required maxLength={40} />
        </Field>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={busy}>
            Add to stock
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

function BatchesPanel({ storeId, row, onDone }: { storeId: string; row: InventoryRow; onDone: (m: string) => void }) {
  const data = useData();
  const batches = useResource(() => data.listBatches(storeId, row.productId), [data, storeId, row.productId]);
  const [batchId, setBatchId] = React.useState('');
  const [movement, setMovement] = React.useState<'DAMAGED_WRITE_OFF' | 'CUSTOMER_RETURN' | 'CYCLE_COUNT_ADJUSTMENT'>('DAMAGED_WRITE_OFF');
  const [qty, setQty] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const now = Date.now();
  const status = (b: BatchState) => (b.recalled ? <Badge tone="bad">Recalled</Badge> : b.expiryMs !== null && b.expiryMs <= now ? <Badge tone="bad">Expired · blocked</Badge> : b.qty > 0 ? <Badge tone="good">Sellable</Badge> : <Badge>Empty</Badge>);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const n = Number(qty);
      const r = await data.adjustStock({ storeId, productId: row.productId, batchId, movement, ...(movement === 'CYCLE_COUNT_ADJUSTMENT' ? { countedQty: n } : { qty: n }), reason });
      onDone(`Stock adjusted · ${r.onHand} in stock`);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent wide title={row.product.name} description="Batches in first-expiry-first-out order. Purchase price is visible only to staff.">
      {batches.loading ? <Skeleton className="h-24" /> : null}
      {batches.data ? (
        <Table>
          <thead>
            <tr>
              <Th>Batch</Th>
              <Th>Mfg</Th>
              <Th>Expiry</Th>
              <Th className="text-right">Qty</Th>
              <Th className="text-right">Cost</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {[...batches.data]
              .sort((a, b) => (a.expiryMs ?? Infinity) - (b.expiryMs ?? Infinity))
              .map((b) => (
                <tr key={b.batchId}>
                  <Td className="num font-semibold">{b.batchNumber}</Td>
                  <Td className="num">{fmtDate(b.mfgMs, { month: 'short', year: 'numeric' })}</Td>
                  <Td className="num">{b.expiryMs ? fmtDate(b.expiryMs) : 'None'}</Td>
                  <Td className="num text-right font-bold">{b.qty}</Td>
                  <Td className="num text-right">{rs(b.purchasePrice)}</Td>
                  <Td>{status(b)}</Td>
                </tr>
              ))}
          </tbody>
        </Table>
      ) : null}
      <form className="grid gap-4 rounded-2xl border border-line p-4" onSubmit={submit}>
        <div className="font-bold">Adjust a batch</div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Batch">
            <Select value={batchId} onChange={(e) => setBatchId(e.target.value)} required>
              <option value="">Choose…</option>
              {(batches.data ?? []).map((b) => (
                <option key={b.batchId} value={b.batchId}>
                  {b.batchNumber} ({b.qty})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What happened">
            <Select value={movement} onChange={(e) => setMovement(e.target.value as typeof movement)}>
              <option value="DAMAGED_WRITE_OFF">Damaged / write-off</option>
              <option value="CUSTOMER_RETURN">Customer return</option>
              <option value="CYCLE_COUNT_ADJUSTMENT">Stock count</option>
            </Select>
          </Field>
          <Field label={movement === 'CYCLE_COUNT_ADJUSTMENT' ? 'Counted on shelf' : 'Quantity'}>
            <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" required />
          </Field>
        </div>
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={200} placeholder={movement === 'DAMAGED_WRITE_OFF' ? 'Packet torn during unloading' : movement === 'CUSTOMER_RETURN' ? 'Unopened, bill PX/26-27/000012' : 'Monthly count'} />
        </Field>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            Record adjustment
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

function ShelfForm({ storeId, row, isOwner, onDone }: { storeId: string; row: InventoryRow; isOwner: boolean; onDone: (m: string) => void }) {
  const data = useData();
  const [price, setPrice] = React.useState(row.sellingPrice ? (row.sellingPrice / 100).toString() : '');
  const [bin, setBin] = React.useState(row.aisleBinCode);
  const [reorder, setReorder] = React.useState(String(row.reorderThreshold));
  const [listed, setListed] = React.useState(row.isListed);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = toPaise(price);
      if (isOwner && p && p !== row.sellingPrice) await data.setStorePrice(storeId, row.productId, p);
      await data.updateShelf(storeId, row.productId, { aisleBinCode: bin.trim().toUpperCase(), reorderThreshold: Math.max(0, Math.floor(Number(reorder) || 0)), isListed: listed });
      onDone(`${row.product.name} updated`);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent title="Shelf and price" description={row.product.name}>
      <form className="grid gap-4" onSubmit={submit}>
        <Field label="Selling price (₹)" hint={isOwner ? `MRP ${rs(row.mrp)} — cannot sell above MRP` : 'Only the shop owner can change prices'}>
          <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" disabled={!isOwner} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Aisle / bin" hint="Shown to walk-in customers">
            <Input value={bin} onChange={(e) => setBin(e.target.value)} maxLength={24} placeholder="A1-R2-B03" />
          </Field>
          <Field label="Reorder at">
            <Input value={reorder} onChange={(e) => setReorder(e.target.value)} inputMode="numeric" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="size-5 accent-[var(--kum)]" checked={listed} onChange={(e) => setListed(e.target.checked)} /> Show to walk-in and online customers
        </label>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
