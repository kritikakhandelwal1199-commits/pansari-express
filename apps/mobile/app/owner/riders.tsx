import * as React from 'react';
import { Linking, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { RIDER_COD_CASH_LIMIT } from '@pansari/shared';
import type { RiderProfile } from '@pansari/client';
import { Empty, fmtTime, KYC_STATUS, Sheet, StoreSwitch, toPaise, useStore } from '@/components/role';
import { Badge, Button, Card, ErrorText, Field, rs } from '@/components/ui';
import { errMsg, useData, useResource } from '@/lib/data';

export default function Riders() {
  const { client } = useData();
  const { storeId } = useStore();
  const riders = useResource(() => (storeId ? client.listStoreRiders(storeId) : Promise.resolve([])), [client, storeId]);
  const [sel, setSel] = React.useState<{ r: RiderProfile; mode: 'cash' | 'ledger' } | null>(null);
  const ledger = useResource(() => (sel ? client.riderCash(sel.r.uid) : Promise.resolve([])), [client, sel?.r.uid]);
  const [amount, setAmount] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  useFocusEffect(React.useCallback(() => riders.reload(), [])); // eslint-disable-line react-hooks/exhaustive-deps

  async function receive() {
    if (!sel) return;
    setBusy(true);
    setErr(null);
    try {
      const p = toPaise(amount) ?? 0;
      const r = await client.receiveCodCash(storeId, sel.r.uid, p);
      setMsg(`Received ${rs(p)} from ${sel.r.name} · ${rs(r.codCashInHand)} still with them`);
      setSel(null);
      riders.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  const list = riders.data ?? [];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={riders.loading} onRefresh={riders.reload} />}>
      <StoreSwitch />
      <Text className="text-sm text-muted">Count the cash a rider hands in, then confirm the amount here.</Text>
      {msg ? <Text className="font-semibold text-leaf">{msg}</Text> : null}
      {!riders.loading && !list.length ? <Empty title="No riders at this store" sub="Ask the admin to add a rider with this store as home store." /> : null}
      {list.length ? <Text className="text-sm text-ink">Cash with riders now: <Text className="font-bold">{rs(list.reduce((a, r) => a + r.codCashInHand, 0))}</Text></Text> : null}
      {list.map((r) => (
        <Card key={r.uid} className="gap-3">
          <View className="flex-row items-start justify-between gap-2">
            <View className="flex-1">
              <Text className="text-[16px] font-bold text-ink">{r.name}</Text>
              <Text className="text-sm text-muted">{r.vehicleNumber ?? r.vehicleType.toLowerCase()}</Text>
            </View>
            <View className="items-end gap-1">
              <Badge label={r.isOnline ? 'On shift' : 'Off shift'} tone={r.isOnline ? 'good' : 'neutral'} />
              {r.kycStatus !== 'VERIFIED' ? <Badge label={KYC_STATUS[r.kycStatus].label} tone={KYC_STATUS[r.kycStatus].tone} /> : null}
            </View>
          </View>
          <View className="flex-row gap-2">
            <View className="flex-1 rounded-xl bg-surface-2 p-2">
              <Text className="text-xs text-muted">Cash in hand</Text>
              <Text className={`text-lg font-extrabold ${r.codCashInHand > RIDER_COD_CASH_LIMIT * 0.8 ? 'text-danger' : 'text-ink'}`}>{rs(r.codCashInHand)}</Text>
            </View>
            <View className="flex-1 rounded-xl bg-surface-2 p-2">
              <Text className="text-xs text-muted">Orders on hand</Text>
              <Text className="text-lg font-extrabold text-ink">{r.activeOrderIds.length}</Text>
            </View>
          </View>
          <View className="flex-row flex-wrap gap-2">
            <Button className="flex-1" disabled={r.codCashInHand <= 0} title="Receive cash" onPress={() => (setErr(null), setAmount(String(r.codCashInHand / 100)), setSel({ r, mode: 'cash' }))} />
            {r.phone ? <Button variant="outline" title="Call" onPress={() => void Linking.openURL(`tel:${r.phone}`)} /> : null}
            <Button variant="ghost" title="Ledger" onPress={() => setSel({ r, mode: 'ledger' })} />
          </View>
        </Card>
      ))}
      <Sheet open={!!sel} title={sel ? `${sel.mode === 'cash' ? 'Receive cash from' : 'Cash ledger ·'} ${sel.r.name}` : ''} onClose={() => setSel(null)}>
        {sel?.mode === 'cash' ? (
          <>
            <Text className="text-sm text-muted">They hold {rs(sel.r.codCashInHand)}. Enter what you counted.</Text>
            <Field label="Amount received ₹" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} autoFocus />
            <ErrorText>{err}</ErrorText>
            <Button variant="leaf" busy={busy} disabled={!(toPaise(amount) ?? 0)} title="Confirm cash received" onPress={receive} />
          </>
        ) : null}
        {(ledger.data ?? []).slice(0, 30).map((x) => (
          <View key={x.id} className="flex-row justify-between gap-2 border-b border-line py-1.5">
            <Text className="flex-1 text-sm text-ink">{x.kind === 'COLLECT' ? 'Collected' : 'Handed in'} · {fmtTime(x.atMs)}</Text>
            <Text className="text-sm font-bold text-ink">{x.amount > 0 ? '+' : '−'}{rs(Math.abs(x.amount))}</Text>
          </View>
        ))}
        {ledger.data && !ledger.data.length ? <Text className="text-sm text-muted">No cash movements yet.</Text> : null}
      </Sheet>
    </ScrollView>
  );
}
