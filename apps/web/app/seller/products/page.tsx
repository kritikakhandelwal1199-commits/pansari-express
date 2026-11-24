'use client';
import * as React from 'react';
import { Check, Pencil, Plus, Search, X } from 'lucide-react';
import { CATEGORY_LABELS, UQC, type Uqc } from '@pansari/shared';
import { ErrorNote, useToast } from '@/components/common';
import { PageHead, useSeller } from '@/components/seller';
import { Badge, Button, Dialog, DialogContent, EmptyState, Field, Input, Select, Skeleton, Table, Td, Th } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { HsnRow, ProductInfo } from '@/lib/data/types';
import { errMsg, rs, toPaise } from '@/lib/utils';

const STATUS: Record<string, { tone: 'good' | 'warn' | 'bad' | 'neutral'; label: string }> = {
  APPROVED: { tone: 'good', label: 'Live' },
  PENDING_REVIEW: { tone: 'warn', label: 'In review' },
  REJECTED: { tone: 'bad', label: 'Rejected' },
  DRAFT: { tone: 'neutral', label: 'Draft' },
  RECALLED: { tone: 'bad', label: 'Recalled' },
};

export default function ProductsPage() {
  const data = useData();
  const { user, isOwner } = useSeller();
  const toast = useToast();
  const products = useResource(() => data.listProducts(), [data]);
  const hsn = useResource(() => data.listHsn(), [data]);
  const [q, setQ] = React.useState('');
  const [cat, setCat] = React.useState('');
  const [editing, setEditing] = React.useState<ProductInfo | 'new' | null>(null);
  const isAdmin = user.role === 'super_admin' || user.role === 'compliance';

  const list = (products.data ?? []).filter((p) => (!cat || p.category === cat) && (!q || `${p.name} ${p.nameHi ?? ''} ${p.brand ?? ''} ${p.barcode ?? ''} ${p.hsnCode}`.toLowerCase().includes(q.toLowerCase())));

  async function review(p: ProductInfo, decision: 'APPROVED' | 'REJECTED') {
    try {
      await data.reviewProduct?.(p.productId, decision, decision === 'REJECTED' ? 'Label details incomplete' : undefined);
      toast({ tone: 'good', text: `${p.name} ${decision === 'APPROVED' ? 'approved and live' : 'rejected'}` });
      products.reload();
    } catch (e) {
      toast({ tone: 'bad', text: errMsg(e) });
    }
  }

  return (
    <>
      <PageHead
        title="Products"
        sub="GST rate is taken from the HSN tax master. Any change to name, HSN, MRP or label details sends the listing back for review."
        actions={
          isOwner ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Add product
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted" />
          <Input className="pl-9" placeholder="Search name, Hindi name, barcode or HSN" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
        </div>
        <Select className="w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>
      {products.loading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : products.error ? (
        <ErrorNote>{products.error}</ErrorNote>
      ) : list.length === 0 ? (
        <EmptyState title="No products match">Try another search or add a product.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>Category</Th>
              <Th>HSN · GST</Th>
              <Th className="text-right">MRP</Th>
              <Th>Status</Th>
              <Th className="w-0" />
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.productId}>
                <Td>
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-[13px] text-muted">
                    {[p.nameHi, p.brand, p.netQuantity, p.barcode].filter(Boolean).join(' · ')}
                  </div>
                </Td>
                <Td className="text-muted">{CATEGORY_LABELS[p.category as keyof typeof CATEGORY_LABELS] ?? p.category}</Td>
                <Td className="num">
                  {p.hsnCode} · {p.gstSlab}% <span className="text-[12px] text-muted">{p.taxType === 'INCLUSIVE' ? 'incl.' : '+ GST'}</span>
                </Td>
                <Td className="num text-right font-semibold">{rs(p.mrp)}</Td>
                <Td>
                  <Badge tone={STATUS[p.complianceStatus]?.tone}>{STATUS[p.complianceStatus]?.label ?? p.complianceStatus}</Badge>
                  {p.complianceNote ? <div className="mt-1 text-[12px] text-muted">{p.complianceNote}</div> : null}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    {isOwner ? (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                        <Pencil className="size-4" />
                      </Button>
                    ) : null}
                    {isAdmin && p.complianceStatus === 'PENDING_REVIEW' ? (
                      <>
                        <Button variant="leaf" size="sm" onClick={() => review(p, 'APPROVED')}>
                          <Check className="size-4" /> Approve
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => review(p, 'REJECTED')}>
                          <X className="size-4" /> Reject
                        </Button>
                      </>
                    ) : null}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing ? (
          <ProductForm
            product={editing === 'new' ? null : editing}
            hsn={hsn.data ?? []}
            onDone={(msg) => {
              setEditing(null);
              toast({ tone: 'good', text: msg });
              products.reload();
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function ProductForm({ product, hsn, onDone }: { product: ProductInfo | null; hsn: HsnRow[]; onDone: (msg: string) => void }) {
  const data = useData();
  const [f, setF] = React.useState({
    name: product?.name ?? '',
    nameHi: product?.nameHi ?? '',
    category: product?.category ?? 'pooja',
    brand: product?.brand ?? '',
    barcode: product?.barcode ?? '',
    unit: (product?.unit ?? 'PAC') as Uqc,
    netQuantity: product?.netQuantity ?? '',
    hsnCode: product?.hsnCode ?? '',
    taxType: product?.taxType ?? 'INCLUSIVE',
    mrp: product ? (product.mrp / 100).toString() : '',
    manufacturerName: product?.manufacturerName ?? '',
    countryOfOrigin: product?.countryOfOrigin ?? 'India',
    fssaiRequired: product?.fssaiRequired ?? false,
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const match = [f.hsnCode, f.hsnCode.slice(0, 6), f.hsnCode.slice(0, 4)].map((h) => hsn.find((x) => x.hsnCode === h)).find(Boolean);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const mrp = toPaise(f.mrp);
    if (!mrp) return setError('Enter the MRP printed on the pack');
    setBusy(true);
    setError(null);
    try {
      const r = await data.upsertProduct({ ...f, productId: product?.productId, mrp, taxType: f.taxType as 'INCLUSIVE' | 'EXCLUSIVE' });
      onDone(r.sentForReview ? `Saved at ${r.gstSlab}% GST — sent for compliance review` : 'Saved');
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent wide title={product ? `Edit ${product.name}` : 'Add product'} description="Label details are checked against Legal Metrology rules before the item is shown to customers.">
      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name (as on pack)">
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={120} />
          </Field>
          <Field label="Hindi name (optional)">
            <Input value={f.nameHi} onChange={(e) => set('nameHi', e.target.value)} maxLength={120} lang="hi" />
          </Field>
          <Field label="Category">
            <Select value={f.category} onChange={(e) => set('category', e.target.value)}>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Brand / manufacturer">
            <Input value={f.brand} onChange={(e) => { set('brand', e.target.value); if (!f.manufacturerName) set('manufacturerName', e.target.value); }} maxLength={60} />
          </Field>
          <Field label="Barcode (EAN)" hint="Scan it with the USB scanner into this box.">
            <Input value={f.barcode} onChange={(e) => set('barcode', e.target.value.replace(/\s/g, ''))} inputMode="numeric" maxLength={32} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unit">
              <Select value={f.unit} onChange={(e) => set('unit', e.target.value as Uqc)}>
                {UQC.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </Field>
            <Field label="Net quantity">
              <Input value={f.netQuantity} onChange={(e) => set('netQuantity', e.target.value)} placeholder="250 g" required />
            </Field>
          </div>
          <Field label="HSN code" error={f.hsnCode.length >= 4 && !match ? 'Not in the tax master — the admin must add it first' : null} hint={match ? `${match.description} · GST ${match.gstSlab}% (from tax master)` : '4, 6 or 8 digits'}>
            <Input value={f.hsnCode} onChange={(e) => set('hsnCode', e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" list="hsn-list" required />
            <datalist id="hsn-list">
              {hsn.map((h) => (
                <option key={h.hsnCode} value={h.hsnCode}>
                  {h.description} — {h.gstSlab}%
                </option>
              ))}
            </datalist>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="MRP (₹)">
              <Input value={f.mrp} onChange={(e) => set('mrp', e.target.value)} inputMode="decimal" required />
            </Field>
            <Field label="Price is">
              <Select value={f.taxType} onChange={(e) => set('taxType', e.target.value as 'INCLUSIVE' | 'EXCLUSIVE')}>
                <option value="INCLUSIVE">GST included</option>
                <option value="EXCLUSIVE">+ GST on top</option>
              </Select>
            </Field>
          </div>
          <Field label="Manufacturer / packer name">
            <Input value={f.manufacturerName} onChange={(e) => set('manufacturerName', e.target.value)} maxLength={120} />
          </Field>
          <Field label="Country of origin">
            <Input value={f.countryOfOrigin} onChange={(e) => set('countryOfOrigin', e.target.value)} maxLength={40} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="size-5 accent-[var(--kum)]" checked={f.fssaiRequired} onChange={(e) => set('fssaiRequired', e.target.checked)} />
          Food item — FSSAI licence number must appear on the label
        </label>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <div className="flex justify-end gap-2">
          <Button type="submit" size="lg" disabled={busy || !match}>
            {product ? 'Save changes' : 'Add product'}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
