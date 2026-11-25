'use client';
/** Building blocks shared by the admin, compliance, seller and rider screens (Phase 4). */
import * as React from 'react';
import { Check, ChevronDown, ChevronRight, FileUp, Loader2, ShieldCheck, X } from 'lucide-react';
import { COLD_RANGE, HYGIENE_KIND_LABEL, HYGIENE_QUESTIONS, KYC_DOC_LABEL, kycMissing, type HygieneKind, type KycDocType, type KycStatus } from '@pansari/shared';
import { ErrorNote, useToast } from '@/components/common';
import { Badge, Button, Card, CardTitle, Dialog, DialogContent, EmptyState, Field, Input, Select, Skeleton, Table, Td, Th } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { AuditRow, HygieneRow, KycDocRow, ProductInfo } from '@/lib/data/types';
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

/* ------------------------------------------------------------------ Live rider tracking (customer / store) */

export function RiderTracker({ order }: { order: { orderId: string; status: string; riderUid?: string | null; riderName?: string | null; riderPhone?: string | null; deliveryAddress: { location: { lat: number; lng: number } } | null } }) {
  const data = useData();
  const on = !!order.riderUid && (order.status === 'HANDED_TO_RIDER' || order.status === 'OUT_FOR_DELIVERY');
  const fix = useResource(() => (on ? data.trackRider(order.orderId) : Promise.resolve(null)), [data, order.orderId, on, order.status]);
  React.useEffect(() => {
    if (!on) return;
    const t = setInterval(fix.reload, 15_000);
    return () => clearInterval(t);
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!on) return null;
  const f = fix.data;
  const ago = f ? Math.max(0, Math.round((Date.now() - f.atMs) / 1000)) : 0;
  const dest = order.deliveryAddress?.location;
  return (
    <div className="grid gap-2 rounded-2xl border border-leaf/30 bg-leaf/5 p-3" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm">
          <div className="font-bold">{order.riderName ?? 'Your rider'} {order.status === 'HANDED_TO_RIDER' ? 'has collected your order' : 'is on the way'}</div>
          {f ? (
            <div className="text-muted">
              <b className="num text-ink">{f.distanceKm.toFixed(1)} km</b> away · about <b className="num text-ink">{f.etaMinutes} min</b>
              {' · '}
              {f.simulated ? 'estimated (demo)' : f.live ? `updated ${ago < 60 ? `${ago}s` : `${Math.round(ago / 60)} min`} ago` : `last seen ${fmtTime(f.atMs)}`}
            </div>
          ) : fix.loading ? (
            <div className="text-muted">Finding the rider…</div>
          ) : (
            <div className="text-muted">Location not shared yet.</div>
          )}
        </div>
        {order.riderPhone ? (
          <Button size="sm" variant="outline" asChild>
            <a href={`tel:${order.riderPhone}`}>Call</a>
          </Button>
        ) : null}
      </div>
      {f ? <MiniMap rider={f} home={dest ?? null} /> : null}
      {f && dest ? (
        <a className="w-fit text-[13px] font-semibold text-kum underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&origin=${f.lat},${f.lng}&destination=${dest.lat},${dest.lng}`}>
          Open in Google Maps
        </a>
      ) : null}
    </div>
  );
}

/** Two-point map without tiles: rider dot, home pin, dashed line. North is up. */
function MiniMap({ rider, home }: { rider: { lat: number; lng: number }; home: { lat: number; lng: number } | null }) {
  if (!home) return null;
  const W = 320;
  const H = 120;
  const pad = 24;
  const kx = Math.cos((home.lat * Math.PI) / 180);
  const dx = (rider.lng - home.lng) * kx;
  const dy = rider.lat - home.lat;
  const span = Math.max(Math.abs(dx), Math.abs(dy), 0.0004);
  const sx = (W / 2 - pad) / span;
  const sy = (H / 2 - pad) / span;
  const s = Math.min(sx, sy);
  const hx = W / 2 - (dx * s) / 2;
  const hy = H / 2 + (dy * s) / 2;
  const rx = hx + dx * s;
  const ry = hy - dy * s;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto max-h-36 w-full rounded-xl border border-line bg-surface" role="img" aria-label="Rider position relative to your home">
      <line x1={rx} y1={ry} x2={hx} y2={hy} stroke="#2f7a35" strokeWidth="2.5" strokeDasharray="6 5" />
      <g transform={`translate(${hx},${hy})`}>
        <circle r="8" fill="#a3122b" />
        <circle r="3" fill="#fff" />
      </g>
      <g transform={`translate(${rx},${ry})`}>
        <circle r="11" fill="#2f7a35" fillOpacity="0.2">
          <animate attributeName="r" values="8;14;8" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle r="6" fill="#2f7a35" stroke="#fff" strokeWidth="2" />
      </g>
      <text x={hx} y={hy + 22} textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">Home</text>
      <text x={rx} y={ry - 14} textAnchor="middle" fontSize="11" fontWeight="700" fill="#2f7a35">Rider</text>
    </svg>
  );
}

/* ------------------------------------------------------------------ Proof-of-delivery photo viewer */

export function PodPhoto({ orderId, hasPod }: { orderId: string; hasPod?: boolean }) {
  const data = useData();
  const [open, setOpen] = React.useState(false);
  const url = useResource(() => (open ? data.podUrl(orderId) : Promise.resolve(null)), [data, orderId, open]);
  if (!hasPod) return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Delivery photo
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Delivery photo" description="Taken by the rider at handover.">
          <div className="grid min-h-40 place-items-center overflow-hidden rounded-xl border border-line bg-surface-2">
            {url.loading ? (
              <Loader2 className="size-6 animate-spin text-muted" />
            ) : url.data ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url.data} alt="Bag handed over at the door" className="max-h-[60vh] w-auto" />
            ) : (
              <p className="p-6 text-center text-sm text-muted">Photo not available on this device.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ Hygiene checklists */

export function HygieneForm({ storeId, onSaved }: { storeId: string; onSaved: () => void }) {
  const data = useData();
  const toast = useToast();
  const [kind, setKind] = React.useState<HygieneKind>('HYGIENE_DAILY');
  const qs = HYGIENE_QUESTIONS[kind];
  const [ans, setAns] = React.useState<{ ok: boolean | null; note: string }[]>(() => qs.map(() => ({ ok: null, note: '' })));
  const [temp, setTemp] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    setAns(HYGIENE_QUESTIONS[kind].map(() => ({ ok: null, note: '' })));
    setTemp('');
    setErr(null);
  }, [kind]);
  const ready = ans.length === qs.length && ans.every((a) => a.ok !== null && (a.ok || a.note.trim().length >= 3)) && (kind !== 'COLD_CHAIN' || temp.trim() !== '');

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const r = await data.submitHygieneCheck({ storeId, kind, answers: qs.map((question, i) => ({ question, ok: ans[i]!.ok === true, note: ans[i]!.note.trim() || undefined })), temperatureC: kind === 'COLD_CHAIN' ? Number(temp) : null });
      toast({ tone: r.flagged ? 'bad' : 'good', text: r.flagged ? 'Saved — problems flagged to the compliance team' : 'Checklist saved' });
      setAns(qs.map(() => ({ ok: null, note: '' })));
      setTemp('');
      onSaved();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="grid gap-3">
      <Field label="Checklist">
        <Select value={kind} onChange={(e) => setKind(e.target.value as HygieneKind)}>
          {(Object.keys(HYGIENE_QUESTIONS) as HygieneKind[]).map((k) => (
            <option key={k} value={k}>
              {HYGIENE_KIND_LABEL[k]}
            </option>
          ))}
        </Select>
      </Field>
      <ol className="grid gap-2">
        {qs.map((q, i) => {
          const a = ans[i] ?? { ok: null, note: '' };
          return (
            <li key={q} className="grid gap-2 rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">{q}</span>
                <span className="flex gap-1" role="group" aria-label={q}>
                  <Button type="button" size="sm" variant={a.ok === true ? 'leaf' : 'outline'} aria-pressed={a.ok === true} onClick={() => setAns(ans.map((x, j) => (j === i ? { ...x, ok: true } : x)))}>
                    Yes
                  </Button>
                  <Button type="button" size="sm" variant={a.ok === false ? 'destructive' : 'outline'} aria-pressed={a.ok === false} onClick={() => setAns(ans.map((x, j) => (j === i ? { ...x, ok: false } : x)))}>
                    No
                  </Button>
                </span>
              </div>
              {a.ok === false ? <Input aria-label={`What is wrong: ${q}`} placeholder="What is wrong, and what you did" value={a.note} onChange={(e) => setAns(ans.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} maxLength={200} /> : null}
            </li>
          );
        })}
      </ol>
      {kind === 'COLD_CHAIN' ? (
        <Field label={`Temperature now (°C) — safe range ${COLD_RANGE.min}–${COLD_RANGE.max}`}>
          <Input inputMode="decimal" value={temp} onChange={(e) => setTemp(e.target.value)} className="num w-32" />
        </Field>
      ) : null}
      {err ? <ErrorNote>{err}</ErrorNote> : null}
      <Button size="lg" disabled={!ready || busy} onClick={save}>
        Submit checklist
      </Button>
    </Card>
  );
}

const HC_STATUS = { PENDING: { label: 'Not reviewed', tone: 'neutral' }, OK: { label: 'Reviewed — OK', tone: 'good' }, ACTION_REQUIRED: { label: 'Action needed', tone: 'bad' } } as const;

export function HygieneList({ rows, onReview }: { rows: HygieneRow[]; onReview?: (h: HygieneRow) => void }) {
  const [open, setOpen] = React.useState<string | null>(null);
  if (!rows.length) return <EmptyState title="No checklists yet">Submitted checklists appear here.</EmptyState>;
  return (
    <ul className="grid gap-2">
      {rows.map((h) => (
        <li key={h.id} className={cn('grid gap-2 rounded-2xl border bg-surface p-3', h.flagged ? 'border-danger/40' : 'border-line')}>
          <button type="button" className="flex flex-wrap items-start justify-between gap-2 text-left" onClick={() => setOpen(open === h.id ? null : h.id)} aria-expanded={open === h.id}>
            <span>
              <span className="font-bold">{HYGIENE_KIND_LABEL[h.kind]}</span>
              <span className="num block text-[13px] text-muted">
                {h.storeName ?? h.storeId} · {fmtTime(h.submittedMs)} · {h.submittedByName ?? 'staff'}
                {h.temperatureC !== null ? ` · ${h.temperatureC}°C` : ''}
              </span>
            </span>
            <span className="flex flex-wrap gap-1">
              {h.flagged ? <Badge tone="bad">{h.answers.filter((a) => !a.ok).length ? `${h.answers.filter((a) => !a.ok).length} problem(s)` : 'Temperature out of range'}</Badge> : <Badge tone="good">All OK</Badge>}
              <Badge tone={HC_STATUS[h.reviewStatus].tone}>{HC_STATUS[h.reviewStatus].label}</Badge>
            </span>
          </button>
          {h.reviewNote ? <p className="text-sm font-semibold text-danger">Compliance: {h.reviewNote}</p> : null}
          {open === h.id ? (
            <ul className="grid gap-1 text-sm">
              {h.answers.map((a) => (
                <li key={a.question} className="flex gap-2">
                  <span className={a.ok ? 'text-leaf' : 'text-danger'}>{a.ok ? '✓' : '✗'}</span>
                  <span>
                    {a.question}
                    {a.note ? <span className="block text-muted">{a.note}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {onReview && h.reviewStatus === 'PENDING' ? (
            <Button size="sm" variant={h.flagged ? 'default' : 'outline'} className="w-fit" onClick={() => onReview(h)}>
              Review
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
