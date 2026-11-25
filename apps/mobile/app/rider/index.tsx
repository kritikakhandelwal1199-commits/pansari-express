import * as React from 'react';
import { Linking, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { riderNextStatus, RIDER_COD_CASH_LIMIT } from '@pansari/shared';
import type { OrderRow } from '@pansari/client';
import { Empty, fmtTime, KYC_STATUS, Sheet, Who } from '@/components/role';
import { Badge, Button, Card, ErrorText, Field, rs } from '@/components/ui';
import { errMsg, useData, useResource } from '@/lib/data';
import { ORDER_STATUS, PAYMENT_LABEL } from '@/lib/labels';

const cashDue = (o: OrderRow) => o.payment.method === 'COD' && o.payment.status !== 'PAID';

async function here() {
  try {
    const p = await Location.requestForegroundPermissionsAsync();
    if (!p.granted) return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}

export default function RiderHome() {
  const { client } = useData();
  const me = useResource(() => client.myRider(), [client]);
  const orders = useResource(() => client.riderOrders(), [client]);
  const stores = useResource(() => client.deliveryStores(), [client]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [deliver, setDeliver] = React.useState<OrderRow | null>(null);
  const [otp, setOtp] = React.useState('');
  const reload = React.useCallback(() => {
    me.reload();
    orders.reload();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(reload);
  React.useEffect(() => {
    const t = setInterval(reload, 15_000);
    return () => clearInterval(t);
  }, [reload]);

  const r = me.data;
  const list = orders.data ?? [];
  const live = list.filter((o) => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status));
  const done = list.filter((o) => o.status === 'DELIVERED');
  const home = stores.data?.find((s) => s.storeId === r?.homeStoreId);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      reload();
      return true;
    } catch (e) {
      setErr(errMsg(e));
      return false;
    } finally {
      setBusy(null);
    }
  }
  const step = (o: OrderRow, extra: { otp?: string } = {}) => {
    const to = riderNextStatus(o.status);
    return to ? run(o.orderId, () => client.advanceOrder(o.orderId, to, extra)) : Promise.resolve(false);
  };

  if (me.error) return <View className="p-6"><Empty title="Rider account not ready" sub={me.error} /></View>;
  if (!r) return null;
  const kyc = KYC_STATUS[r.kycStatus];

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={orders.loading} onRefresh={reload} />}>
      <Card className={`gap-3 ${r.isOnline ? 'border-leaf' : ''}`}>
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-lg font-extrabold text-ink">{r.name}</Text>
            <Badge label={kyc.label} tone={kyc.tone} />
            {home ? <Text className="text-sm text-muted">Collects from {home.name}</Text> : null}
          </View>
          <Button
            variant={r.isOnline ? 'outline' : 'leaf'}
            busy={busy === 'shift'}
            disabled={!r.isOnline && r.kycStatus !== 'VERIFIED'}
            title={r.isOnline ? 'Go off shift' : 'Go on shift'}
            onPress={() => run('shift', async () => client.setRiderShift(!r.isOnline, r.isOnline ? null : await here()))}
          />
        </View>
        {r.kycStatus !== 'VERIFIED' ? (
          <Text className="text-sm text-ink">
            {r.kycStatus === 'UNDER_REVIEW' ? 'Your documents are with the compliance team. You can go on shift once they are verified.' : 'Upload your driving licence, vehicle RC and masked Aadhaar to start delivering.'}{' '}
            <Text className="font-bold text-kum underline" onPress={() => router.push('/rider/kyc')}>My documents</Text>
          </Text>
        ) : null}
        <View className="flex-row gap-2">
          <View className="flex-1 rounded-xl bg-surface-2 p-3">
            <Text className="text-xs font-semibold text-muted">Cash in hand</Text>
            <Text className={`text-xl font-extrabold ${r.codCashInHand > RIDER_COD_CASH_LIMIT * 0.8 ? 'text-danger' : 'text-ink'}`}>{rs(r.codCashInHand)}</Text>
          </View>
          <View className="flex-1 rounded-xl bg-surface-2 p-3">
            <Text className="text-xs font-semibold text-muted">Earned (unpaid)</Text>
            <Text className="text-xl font-extrabold text-ink">{rs(r.earningsBalance)}</Text>
          </View>
        </View>
        <Who />
      </Card>
      {!deliver ? <ErrorText>{err}</ErrorText> : null}

      <Text className="text-lg font-bold text-ink">Your deliveries</Text>
      {!orders.loading && !live.length ? <Empty title={r.isOnline ? 'Waiting for an order' : 'No deliveries'} sub={r.isOnline ? 'When the store gives you an order it appears here.' : 'Go on shift to get orders.'} /> : null}

      {live.map((o) => {
        const st = ORDER_STATUS[o.status];
        const a = o.deliveryAddress;
        const next = riderNextStatus(o.status);
        return (
          <Card key={o.orderId} className="gap-3">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1 gap-1">
                <Badge label={st.label} tone={st.tone} />
                <Text className="text-xs text-muted">#{o.orderId} · {o.storeName}</Text>
              </View>
              <View className="items-end">
                {cashDue(o) ? (
                  <>
                    <Text className="text-xl font-extrabold text-warn">{rs(o.grandTotal)}</Text>
                    <Text className="text-xs font-bold text-warn">Collect cash</Text>
                  </>
                ) : (
                  <>
                    <Text className="text-lg font-bold text-ink">{rs(o.grandTotal)}</Text>
                    <Text className="text-xs text-muted">{PAYMENT_LABEL[o.payment.method]} · paid</Text>
                  </>
                )}
              </View>
            </View>
            {a ? (
              <View className="gap-2">
                <Text className="text-sm text-ink">
                  {o.customerName ? <Text className="font-bold">{o.customerName} · </Text> : null}
                  {a.line1}
                  {a.line2 ? `, ${a.line2}` : ''}, {a.pincode}
                </Text>
                <View className="flex-row gap-2">
                  <Button className="flex-1" variant="outline" title="Directions" onPress={() => void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${a.location.lat},${a.location.lng}`)} />
                  {o.customerPhone ? <Button className="flex-1" variant="outline" title="Call" onPress={() => void Linking.openURL(`tel:${o.customerPhone}`)} /> : null}
                </View>
              </View>
            ) : null}
            <View className="gap-1 rounded-xl bg-surface-2 p-3">
              {o.lines.map((l) => (
                <View key={l.productId} className="flex-row justify-between gap-2">
                  <Text className="flex-1 text-sm text-ink">{l.name}</Text>
                  <Text className="text-sm font-bold text-ink">× {l.qty}</Text>
                </View>
              ))}
            </View>
            {o.status === 'ACCEPTED' || o.status === 'PICKING' ? <Text className="text-sm font-semibold text-muted">The store is packing this order. Head to {o.storeName}.</Text> : null}
            {next ? (
              <Button
                variant={next === 'DELIVERED' ? 'leaf' : 'kum'}
                busy={busy === o.orderId}
                title={next === 'HANDED_TO_RIDER' ? 'I have collected the bag' : next === 'OUT_FOR_DELIVERY' ? 'Start trip' : 'Deliver — enter code'}
                onPress={() => (next === 'DELIVERED' ? (setErr(null), setOtp(''), setDeliver(o)) : void step(o))}
              />
            ) : null}
          </Card>
        );
      })}

      {done.length ? <Text className="mt-2 text-lg font-bold text-ink">Delivered today</Text> : null}
      {done.map((o) => (
        <View key={o.orderId} className="flex-row justify-between rounded-xl border border-line bg-surface px-3 py-2">
          <Text className="text-sm text-ink">#{o.orderId} · {fmtTime(o.statusHistory.at(-1)?.at ?? o.placedMs)}</Text>
          <Text className="text-sm font-bold text-ink">{o.payment.method === 'COD' ? `${rs(o.grandTotal)} cash` : 'paid online'}</Text>
        </View>
      ))}

      <Sheet open={!!deliver} title="Hand over the order" onClose={() => setDeliver(null)}>
        <Text className="text-sm text-muted">Ask the customer for the 4-digit code on their order page. Never deliver without it.</Text>
        {deliver && cashDue(deliver) ? <Text className="rounded-xl bg-[#fff1cc] p-3 text-[15px] font-bold text-ink">Collect {rs(deliver.grandTotal)} in cash first</Text> : null}
        <Field label="Delivery code" keyboardType="number-pad" maxLength={4} value={otp} onChangeText={(t) => setOtp(t.replace(/\D/g, ''))} autoFocus />
        <ErrorText>{err}</ErrorText>
        <Button
          variant="leaf"
          title="Delivered"
          busy={!!deliver && busy === deliver.orderId}
          disabled={otp.length !== 4}
          onPress={() => deliver && void step(deliver, { otp }).then((ok) => ok && setDeliver(null))}
        />
      </Sheet>
    </ScrollView>
  );
}
