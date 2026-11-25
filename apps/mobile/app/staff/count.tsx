import * as React from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { countVariance, type BatchState } from '@pansari/shared';
import type { ProductInfo } from '@pansari/client';
import { ProductFinder } from '@/components/ops';
import { fmtDate, StoreSwitch, useStore } from '@/components/role';
import { Button, Card, ErrorText, Field } from '@/components/ui';
import { errMsg, useData, useResource } from '@/lib/data';

export default function Count() {
  const { client } = useData();
  const { storeId } = useStore();
  const products = useResource(() => client.listProducts(), [client]);
  const inv = useResource(() => (storeId ? client.listInventory(storeId) : Promise.resolve([])), [client, storeId]);
  const [p, setP] = React.useState<ProductInfo | null>(null);
  const [batches, setBatches] = React.useState<BatchState[] | null>(null);
  const [counts, setCounts] = React.useState<Record<string, string>>({});
  const [reason, setReason] = React.useState('Shelf count');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  async function pick(x: ProductInfo) {
    setP(x);
    setErr(null);
    setMsg(null);
    setCounts({});
    setBatches(null);
    try {
      setBatches((await client.listBatches(storeId, x.productId)).filter((b) => !b.recalled && (b.qty > 0 || b.expiryMs === null || b.expiryMs > Date.now())));
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
      for (const c of v.changed) onHand = (await client.adjustStock({ storeId, productId: p.productId, batchId: c.batchId, movement: 'CYCLE_COUNT_ADJUSTMENT', countedQty: c.countedQty, reason: reason.trim() })).onHand;
      setMsg(v.changed.length ? `${p.name}: ${v.changed.length} batch correction(s) · ${onHand} on hand` : `${p.name}: count matches`);
      setP(null);
      inv.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  const suggest = (inv.data ?? []).filter((r) => r.lowStock && r.onHand > 0).slice(0, 6);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <StoreSwitch />
      <Text className="text-sm text-muted">Count each batch on the shelf. Only differences go to the stock ledger.</Text>
      {msg ? <Text className="font-semibold text-leaf">{msg}</Text> : null}
      {!p ? (
        <>
          <ProductFinder products={products.data ?? []} onPick={(x) => void pick(x)} />
          {suggest.length ? <Text className="text-sm font-semibold text-muted">Low on the shelf — worth counting</Text> : null}
          {suggest.map((r) => (
            <Pressable key={r.productId} onPress={() => void pick(r.product)} className="flex-row justify-between rounded-xl border border-line bg-surface px-3 py-3">
              <Text className="flex-1 font-semibold text-ink">{r.product.name}</Text>
              <Text className="text-xs text-muted">{r.aisleBinCode} · {r.onHand} on hand</Text>
            </Pressable>
          ))}
        </>
      ) : (
        <Card className="gap-3">
          <View className="flex-row items-start justify-between gap-2">
            <Text className="flex-1 text-[16px] font-bold text-ink">{p.name}</Text>
            <Button variant="ghost" title="Change" onPress={() => setP(null)} />
          </View>
          {batches && !batches.length ? <Text className="text-sm text-muted">No batches of this item at this store.</Text> : null}
          {(batches ?? []).map((b) => {
            const e = entries.find((x) => x.batchId === b.batchId)!;
            const d = e.countedQty === null ? null : Math.round((e.countedQty - b.qty) * 1000) / 1000;
            return (
              <View key={b.batchId} className="flex-row items-center gap-3 rounded-xl border border-line p-3">
                <View className="flex-1">
                  <Text className="font-bold text-ink">Batch {b.batchNumber}</Text>
                  <Text className="text-xs text-muted">
                    System {b.qty}{b.expiryMs ? ` · exp ${fmtDate(b.expiryMs)}` : ''}
                    {d !== null && d !== 0 ? <Text className={`font-bold ${d < 0 ? 'text-danger' : 'text-leaf'}`}>{`  ${d > 0 ? '+' : ''}${d}`}</Text> : null}
                  </Text>
                </View>
                <TextInput accessibilityLabel={`Counted for batch ${b.batchNumber}`} keyboardType="decimal-pad" placeholder="Counted" placeholderTextColor="#b3a090" value={counts[b.batchId] ?? ''} onChangeText={(t) => setCounts({ ...counts, [b.batchId]: t })} className="h-12 w-24 rounded-xl border border-line bg-surface text-center text-lg text-ink" />
              </View>
            );
          })}
          <Field label="Reason on the ledger" value={reason} onChangeText={setReason} maxLength={140} />
          <ErrorText>{err}</ErrorText>
          <Button busy={busy} disabled={v.counted === 0 || reason.trim().length < 3} title={v.changed.length ? `Post ${v.changed.length} correction(s) (${v.netDelta > 0 ? '+' : ''}${v.netDelta})` : 'Save count'} onPress={post} />
        </Card>
      )}
    </ScrollView>
  );
}
