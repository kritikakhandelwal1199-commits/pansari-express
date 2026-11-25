/** Screens shared by the compliance and admin apps: KYC queue, listing review, audit log. */
import * as React from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { KycDocRow, ProductInfo } from '@pansari/client';
import { DOC_STATUS, DocImage, Empty, fmtTime, Picker, Seg, Sheet, shortDoc } from '@/components/role';
import { Badge, Button, Card, ErrorText, Field, rs } from '@/components/ui';
import { errMsg, useData, useResource } from '@/lib/data';
import { ROLE_LABEL } from '@/lib/roles';

export function KycQueue() {
  const { client } = useData();
  const [status, setStatus] = React.useState<'PENDING' | 'ALL'>('PENDING');
  const docs = useResource(() => client.listKycDocs({ status }), [client, status]);
  const [open, setOpen] = React.useState<KycDocRow | null>(null);
  const [url, setUrl] = React.useState<string | null | undefined>(undefined);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  useFocusEffect(React.useCallback(() => docs.reload(), [])); // eslint-disable-line react-hooks/exhaustive-deps

  async function view(d: KycDocRow) {
    setOpen(d);
    setUrl(undefined);
    setNote('');
    setErr(null);
    setUrl(await client.kycFileUrl(d.id).catch(() => null));
  }
  async function decide(decision: 'VERIFIED' | 'REJECTED') {
    if (!open) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await client.reviewKyc(open.id, decision, note || undefined);
      setMsg(`${decision === 'VERIFIED' ? 'Verified' : 'Rejected'} ${shortDoc(open.docType)} · ${open.ownerName ?? 'owner'} is now ${r.ownerStatus.toLowerCase().replace('_', ' ')}`);
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
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={docs.loading} onRefresh={docs.reload} />}>
      <Seg value={status} onChange={setStatus} options={[{ value: 'PENDING', label: 'Waiting' }, { value: 'ALL', label: 'All documents' }]} />
      {msg ? <Text className="font-semibold text-leaf">{msg}</Text> : null}
      {!docs.loading && !list.length ? <Empty title="Nothing waiting" sub="New rider and business documents appear here." /> : null}
      {list.map((d) => (
        <Pressable key={d.id} onPress={() => void view(d)} className="flex-row items-center gap-3 rounded-2xl border border-line bg-surface p-3">
          <View className="flex-1 gap-0.5">
            <Text className="font-bold text-ink">{d.ownerName ?? d.ownerUid}</Text>
            <Text className="text-sm text-ink">{shortDoc(d.docType)}</Text>
            <Text className="text-xs text-muted">{d.ownerType === 'RIDER' ? 'Rider' : 'Business'} · {fmtTime(d.createdMs)}</Text>
          </View>
          <Badge label={DOC_STATUS[d.status].label} tone={DOC_STATUS[d.status].tone} />
        </Pressable>
      ))}
      <Sheet open={!!open} title={open ? `${shortDoc(open.docType)} · ${open.ownerName ?? ''}` : ''} onClose={() => setOpen(null)}>
        <DocImage uri={url} />
        {open?.docType === 'AADHAAR_MASKED' ? <Text className="rounded-xl bg-[#fff1cc] p-2 text-sm font-semibold text-ink">Reject if more than the last 4 Aadhaar digits are readable.</Text> : null}
        {open?.status === 'PENDING' ? (
          <>
            <Field label="Note (required to reject)" value={note} onChangeText={setNote} maxLength={200} placeholder="Photo is blurred — upload a clear copy" />
            <ErrorText>{err}</ErrorText>
            <View className="flex-row gap-2">
              <Button className="flex-1" variant="leaf" busy={busy} title="Verify" onPress={() => void decide('VERIFIED')} />
              <Button className="flex-1" variant="outline" disabled={busy || note.trim().length < 3} title="Reject" onPress={() => void decide('REJECTED')} />
            </View>
          </>
        ) : open?.reviewNote ? (
          <Text className="text-sm text-ink">Reviewer note: {open.reviewNote}</Text>
        ) : null}
      </Sheet>
    </ScrollView>
  );
}

export function Listings() {
  const { client } = useData();
  const products = useResource(() => client.listAllProducts(), [client]);
  const [show, setShow] = React.useState<'PENDING_REVIEW' | 'REJECTED' | 'RECALLED' | 'APPROVED'>('PENDING_REVIEW');
  const [reject, setReject] = React.useState<ProductInfo | null>(null);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  useFocusEffect(React.useCallback(() => products.reload(), [])); // eslint-disable-line react-hooks/exhaustive-deps
  const all = products.data ?? [];
  const n = (s: string) => all.filter((p) => p.complianceStatus === s).length;

  async function decide(p: ProductInfo, d: 'APPROVED' | 'REJECTED', why?: string) {
    setBusy(p.productId);
    setErr(null);
    try {
      await client.reviewProduct!(p.productId, d, why);
      setReject(null);
      setNote('');
      products.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={products.loading} onRefresh={products.reload} />}>
      <Seg value={show} onChange={setShow} options={[{ value: 'PENDING_REVIEW', label: `Waiting (${n('PENDING_REVIEW')})` }, { value: 'REJECTED', label: `Sent back (${n('REJECTED')})` }, { value: 'RECALLED', label: `Recalled (${n('RECALLED')})` }, { value: 'APPROVED', label: `Approved (${n('APPROVED')})` }]} />
      {!reject ? <ErrorText>{err}</ErrorText> : null}
      {products.data && !all.filter((p) => p.complianceStatus === show).length ? <Empty title="Nothing here" /> : null}
      {all
        .filter((p) => p.complianceStatus === show)
        .map((p) => (
          <Card key={p.productId} className="gap-2">
            <View className="flex-row justify-between gap-2">
              <Text className="flex-1 text-[16px] font-bold text-ink">{p.name}</Text>
              <Text className="font-bold text-ink">{rs(p.mrp)} MRP</Text>
            </View>
            <Text className="text-sm text-ink">Net qty: {p.netQuantity || <Text className="font-bold text-danger">missing</Text>}</Text>
            <Text className="text-sm text-ink">HSN {p.hsnCode} · GST {p.gstSlab}% · {p.countryOfOrigin}</Text>
            <Text className="text-sm text-ink">Maker: {p.manufacturerName || <Text className="font-bold text-danger">missing</Text>}</Text>
            {p.complianceNote ? <Text className="text-sm font-semibold text-danger">Note: {p.complianceNote}</Text> : null}
            {show === 'PENDING_REVIEW' ? (
              <View className="flex-row gap-2">
                <Button className="flex-1" variant="leaf" busy={busy === p.productId} title="Approve" onPress={() => void decide(p, 'APPROVED')} />
                <Button className="flex-1" variant="outline" title="Send back" onPress={() => (setErr(null), setReject(p))} />
              </View>
            ) : null}
          </Card>
        ))}
      <Sheet open={!!reject} title={`Send back · ${reject?.name ?? ''}`} onClose={() => setReject(null)}>
        <Field label="What needs fixing" value={note} onChangeText={setNote} maxLength={300} placeholder="Manufacturer address missing on the label" autoFocus />
        <ErrorText>{err}</ErrorText>
        <Button disabled={note.trim().length < 3} busy={!!busy} title="Send back" onPress={() => reject && void decide(reject, 'REJECTED', note)} />
      </Sheet>
    </ScrollView>
  );
}

const FILTERS = [
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

function pretty(j: string | null) {
  if (!j) return '—';
  try {
    return JSON.stringify(JSON.parse(j), null, 1);
  } catch {
    return j;
  }
}

export function AuditLog() {
  const { client } = useData();
  const [prefix, setPrefix] = React.useState('');
  const rows = useResource(() => client.listAudit({ actionPrefix: prefix || undefined, max: 200 }), [client, prefix]);
  const [open, setOpen] = React.useState<string | null>(null);
  useFocusEffect(React.useCallback(() => rows.reload(), [])); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={rows.loading} onRefresh={rows.reload} />}>
      <Picker label="Show" value={prefix} options={FILTERS.map(([v, l]) => ({ value: v, label: l }))} onChange={setPrefix} />
      <Text className="text-xs text-muted">Append-only. Nobody can edit or delete entries. Tap one to see what changed.</Text>
      {rows.data && !rows.data.length ? <Empty title="No entries yet" /> : null}
      {(rows.data ?? []).map((a) => (
        <Pressable key={a.id} onPress={() => setOpen(open === a.id ? null : a.id)} className="gap-1 rounded-xl border border-line bg-surface p-3">
          <View className="flex-row justify-between gap-2">
            <Text className="flex-1 font-bold text-ink">{a.action}</Text>
            <Text className="text-xs text-muted">{fmtTime(a.atMs)}</Text>
          </View>
          <Text className="text-xs text-muted">{ROLE_LABEL[a.actorRole] ?? a.actorRole} · {a.target.collection}/{a.target.id}</Text>
          {open === a.id ? (
            <View className="gap-1">
              <Text className="text-xs font-bold text-muted">Before</Text>
              <Text className="rounded-lg bg-surface-2 p-2 font-mono text-[11px] text-ink">{pretty(a.before)}</Text>
              <Text className="text-xs font-bold text-muted">After</Text>
              <Text className="rounded-lg bg-surface-2 p-2 font-mono text-[11px] text-ink">{pretty(a.after)}</Text>
            </View>
          ) : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}
