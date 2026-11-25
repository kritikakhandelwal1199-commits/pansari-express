'use client';
import * as React from 'react';
import { Pencil, Plus } from 'lucide-react';
import { GST_SLABS } from '@pansari/shared';
import { ErrorNote, useToast } from '@/components/common';
import { PageHead } from '@/components/seller';
import { Button, Dialog, DialogContent, Field, Input, Select, Skeleton, Table, Td, Th } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { HsnRow } from '@/lib/data/types';
import { errMsg } from '@/lib/utils';

export default function HsnPage() {
  const data = useData();
  const toast = useToast();
  const hsn = useResource(() => data.listHsn(), [data]);
  const products = useResource(() => data.listAllProducts(), [data]);
  const [form, setForm] = React.useState<(HsnRow & { isNew: boolean }) | null>(null);
  const [q, setQ] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const used = (code: string) => (products.data ?? []).filter((p) => p.hsnCode.startsWith(code)).length;
  const list = (hsn.data ?? []).filter((h) => !q || h.hsnCode.startsWith(q.trim()) || h.description.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => a.hsnCode.localeCompare(b.hsnCode));

  async function save() {
    if (!form) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await data.upsertHsn({ hsnCode: form.hsnCode, description: form.description, gstSlab: form.gstSlab });
      toast({ tone: 'good', text: r.productsUpdated ? `Saved · ${r.productsUpdated} product${r.productsUpdated === 1 ? '' : 's'} now billed at ${form.gstSlab}%` : 'Saved' });
      setForm(null);
      hsn.reload();
      products.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  const changing = form && !form.isNew ? (hsn.data ?? []).find((h) => h.hsnCode === form.hsnCode)?.gstSlab !== form.gstSlab : false;

  return (
    <>
      <PageHead
        title="GST tax master"
        sub="Every product takes its GST rate from the most specific HSN here (8, then 6, then 4 digits) — the shop cannot type a rate. Confirm codes and rates with your CA."
        actions={
          <Button size="sm" variant="haldi" onClick={() => (setErr(null), setForm({ isNew: true, hsnCode: '', description: '', gstSlab: 5 }))}>
            <Plus className="size-4" /> Add HSN
          </Button>
        }
      />
      <Input className="mb-3 max-w-sm" placeholder="Search code or description" value={q} onChange={(e) => setQ(e.target.value)} />
      {hsn.loading && !hsn.data ? <Skeleton className="h-40 rounded-2xl" /> : null}
      {hsn.error ? <ErrorNote>{hsn.error}</ErrorNote> : null}
      {list.length ? (
        <Table>
          <thead>
            <tr>
              <Th>HSN</Th>
              <Th>Description</Th>
              <Th className="text-right">GST</Th>
              <Th className="text-right">Products</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {list.map((h) => (
              <tr key={h.hsnCode}>
                <Td className="num font-bold">{h.hsnCode}</Td>
                <Td>{h.description}</Td>
                <Td className="num text-right font-bold">{h.gstSlab}%</Td>
                <Td className="num text-right">{used(h.hsnCode)}</Td>
                <Td className="text-right">
                  <Button size="sm" variant="outline" onClick={() => (setErr(null), setForm({ ...h, isNew: false }))}>
                    <Pencil className="size-4" /> Edit
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}

      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent title={form?.isNew ? 'Add HSN code' : `Edit HSN ${form?.hsnCode ?? ''}`}>
          {form ? (
            <div className="grid gap-3">
              <Field label="HSN code" hint="4, 6 or 8 digits">
                <Input inputMode="numeric" value={form.hsnCode} disabled={!form.isNew} onChange={(e) => setForm({ ...form, hsnCode: e.target.value.replace(/\D/g, '').slice(0, 8) })} autoFocus={form.isNew} />
              </Field>
              <Field label="Description">
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={120} />
              </Field>
              <Field label="GST rate">
                <Select value={form.gstSlab} onChange={(e) => setForm({ ...form, gstSlab: Number(e.target.value) as HsnRow['gstSlab'] })}>
                  {GST_SLABS.map((s) => (
                    <option key={s} value={s}>
                      {s}%
                    </option>
                  ))}
                </Select>
              </Field>
              {changing ? <p className="rounded-xl bg-haldi/20 p-2 text-sm font-semibold">{used(form.hsnCode)} product(s) under {form.hsnCode} will be billed at {form.gstSlab}% from the next sale. Bills already issued do not change.</p> : null}
              {err ? <ErrorNote>{err}</ErrorNote> : null}
              <Button size="lg" disabled={busy} onClick={save}>
                Save
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
