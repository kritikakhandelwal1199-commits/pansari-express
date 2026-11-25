'use client';
/** Building blocks shared by the admin, compliance, seller and rider screens (Phase 4). */
import * as React from 'react';
import { Check, ChevronDown, ChevronRight, FileUp, Loader2, ShieldCheck, X } from 'lucide-react';
import { KYC_DOC_LABEL, kycMissing, type KycDocType, type KycStatus } from '@pansari/shared';
import { ErrorNote, useToast } from '@/components/common';
import { Badge, Button, Card, CardTitle, Dialog, DialogContent, EmptyState, Field, Input, Select, Skeleton, Table, Td, Th } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { AuditRow, KycDocRow, ProductInfo } from '@/lib/data/types';
import { cn, errMsg, fmtTime, rs } from '@/lib/utils';

export const KYC_STATUS: Record<KycStatus, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  PENDING: { label: 'Documents needed', tone: 'neutral' },
  UNDER_REVIEW: { label: 'Under review', tone: 'warn' },
  VERIFIED: { label: 'Verified', tone: 'good' },
  REJECTED: { label: 'Needs a new upload', tone: 'bad' },
};
export const DOC_STATUS: Record<KycStatus, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  PENDING: { label: 'Waiting for review', tone: 'warn' },
  UNDER_REVIEW: { label: 'Under review', tone: 'warn' },
  VERIFIED: { label: 'Verified', tone: 'good' },
  REJECTED: { label: 'Rejected', tone: 'bad' },
};

export const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super admin',
  seller: 'Shop owner',
  staff: 'Staff',
  rider: 'Rider',
  compliance: 'Compliance',
  customer: 'Customer',
  temp_qr_guest: 'Walk-in guest',
};

/* ------------------------------------------------------------------ KYC uploader */

export function KycUploader({ required, title, sub, onChanged }: { required: readonly KycDocType[]; title: string; sub: string; onChanged?: () => void }) {
  const data = useData();
  const toast = useToast();
  const docs = useResource(() => data.myKycDocs(), [data]);
  const [busy, setBusy] = React.useState<KycDocType | null>(null);
  const [masked, setMasked] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const list = docs.data ?? [];
  const missing = kycMissing(list, required);

  async function upload(docType: KycDocType, f: File | undefined) {
    if (!f) return;
    setBusy(docType);
    setErr(null);
    try {
      await data.uploadKyc({ docType, file: f, fileName: f.name, maskedConfirmed: docType === 'AADHAAR_MASKED' ? masked : undefined });
      toast({ tone: 'good', text: `${KYC_DOC_LABEL[docType].split(' (')[0]} sent for review` });
      docs.reload();
      onChanged?.();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="grid gap-3">
      <div>
        <CardTitle>{title}</CardTitle>
        <p className="mt-1 text-sm text-muted">{sub}</p>
      </div>
      {docs.loading && !docs.data ? <Skeleton className="h-24 rounded-xl" /> : null}
      <ul className="grid gap-2">
        {required.map((t) => {
          const latest = list.filter((d) => d.docType === t).sort((a, b) => b.createdMs - a.createdMs)[0];
          const needs = missing.includes(t);
          return (
            <li key={t} className="grid gap-2 rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold">{KYC_DOC_LABEL[t]}</div>
                {latest ? <Badge tone={DOC_STATUS[latest.status].tone}>{DOC_STATUS[latest.status].label}</Badge> : <Badge>Not uploaded</Badge>}
              </div>
              {latest?.status === 'REJECTED' && latest.reviewNote ? <p className="text-sm font-semibold text-danger">Reviewer: {latest.reviewNote}</p> : null}
              {latest ? <p className="text-[13px] text-muted">{latest.fileName} · {fmtTime(latest.createdMs)}</p> : null}
              {needs || latest?.status === 'VERIFIED' ? (
                <div className="grid gap-2">
                  {t === 'AADHAAR_MASKED' && needs ? (
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-1 size-4" checked={masked} onChange={(e) => setMasked(e.target.checked)} />
                      <span>Only the last 4 digits of my Aadhaar are visible in this photo (download a masked Aadhaar from the UIDAI website).</span>
                    </label>
                  ) : null}
                  <label className={cn('inline-flex h-10 w-fit cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-semibold', needs ? 'bg-kum text-kum-ink' : 'border border-line bg-surface')}>
                    {busy === t ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
                    {needs ? 'Upload photo or PDF' : 'Replace'}
                    <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" disabled={!!busy || (t === 'AADHAAR_MASKED' && needs && !masked)} onChange={(e) => upload(t, e.target.files?.[0])} />
                  </label>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {err ? <ErrorNote>{err}</ErrorNote> : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ KYC review queue */

export function KycReviewQueue() {
  const data = useData();
  const toast = useToast();
  const [status, setStatus] = React.useState<'PENDING' | 'ALL'>('PENDING');
  const docs = useResource(() => data.listKycDocs({ status }), [data, status]);
  const [open, setOpen] = React.useState<KycDocRow | null>(null);
  const [url, setUrl] = React.useState<string | null | undefined>(undefined);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function view(d: KycDocRow) {
    setOpen(d);
    setUrl(undefined);
    setNote('');
    setErr(null);
    setUrl(await data.kycFileUrl(d.id).catch(() => null));
  }
  async function decide(decision: 'VERIFIED' | 'REJECTED') {
    if (!open) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await data.reviewKyc(open.id, decision, note || undefined);
      toast({ tone: 'good', text: `${decision === 'VERIFIED' ? 'Verified' : 'Rejected'} · ${open.ownerName ?? 'owner'} is now “${KYC_STATUS[r.ownerStatus].label.toLowerCase()}”` });
      setOpen(null);
      docs.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  const list = docs.data ?? [];
  return (
    <>
      <div className="mb-3 flex gap-2">
        <Button size="sm" variant={status === 'PENDING' ? 'default' : 'outline'} onClick={() => setStatus('PENDING')}>
          Waiting ({status === 'PENDING' ? list.length : '…'})
        </Button>
        <Button size="sm" variant={status === 'ALL' ? 'default' : 'outline'} onClick={() => setStatus('ALL')}>
          All documents
        </Button>
      </div>
      {docs.loading && !docs.data ? <Skeleton className="h-40 rounded-2xl" /> : null}
      {docs.error ? <ErrorNote>{docs.error}</ErrorNote> : null}
      {docs.data && !list.length ? <EmptyState title="Nothing waiting">New rider and business documents appear here for review.</EmptyState> : null}
      {list.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Who</Th>
              <Th>Document</Th>
              <Th>Uploaded</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id}>
                <Td>
                  <div className="font-semibold">{d.ownerName ?? d.ownerUid}</div>
                  <div className="text-[13px] text-muted">{d.ownerType === 'RIDER' ? 'Rider' : 'Business'}</div>
                </Td>
                <Td>{KYC_DOC_LABEL[d.docType].split(' (')[0]}</Td>
                <Td className="num text-[13px]">{fmtTime(d.createdMs)}</Td>
                <Td>
                  <Badge tone={DOC_STATUS[d.status].tone}>{DOC_STATUS[d.status].label}</Badge>
                </Td>
                <Td className="text-right">
                  <Button size="sm" variant={d.status === 'PENDING' ? 'default' : 'outline'} onClick={() => view(d)}>
                    {d.status === 'PENDING' ? 'Review' : 'View'}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent wide title={open ? `${KYC_DOC_LABEL[open.docType].split(' (')[0]} · ${open.ownerName ?? ''}` : ''} description={open ? `${open.fileName} · uploaded ${fmtTime(open.createdMs)}` : undefined}>
          <div className="grid min-h-48 place-items-center overflow-hidden rounded-xl border border-line bg-surface-2">
            {url === undefined ? (
              <Loader2 className="size-6 animate-spin text-muted" />
            ) : url ? (
              url.startsWith('data:application/pdf') || /\.pdf($|\?)/i.test(open?.fileName ?? '') ? (
                <iframe title="Document" src={url} className="h-[60vh] w-full" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={open?.docType ?? 'Document'} className="max-h-[60vh] w-auto" />
              )
            ) : (
              <p className="p-6 text-center text-sm text-muted">Preview not available for this file{open?.ownerUid.startsWith('u-') ? ' (demo sample)' : ''}.</p>
            )}
          </div>
          {open?.docType === 'AADHAAR_MASKED' ? <p className="rounded-xl bg-haldi/20 p-2 text-sm font-semibold">Reject if more than the last 4 Aadhaar digits are readable. Never copy the number anywhere.</p> : null}
          {open?.status === 'PENDING' ? (
            <>
              <Field label="Note (required to reject)">
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Photo is blurred — upload a clear copy" />
              </Field>
              {err ? <ErrorNote>{err}</ErrorNote> : null}
              <div className="flex flex-wrap gap-2">
                <Button variant="leaf" disabled={busy} onClick={() => decide('VERIFIED')}>
                  <Check className="size-4" /> Verify
                </Button>
                <Button variant="destructive" disabled={busy || note.trim().length < 3} onClick={() => decide('REJECTED')}>
                  <X className="size-4" /> Reject
                </Button>
              </div>
            </>
          ) : open?.reviewNote ? (
            <p className="text-sm">Reviewer note: {open.reviewNote}</p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ Listing review */

export function ListingReview() {
  const data = useData();
  const toast = useToast();
  const products = useResource(() => data.listAllProducts(), [data]);
  const [show, setShow] = React.useState<'PENDING_REVIEW' | 'REJECTED' | 'RECALLED' | 'APPROVED'>('PENDING_REVIEW');
  const [reject, setReject] = React.useState<ProductInfo | null>(null);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const all = products.data ?? [];
  const list = all.filter((p) => p.complianceStatus === show);
  const count = (s: string) => all.filter((p) => p.complianceStatus === s).length;

  async function decide(p: ProductInfo, decision: 'APPROVED' | 'REJECTED', n?: string) {
    setBusy(p.productId);
    setErr(null);
    try {
      await data.reviewProduct!(p.productId, decision, n);
      toast({ tone: 'good', text: decision === 'APPROVED' ? `${p.name} approved — now visible to shoppers` : `${p.name} sent back to the shop` });
      setReject(null);
      setNote('');
      products.reload();
    } catch (e) {
      if (reject) setErr(errMsg(e));
      else toast({ tone: 'bad', text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        {(
          [
            ['PENDING_REVIEW', 'Waiting'],
            ['REJECTED', 'Sent back'],
            ['RECALLED', 'Recalled'],
            ['APPROVED', 'Approved'],
          ] as const
        ).map(([k, l]) => (
          <Button key={k} size="sm" variant={show === k ? 'default' : 'outline'} onClick={() => setShow(k)}>
            {l} ({count(k)})
          </Button>
        ))}
      </div>
      {products.loading && !products.data ? <Skeleton className="h-40 rounded-2xl" /> : null}
      {products.error ? <ErrorNote>{products.error}</ErrorNote> : null}
      {products.data && !list.length ? <EmptyState title="Nothing here">{show === 'PENDING_REVIEW' ? 'New or edited listings appear here before shoppers can see them.' : 'No listings in this group.'}</EmptyState> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((p) => (
          <Card key={p.productId} className="grid gap-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>{p.name}</CardTitle>
                {p.nameHi ? <div className="text-sm text-muted">{p.nameHi}</div> : null}
              </div>
              <div className="num text-right font-bold">{rs(p.mrp)} MRP</div>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">Net quantity</dt>
              <dd>{p.netQuantity || <span className="font-semibold text-danger">missing</span>}</dd>
              <dt className="text-muted">HSN · GST</dt>
              <dd className="num">
                {p.hsnCode} · {p.gstSlab}%
              </dd>
              <dt className="text-muted">Manufacturer</dt>
              <dd>{p.manufacturerName || <span className="font-semibold text-danger">missing</span>}</dd>
              <dt className="text-muted">Country of origin</dt>
              <dd>{p.countryOfOrigin}</dd>
              <dt className="text-muted">FSSAI needed</dt>
              <dd>{p.fssaiRequired ? 'Yes (food)' : 'No'}</dd>
              <dt className="text-muted">Barcode</dt>
              <dd className="num">{p.barcode ?? '—'}</dd>
            </dl>
            {p.complianceNote ? <p className="text-sm font-semibold text-danger">Note: {p.complianceNote}</p> : null}
            {show === 'PENDING_REVIEW' ? (
              <div className="flex gap-2">
                <Button variant="leaf" size="sm" disabled={busy === p.productId} onClick={() => decide(p, 'APPROVED')}>
                  <ShieldCheck className="size-4" /> Approve
                </Button>
                <Button variant="ghost" size="sm" className="text-danger" onClick={() => (setReject(p), setErr(null))}>
                  Send back
                </Button>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
      <Dialog open={!!reject} onOpenChange={(v) => !v && setReject(null)}>
        <DialogContent title={`Send back · ${reject?.name ?? ''}`} description="The shop sees this note and fixes the listing. It stays hidden from shoppers until approved.">
          <Field label="What needs fixing">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Manufacturer address missing on the label" maxLength={300} autoFocus />
          </Field>
          {err ? <ErrorNote>{err}</ErrorNote> : null}
          <Button variant="destructive" disabled={note.trim().length < 3 || !!busy} onClick={() => reject && decide(reject, 'REJECTED', note)}>
            Send back
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ Audit log */

const AUDIT_FILTERS = [
  ['', 'Everything'],
  ['role.', 'Roles'],
  ['zones.', 'Zones'],
  ['hsn_master.', 'Tax master'],
  ['product.', 'Listings'],
  ['kyc.', 'KYC'],
  ['recall.', 'Recalls'],
  ['order.', 'Orders'],
  ['rider.', 'Rider cash'],
] as const;

function pretty(json: string | null) {
  if (!json) return '—';
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

export function AuditTable() {
  const data = useData();
  const [prefix, setPrefix] = React.useState('');
  const rows = useResource(() => data.listAudit({ actionPrefix: prefix || undefined, max: 300 }), [data, prefix]);
  const [open, setOpen] = React.useState<string | null>(null);
  const list: AuditRow[] = rows.data ?? [];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select aria-label="Filter" value={prefix} onChange={(e) => setPrefix(e.target.value)} className="h-10 w-auto text-sm">
          {AUDIT_FILTERS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <span className="text-sm text-muted">Append-only. Written by the server; nobody can edit or delete entries.</span>
      </div>
      {rows.loading && !rows.data ? <Skeleton className="h-40 rounded-2xl" /> : null}
      {rows.error ? <ErrorNote>{rows.error}</ErrorNote> : null}
      {rows.data && !list.length ? <EmptyState title="No entries yet" /> : null}
      {list.length ? (
        <Table>
          <thead>
            <tr>
              <Th className="w-8" />
              <Th>When</Th>
              <Th>Action</Th>
              <Th>By</Th>
              <Th>Target</Th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <React.Fragment key={a.id}>
                <tr className="cursor-pointer hover:bg-surface-2" onClick={() => setOpen(open === a.id ? null : a.id)}>
                  <Td>{open === a.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</Td>
                  <Td className="num whitespace-nowrap text-[13px]">{fmtTime(a.atMs)}</Td>
                  <Td className="font-semibold">{a.action}</Td>
                  <Td className="text-[13px]">
                    {ROLE_LABEL[a.actorRole] ?? a.actorRole}
                    <div className="num text-muted">{a.actorUid}</div>
                  </Td>
                  <Td className="num text-[13px]">
                    {a.target.collection}/{a.target.id}
                  </Td>
                </tr>
                {open === a.id ? (
                  <tr>
                    <Td colSpan={5} className="bg-surface-2">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="mb-1 text-[12px] font-bold text-muted">Before</div>
                          <pre className="num max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface p-2 text-[12px]">{pretty(a.before)}</pre>
                        </div>
                        <div>
                          <div className="mb-1 text-[12px] font-bold text-muted">After</div>
                          <pre className="num max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface p-2 text-[12px]">{pretty(a.after)}</pre>
                        </div>
                      </div>
                    </Td>
                  </tr>
                ) : null}
              </React.Fragment>
            ))}
          </tbody>
        </Table>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ Rider picker (store side) */

export function RiderPicker({ order, storeId, onDone, compact }: { order: { orderId: string; status: string; riderUid?: string | null; grandTotal: number; payment: { method: string; status: string } }; storeId: string; onDone: () => void; compact?: boolean }) {
  const data = useData();
  const toast = useToast();
  const riders = useResource(() => data.listStoreRiders(storeId), [data, storeId]);
  const [busy, setBusy] = React.useState(false);
  if (!['ACCEPTED', 'PICKING', 'PACKED'].includes(order.status)) return null;
  const list = riders.data ?? [];
  const why = (r: (typeof list)[number]) => (r.kycStatus !== 'VERIFIED' ? 'documents pending' : !r.isOnline ? 'off shift' : r.activeOrderIds.filter((x) => x !== order.orderId).length >= 3 ? 'has 3 orders' : null);

  async function pick(uid: string) {
    setBusy(true);
    try {
      await data.assignRider(order.orderId, uid || null);
      const r = list.find((x) => x.uid === uid);
      toast({ tone: 'good', text: uid ? `${r?.name ?? 'Rider'} will collect this order` : 'Rider removed — the store delivers this order' });
      onDone();
      riders.reload();
    } catch (e) {
      toast({ tone: 'bad', text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <label className={cn('flex items-center gap-2 text-sm', compact ? '' : 'font-semibold')}>
      <span className="shrink-0 text-muted">Rider</span>
      <Select aria-label="Assign rider" disabled={busy || riders.loading} value={order.riderUid ?? ''} onChange={(e) => pick(e.target.value)} className="h-9 text-sm">
        <option value="">{list.length ? 'Store delivers (no rider)' : 'No riders at this store'}</option>
        {list.map((r) => {
          const w = why(r);
          return (
            <option key={r.uid} value={r.uid} disabled={!!w && r.uid !== order.riderUid}>
              {r.name}
              {w ? ` — ${w}` : ` · ${r.activeOrderIds.length} on hand${r.codCashInHand ? ` · ${rs(r.codCashInHand)} cash` : ''}`}
            </option>
          );
        })}
      </Select>
    </label>
  );
}
