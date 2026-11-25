/** Order + stock helpers shared by the owner and staff apps. */
import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { OrderRow, ProductInfo } from '@pansari/client';
import { Picker, Scanner } from '@/components/role';
import { ErrorText, Field, rs } from '@/components/ui';
import { errMsg, useData, useResource } from '@/lib/data';

export function RiderPicker({ order, onDone }: { order: OrderRow; onDone: () => void }) {
  const { client } = useData();
  const riders = useResource(() => client.listStoreRiders(order.storeId), [client, order.storeId]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  if (!['ACCEPTED', 'PICKING', 'PACKED'].includes(order.status)) return null;
  const list = riders.data ?? [];
  const why = (r: (typeof list)[number]) => (r.kycStatus !== 'VERIFIED' ? 'documents pending' : !r.isOnline ? 'off shift' : r.activeOrderIds.filter((x) => x !== order.orderId).length >= 3 ? 'has 3 orders' : null);
  return (
    <View className="gap-1">
      <Picker
        label="Rider"
        disabled={busy}
        value={order.riderUid ?? ''}
        options={[
          { value: '', label: list.length ? 'Store delivers (no rider)' : 'No riders at this store' },
          ...list.map((r) => {
            const w = why(r);
            return { value: r.uid, label: r.name, sub: w ?? `${r.activeOrderIds.length} on hand${r.codCashInHand ? ` · ${rs(r.codCashInHand)} cash` : ''}`, disabled: !!w && r.uid !== order.riderUid };
          }),
        ]}
        onChange={async (uid) => {
          setBusy(true);
          setErr(null);
          try {
            await client.assignRider(order.orderId, uid || null);
            onDone();
            riders.reload();
          } catch (e) {
            setErr(errMsg(e));
          } finally {
            setBusy(false);
          }
        }}
      />
      <ErrorText>{err}</ErrorText>
    </View>
  );
}

/** Search by name / barcode, or scan. */
export function ProductFinder({ products, onPick }: { products: ProductInfo[]; onPick: (p: ProductInfo) => void }) {
  const [q, setQ] = React.useState('');
  const [scan, setScan] = React.useState(false);
  const [miss, setMiss] = React.useState<string | null>(null);
  const t = q.trim().toLowerCase();
  const hits = t ? products.filter((p) => p.barcode === q.trim() || p.name.toLowerCase().includes(t) || (p.nameHi ?? '').includes(q.trim())).slice(0, 8) : [];
  const pick = (p: ProductInfo) => {
    setQ('');
    setMiss(null);
    onPick(p);
  };
  return (
    <View className="gap-2">
      <View className="flex-row items-end gap-2">
        <View className="flex-1">
          <Field label="Find item" placeholder="Type a name or barcode" value={q} onChangeText={setQ} />
        </View>
        <Pressable accessibilityRole="button" onPress={() => setScan(true)} className="h-12 justify-center rounded-xl bg-kum px-4">
          <Text className="font-bold text-white">Scan</Text>
        </Pressable>
      </View>
      {miss ? <ErrorText>{`No product with barcode ${miss}`}</ErrorText> : null}
      {hits.map((p) => (
        <Pressable key={p.productId} onPress={() => pick(p)} className="flex-row justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-3">
          <Text className="flex-1 font-semibold text-ink">{p.name}</Text>
          <Text className="text-xs text-muted">{p.barcode ?? ''}</Text>
        </Pressable>
      ))}
      <Scanner
        open={scan}
        onClose={() => setScan(false)}
        onCode={(c) => {
          const p = products.find((x) => x.barcode === c);
          if (p) pick(p);
          else setMiss(c);
        }}
      />
    </View>
  );
}
