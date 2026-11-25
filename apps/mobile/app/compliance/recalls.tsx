import * as React from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Check } from 'lucide-react-native';
import { normBatchNo, type BatchState } from '@pansari/shared';
import type { RecallResult } from '@pansari/client';
import { fmtDate, fmtTime, Picker, Sheet } from '@/components/role';
import { Badge, Button, Card, ErrorText, Field } from '@/components/ui';
import { errMsg, useData, useResource } from '@/lib/data';

interface Group { batchNumber: string; qty: number; stores: string[]; expiryMs: number | null; recalled: boolean }

export default function Recalls() {
  const { client } = useData();
  const products = useResource(() => client.listAllProducts(), [client]);
  const stores = useResource(() => client.listStores(), [client]);
  const recalls = useResource(() => client.listRecalls(), [client]);
  const [productId, setProductId] = React.useState('');
  const [picked, setPicked] = React.useState<string[]>([]);
  const [whole, setWhole] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<RecallResult | null>(null);
  useFocusEffect(React.useCallback(() => recalls.reload(), [])); // eslint-disable-line react-hooks/exhaustive-deps
  const storeName = (id: string) => stores.data?.find((s) => s.storeId === id)?.name ?? id;

  const batches = useResource<Group[]>(async () => {
    if (!productId || !stores.data) return [];
    const per = await Promise.all(stores.data.map(async (s) => ({ s: s.storeId, list: await client.listBatches(s.storeId, productId).catch(() => [] as BatchState[]) })));
    const m = new Map<string, Group>();
    for (const { s, list } of per)
      for (const b of list) {
        const k = normBatchNo(b.batchNumber);
        const g = m.get(k) ?? { batchNumber: b.batchNumber, qty: 0, stores: [], expiryMs: b.expiryMs, recalled: true };
        g.qty += b.recalled ? 0 : b.qty;
        if (b.qty > 0 && !g.stores.includes(s)) g.stores.push(s);
        g.recalled = g.recalled && b.recalled;
        m.set(k, g);
      }
    return [...m.values()];
  }, [client, productId, stores.data]);

  const product = products.data?.find((p) => p.productId === productId);
  async function raise() {
    setBusy(true);
    setErr(null);
    try {
      setResult(await client.createRecall({ productId, batchNumbers: whole ? [] : picked, reason: reason.trim() }));
      setConfirm(false);
      setPicked([]);
      setWhole(false);
      setReason('');
      batches.reload();
      recalls.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  const Tick = ({ on }: { on: boolean }) => <View className={`h-5 w-5 items-center justify-center rounded border-2 ${on ? 'border-kum bg-kum' : 'border-line'}`}>{on ? <Check color="#fff" size={14} /> : null}</View>;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={recalls.loading} onRefresh={recalls.reload} />}>
      <Card className="gap-3">
        <Text className="text-[16px] font-bold text-ink">Raise a recall</Text>
        <Picker label="Product" value={productId} placeholder="Choose a product" options={(products.data ?? []).map((p) => ({ value: p.productId, label: p.name, sub: p.complianceStatus === 'RECALLED' ? 'Recalled' : undefined }))} onChange={(v) => (setProductId(v), setPicked([]), setWhole(false))} />
        {(batches.data ?? []).map((b) => (
          <Pressable key={b.batchNumber} disabled={whole || b.recalled} onPress={() => setPicked((x) => (x.includes(b.batchNumber) ? x.filter((y) => y !== b.batchNumber) : [...x, b.batchNumber]))} className={`flex-row items-center gap-3 rounded-xl border border-line p-3 ${b.recalled ? 'opacity-50' : ''}`}>
            <Tick on={whole || picked.includes(b.batchNumber)} />
            <View className="flex-1">
              <Text className="font-bold text-ink">{b.batchNumber}{b.recalled ? ' · recalled' : ''}</Text>
              <Text className="text-xs text-muted">{b.qty} on shelf · {b.stores.map(storeName).join(', ') || '—'}{b.expiryMs ? ` · exp ${fmtDate(b.expiryMs)}` : ''}</Text>
            </View>
          </Pressable>
        ))}
        {productId ? (
          <Pressable onPress={() => setWhole((w) => !w)} className="flex-row items-center gap-3">
            <Tick on={whole} />
            <Text className="flex-1 font-semibold text-ink">Recall every batch and unpublish the product</Text>
          </Pressable>
        ) : null}
        <Field label="Reason (who asked, what is wrong)" value={reason} onChangeText={setReason} maxLength={300} placeholder="Supplier notice KP-2026-11: moisture" />
        <Button disabled={!productId || reason.trim().length < 5 || (!whole && !picked.length)} title="Raise recall" onPress={() => (setErr(null), setConfirm(true))} />
        {result ? (
          <View className="gap-1 rounded-xl bg-[#eef7ec] p-3">
            <Text className="font-bold text-leaf">{result.unitsRemoved} unit(s) removed from shelves</Text>
            {result.stores.map((s) => <Text key={s.storeId} className="text-sm text-ink">{storeName(s.storeId)}: {s.unitsRemoved}</Text>)}
            <Text className="text-sm text-ink">Already sold from these batches: {result.unitsSold}</Text>
            {result.openOrderIds.length ? <Text className="text-sm font-semibold text-danger">{result.openOrderIds.length} open order(s) hold a recalled packet and can't be sent out: {result.openOrderIds.join(', ')}</Text> : null}
          </View>
        ) : null}
      </Card>
      {(recalls.data ?? []).map((r) => (
        <Card key={r.id} className="gap-1.5">
          <View className="flex-row justify-between gap-2">
            <Text className="flex-1 font-bold text-ink">{r.productName}</Text>
            <Badge label={r.status === 'ACTIVE' ? 'Active' : 'Completed'} tone={r.status === 'ACTIVE' ? 'bad' : 'neutral'} />
          </View>
          <Text className="text-sm text-ink">{r.batchNumbers.length ? `Batches ${r.batchNumbers.join(', ')}` : 'All batches'} · {r.unitsRemoved} removed</Text>
          <Text className="text-sm text-muted">{r.reason}</Text>
          <Text className="text-xs text-muted">Raised {fmtTime(r.createdMs)}{r.completedMs ? ` · completed ${fmtTime(r.completedMs)}` : ''}</Text>
          {r.status === 'ACTIVE' ? <Button variant="outline" title="Mark complete" onPress={() => void client.completeRecall(r.id).then(recalls.reload, (e) => setErr(errMsg(e)))} /> : null}
        </Card>
      ))}
      <Sheet open={confirm} title="Raise this recall?" onClose={() => setConfirm(false)}>
        <Text className="text-sm text-ink">{product?.name} — {whole ? 'every batch; the product is also unpublished' : `batch ${picked.join(', ')}`}. Stock is written off in every store straight away. This can't be undone from the app.</Text>
        <ErrorText>{err}</ErrorText>
        <Button busy={busy} title="Yes, raise recall" onPress={raise} />
      </Sheet>
    </ScrollView>
  );
}
