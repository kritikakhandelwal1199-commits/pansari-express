import * as React from 'react';
import { Linking, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { PAYOUT_METHODS, RIDER_COD_CASH_LIMIT, type PayoutMethod } from '@pansari/shared';
import type { RiderProfile } from '@pansari/client';
import { Empty, fmtTime, KYC_STATUS, Seg, Sheet, StoreSwitch, toPaise, useStore } from '@/components/role';
import { Badge, Button, Card, ErrorText, Field, rs } from '@/components/ui';
import { errMsg, useData, useResource } from '@/lib/data';

export default function Riders() {
  const { client } = useData();
  const { storeId } = useStore();
  const riders = useResource(() => (storeId ? client.listStoreRiders(storeId) : Promise.resolve([])), [client, storeId]);
  const [sel, setSel] = React.useState<{ r: RiderProfile; mode: 'cash' | 'ledger' | 'pay' } | null>(null);
  const [method, setMethod] = React.useState<PayoutMethod>('UPI');
  const [refNo, setRefNo] = React.useState('');
  const ledger = useResource(() => (sel ? client.riderCash(sel.r.uid) : Promise.resolve([])), [client, sel?.r.uid]);
  const payouts = useResource(() => (sel && sel.mode !== 'cash' ? client.listPayouts(sel.r.uid) : Promise.resolve([])), [client, sel?.r.uid, sel?.mode]);
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
  async function pay() {
    if (!sel) return;
    setBusy(true);
    setErr(null);
    try {
      const p = toPaise(amount) ?? 0;
      const r = await client.payRider(sel.r.uid, p, method, refNo);
      setMsg(`Recorded ${rs(p)} paid to ${sel.r.name} · ${rs(r.earningsBalance)} still unpaid`);
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
              <Text className="text-xs text-muted">Earned, unpaid</Text>
              <Text className="text-lg font-extrabold text-ink">{rs(r.earningsBalance)}</Text>
            </View>
            <View className="flex-1 rounded-xl bg-surface-2 p-2">
              <Text className="text-xs text-muted">Orders on hand</Text>
              <Text className="text-lg font-extrabold text-ink">{r.activeOrderIds.length}</Text>
            </View>
          </View>
          <View className="flex-row flex-wrap gap-2">
            <Button className="flex-1" disabled={r.codCashInHand <= 0} title="Receive cash" onPress={() => (setErr(null), setAmount(String(r.codCashInHand / 100)), setSel({ r, mode: 'cash' }))} />
            {r.phone ? <Button variant="outline" title="Call" onPress={() => void Linking.openURL(`tel:${r.phone}`)} /> : null}
            <Button variant="outline" disabled={r.earningsBalance <= 0} title="Pay rider" onPress={() => (setErr(null), setMethod('UPI'), setRefNo(''), setAmount(String(r.earningsBalance / 100)), setSel({ r, mode: 'pay' }))} />
            <Button variant="ghost" title="Ledger" onPress={() => setSel({ r, mode: 'ledger' })} />
          </View>
        </Card>
      ))}
      <Sheet open={!!sel} title={sel ? `${sel.mode === 'cash' ? 'Receive cash from' : sel.mode === 'pay' ? 'Pay' : 'Cash ledger ·'} ${sel.r.name}` : ''} onClose={() => setSel(null)}>
        {sel?.mode === 'pay' ? (
          <>
            <Text className="text-sm text-muted">Unpaid earnings {rs(sel.r.earningsBalance)}. Pay them by UPI, bank or cash first, then record it here.</Text>
            <Field label="Amount paid ₹" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
            <Seg value={method} onChange={setMethod} options={PAYOUT_METHODS.map((m) => ({ value: m, label: m === 'BANK' ? 'Bank' : m === 'UPI' ? 'UPI' : 'Cash' }))} />
            {method !== 'CASH' ? <Field label="UPI / bank reference (UTR)" value={refNo} onChangeText={setRefNo} maxLength={60} /> : null}
            <ErrorText>{err}</ErrorText>
            <Button variant="leaf" busy={busy} disabled={!(toPaise(amount) ?? 0)} title="Record payment" onPress={pay} />
          </>
        ) : null}
        {sel && sel.mode !== 'cash' ? (payouts.data ?? []).map((p) => (
          <View key={p.id} className="flex-row justify-between gap-2 border-b border-line py-1.5">
            <Text className="flex-1 text-sm text-ink">Paid · {p.method} · {fmtTime(p.atMs)}</Text>
            <Text className="text-sm font-bold text-leaf">{rs(p.amount)}</Text>
          </View>
        )) : null}
        {sel?.mode === 'cash' ? (
          <>
            <Text className="text-sm text-muted">They hold {rs(sel.r.codCashInHand)}. Enter what you counted.</Text>
            <Field label="Amount received ₹" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} autoFocus />
            <ErrorText>{err}</ErrorText>
            <Button variant="leaf" busy={busy} disabled={!(toPaise(amount) ?? 0)} title="Confirm cash received" onPress={receive} />
          </>
        ) : null}
        {sel?.mode !== 'pay' ? (ledger.data ?? []).slice(0, 30).map((x) => (
          <View key={x.id} className="flex-row justify-between gap-2 border-b border-line py-1.5">
            <Text className="flex-1 text-sm text-ink">{x.kind === 'COLLECT' ? 'Collected' : 'Handed in'} · {fmtTime(x.atMs)}</Text>
            <Text className="text-sm font-bold text-ink">{x.amount > 0 ? '+' : '−'}{rs(Math.abs(x.amount))}</Text>
          </View>
        )) : null}
        {sel?.mode !== 'pay' && ledger.data && !ledger.data.length ? <Text className="text-sm text-muted">No cash movements yet.</Text> : null}
      </Sheet>
    </ScrollView>
  );
}
