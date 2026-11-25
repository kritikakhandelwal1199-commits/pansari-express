import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Check } from 'lucide-react-native';
import { matchScan, type PickLine } from '@pansari/shared';
import { RiderPicker } from '@/components/ops';
import { fmtDate, RoleGate, Scanner, Sheet } from '@/components/role';
import { Badge, Button, ErrorText, Field } from '@/components/ui';
import { errMsg, useData, useResource } from '@/lib/data';
import { ORDER_STATUS } from '@/lib/labels';

function Pick() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client, storage } = useData();
  const task = useResource(() => client.pickTask(id), [client, id]);
  const key = `pansari-pick-${id}`;
  const [done, setDone] = React.useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(storage.getItem(key) ?? '{}');
    } catch {
      return {};
    }
  });
  const [scan, setScan] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [missing, setMissing] = React.useState<PickLine | null>(null);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const started = React.useRef(false);
  React.useEffect(() => storage.setItem(key, JSON.stringify(done)), [done]); // eslint-disable-line react-hooks/exhaustive-deps

  const o = task.data?.order;
  React.useEffect(() => {
    if (!o || started.current || o.status !== 'ACCEPTED') return;
    started.current = true;
    client.advanceOrder(o.orderId, 'PICKING').then(task.reload, (e) => setErr(errMsg(e)));
  }, [o?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = task.data?.lines ?? [];
  const ticked = lines.filter((l) => done[l.productId]).length;
  const all = lines.length > 0 && ticked === lines.length;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      storage.removeItem(key);
      router.back();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  if (task.error) return <View className="p-6"><ErrorText>{task.error}</ErrorText></View>;
  if (!o) return null;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      <View className="flex-row items-center justify-between">
        <Text className="text-2xl font-extrabold text-ink">Picked {ticked} of {lines.length}</Text>
        <Badge label={ORDER_STATUS[o.status].label} tone={ORDER_STATUS[o.status].tone} />
      </View>
      <View className="h-2 overflow-hidden rounded-full bg-surface-2">
        <View className="h-full rounded-full bg-leaf" style={{ width: `${lines.length ? (ticked / lines.length) * 100 : 0}%` }} />
      </View>
      <Text className="text-xs text-muted">#{o.orderId} · walk the shelves in this order</Text>
      <Button title="Scan a barcode" variant="outline" onPress={() => setScan(true)} />
      {note ? <Text className="text-sm font-semibold text-ink">{note}</Text> : null}
      {lines.map((l) => {
        const ok = !!done[l.productId];
        return (
          <View key={l.productId} className={`gap-2 rounded-2xl border p-3 ${ok ? 'border-leaf bg-[#eef7ec]' : 'border-line bg-surface'}`}>
            <Pressable onPress={() => setDone((d) => ({ ...d, [l.productId]: !d[l.productId] }))} className="flex-row items-start gap-3">
              <View className={`mt-0.5 h-7 w-7 items-center justify-center rounded-lg border-2 ${ok ? 'border-leaf bg-leaf' : 'border-line'}`}>{ok ? <Check color="#fff" size={16} /> : null}</View>
              <View className="flex-1 gap-0.5">
                <Text className="text-xs font-bold text-kum">{l.aisleBinCode || 'No bin set'}</Text>
                <Text className="font-bold text-ink">{l.name}</Text>
                <Text className="text-xs text-muted">{l.batches.map((b) => `Batch ${b.batchNumber} × ${b.qty}${b.expiryMs ? ` (exp ${fmtDate(b.expiryMs)})` : ''}`).join(' · ')}</Text>
              </View>
              <Text className="text-2xl font-extrabold text-ink">×{l.qty}</Text>
            </Pressable>
            {!ok ? (
              <Pressable onPress={() => (setErr(null), setReason(`${l.name} is out of stock`), setMissing(l))}>
                <Text className="text-xs font-semibold text-danger underline">Not on the shelf?</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      <RiderPicker order={o} onDone={task.reload} />
      {!missing ? <ErrorText>{err}</ErrorText> : null}
      <Button variant="leaf" busy={busy} disabled={!all || o.status !== 'PICKING'} title={all ? 'Bag sealed — mark packed' : `Tick all ${lines.length} items to finish`} onPress={() => void act(() => client.advanceOrder(o.orderId, 'PACKED'))} />

      <Scanner
        open={scan}
        onClose={() => setScan(false)}
        onCode={(c) => {
          const hit = matchScan(lines, c);
          if (!hit) return setNote(`Not in this order: ${c}`);
          setDone((d) => ({ ...d, [hit.productId]: true }));
          setNote(`✓ ${hit.name} × ${hit.qty}`);
        }}
      />
      <Sheet open={!!missing} title="Item not on the shelf" onClose={() => setMissing(null)}>
        <Text className="text-sm text-muted">If you can't find it, cancel the order so the customer is told and refunded. Stock goes back to the batches — do a shelf count for this item.</Text>
        <Text className="font-bold text-ink">{missing?.name} × {missing?.qty} at {missing?.aisleBinCode || 'no bin'}</Text>
        <Field label="Reason shown to the customer" value={reason} onChangeText={setReason} maxLength={140} />
        <ErrorText>{err}</ErrorText>
        <Button variant="kum" busy={busy} disabled={reason.trim().length < 3} title="Cancel order" onPress={() => void act(() => client.advanceOrder(o.orderId, 'CANCELLED', { reason: reason.trim() }))} />
      </Sheet>
    </ScrollView>
  );
}

export default function PickScreen() {
  return (
    <RoleGate roles={['staff', 'seller']}>
      <Pick />
    </RoleGate>
  );
}
