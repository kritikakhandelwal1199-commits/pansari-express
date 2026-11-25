import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { ProductInfo } from '@pansari/client';
import { ProductFinder } from '@/components/ops';
import { StoreSwitch, toPaise, useStore } from '@/components/role';
import { Button, Card, ErrorText, Field, rs } from '@/components/ui';
import { errMsg, useData, useResource } from '@/lib/data';

const blank = { batchNumber: '', mfgDate: '', expiryDate: '', qty: '', purchasePrice: '', mrp: '' };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function Receive() {
  const { client } = useData();
  const { storeId } = useStore();
  const products = useResource(() => client.listProducts(), [client]);
  const [ref, setRef] = React.useState('');
  const [p, setP] = React.useState<ProductInfo | null>(null);
  const [f, setF] = React.useState(blank);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [last, setLast] = React.useState<string | null>(null);
  const set = (k: keyof typeof blank) => (t: string) => setF({ ...f, [k]: t });

  async function save() {
    if (!p) return;
    for (const d of [f.mfgDate, f.expiryDate]) if (d && !DATE.test(d)) return setErr('Write dates as YYYY-MM-DD, e.g. 2027-03-31');
    setBusy(true);
    setErr(null);
    try {
      const qty = Number(f.qty);
      const r = await client.inwardStock({ storeId, productId: p.productId, batchNumber: f.batchNumber.trim(), mfgDate: f.mfgDate || null, expiryDate: f.expiryDate || null, qty, purchasePrice: toPaise(f.purchasePrice) ?? -1, mrp: toPaise(f.mrp) ?? -1, reference: ref.trim() });
      setLast(`${p.name}: +${qty} · now ${r.onHand} on hand${r.warning ? ` · ${r.warning}` : ''}`);
      setP(null);
      setF(blank);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <StoreSwitch />
      <Field label="Supplier bill / PO number" placeholder="SUP-INV-4471" value={ref} onChangeText={setRef} />
      {!p ? <ProductFinder products={products.data ?? []} onPick={(x) => (setP(x), setErr(null), setF({ ...blank, mrp: String(x.mrp / 100) }))} /> : null}
      {p ? (
        <Card className="gap-3">
          <View className="flex-row items-start justify-between gap-2">
            <View className="flex-1">
              <Text className="text-[16px] font-bold text-ink">{p.name}</Text>
              <Text className="text-sm text-muted">{p.netQuantity} · MRP on file {rs(p.mrp)}</Text>
            </View>
            <Button variant="ghost" title="Change" onPress={() => setP(null)} />
          </View>
          <Field label="Batch number" value={f.batchNumber} onChangeText={set('batchNumber')} autoCapitalize="characters" />
          <Field label={`Quantity (${p.unit})`} keyboardType="decimal-pad" value={f.qty} onChangeText={set('qty')} />
          <View className="flex-row gap-2">
            <View className="flex-1"><Field label="Mfg date" placeholder="YYYY-MM-DD" value={f.mfgDate} onChangeText={set('mfgDate')} /></View>
            <View className="flex-1"><Field label="Expiry date" placeholder={p.fssaiRequired ? 'Needed for food' : 'If any'} value={f.expiryDate} onChangeText={set('expiryDate')} /></View>
          </View>
          <View className="flex-row gap-2">
            <View className="flex-1"><Field label="Purchase ₹ / unit" keyboardType="decimal-pad" value={f.purchasePrice} onChangeText={set('purchasePrice')} /></View>
            <View className="flex-1"><Field label="MRP ₹ on batch" keyboardType="decimal-pad" value={f.mrp} onChangeText={set('mrp')} /></View>
          </View>
          <ErrorText>{err}</ErrorText>
          <Button title="Add to stock" busy={busy} disabled={!f.batchNumber.trim() || !f.qty || !ref.trim()} onPress={save} />
        </Card>
      ) : null}
      {last ? <Text className="text-sm text-muted">Last added: {last}</Text> : null}
    </ScrollView>
  );
}
