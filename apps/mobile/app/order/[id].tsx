import * as React from 'react';
import { Alert, Linking, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { customerCanCancel, ONLINE_FLOW } from '@pansari/shared';
import { Badge, Button, Card, ErrorText, rs } from '@/components/ui';
import { errMsg, useData, useResource } from '@/lib/data';
import { ORDER_STATUS, PAYMENT_LABEL } from '@/lib/labels';
import { useShop } from '@/lib/shop';

export default function OrderScreen() {
  const { id, new: isNew } = useLocalSearchParams<{ id: string; new?: string }>();
  const { client } = useData();
  const shop = useShop();
  const order = useResource(() => client.getOrder(id), [client, id]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const o = order.data;
  if (!o) return <View className="p-6">{order.loading ? null : <ErrorText>{order.error ?? 'Order not found'}</ErrorText>}</View>;

  const closed = o.status === 'CANCELLED' || o.status === 'REJECTED';
  const idx = ONLINE_FLOW.indexOf(o.status === 'HANDED_TO_RIDER' ? 'OUT_FOR_DELIVERY' : o.status);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      order.reload();
      shop.reloadProfile();
      shop.reloadCatalog();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      {isNew && !closed && o.status !== 'DELIVERED' ? (
        <View className="rounded-2xl bg-leaf p-4">
          <Text className="text-lg font-extrabold text-white">Order placed!</Text>
          <Text className="text-sm text-white/90">{o.storeName} is getting it ready. Arriving in about {o.etaMinutes ?? 10} minutes.</Text>
        </View>
      ) : null}
      <Card className="gap-3">
        <View className="flex-row items-start justify-between">
          <View className="flex-1">
            <Text className="text-xs text-muted">Order {o.orderId}</Text>
            <Text className="text-2xl font-extrabold text-ink">{closed ? ORDER_STATUS[o.status].label : o.status === 'DELIVERED' ? 'Delivered' : `Arriving in ~${o.etaMinutes ?? 10} min`}</Text>
          </View>
          <Badge label={ORDER_STATUS[o.status].label} tone={ORDER_STATUS[o.status].tone} />
        </View>
        {o.deliveryOtp ? (
          <View className="flex-row items-center rounded-2xl border-2 border-dashed border-haldi bg-[#fff8e1] p-3">
            <View className="flex-1">
              <Text className="font-bold text-ink">Delivery code</Text>
              <Text className="text-xs text-muted">Share only when you get the bag.</Text>
            </View>
            <Text className="text-3xl font-extrabold tracking-[6px] text-ink">{o.deliveryOtp}</Text>
          </View>
        ) : null}
        {closed ? (
          <Text className="rounded-xl bg-[#fde7ea] p-3 text-sm text-danger">
            {o.cancelReason}
            {o.payment.status === 'REFUNDED' ? `\n${rs(o.grandTotal)} refunded to your Pansari wallet.` : ''}
          </Text>
        ) : (
          <View>
            {ONLINE_FLOW.map((s, i) => (
              <View key={s} className="flex-row items-center gap-3 py-1.5">
                <View className={`h-6 w-6 items-center justify-center rounded-full border-2 ${i <= idx ? 'border-leaf bg-leaf' : 'border-line'}`}>{i <= idx ? <Text className="text-xs font-bold text-white">✓</Text> : null}</View>
                <Text className={`font-semibold ${i <= idx ? 'text-ink' : 'text-muted'}`}>{ORDER_STATUS[s].label}</Text>
              </View>
            ))}
          </View>
        )}
        {o.riderName && !closed ? (
          <View className="flex-row items-center justify-between gap-2 rounded-xl bg-surface-2 p-3">
            <Text className="flex-1 text-sm text-ink"><Text className="font-bold">{o.riderName}</Text> {o.status === 'DELIVERED' ? 'delivered your order' : 'is delivering your order'}</Text>
            {o.riderPhone && o.status !== 'DELIVERED' ? <Button variant="outline" title="Call" onPress={() => void Linking.openURL(`tel:${o.riderPhone}`)} /> : null}
          </View>
        ) : null}
        {o.invoiceNo ? <Text className="text-sm text-ink">GST invoice {o.invoiceNo} — download it from the web app (Orders).</Text> : null}
        <ErrorText>{err}</ErrorText>
        {customerCanCancel(o.status) ? (
          <Button
            variant="danger"
            title="Cancel order"
            busy={busy}
            onPress={() =>
              Alert.alert('Cancel this order?', o.payment.status === 'PAID' ? `${rs(o.grandTotal)} goes back to your wallet.` : 'Nothing has been charged.', [
                { text: 'Keep order', style: 'cancel' },
                { text: 'Cancel order', style: 'destructive', onPress: () => void run(() => client.cancelMyOrder(o.orderId, 'Cancelled in app')) },
              ])
            }
          />
        ) : null}
        {client.demoAdvanceOrder && !closed && o.status !== 'DELIVERED' ? (
          <View className="rounded-xl border border-dashed border-line p-3">
            <Text className="mb-2 text-xs text-muted">Demo: the store, rider and delivery code live on other devices. Tap to play their part and move this order one step on.</Text>
            <Button variant="outline" busy={busy} title="Demo: next step" onPress={() => run(() => client.demoAdvanceOrder!(o.orderId))} />
          </View>
        ) : null}
      </Card>
      <Card className="gap-1.5">
        <Text className="mb-1 text-[16px] font-bold text-ink">Items</Text>
        {o.lines.map((l) => (
          <View key={l.productId} className="flex-row justify-between">
            <Text className="flex-1 text-ink">{l.name} × {l.qty}</Text>
            <Text className="text-ink">{rs(Math.round(l.unitPrice * l.qty))}</Text>
          </View>
        ))}
        {o.charges.map((c) => (
          <View key={c.code} className="flex-row justify-between">
            <Text className="text-ink">{c.name}</Text>
            <Text className="text-ink">{rs(c.amount)}</Text>
          </View>
        ))}
        <View className="mt-1 flex-row justify-between border-t border-line pt-2">
          <Text className="font-extrabold text-ink">Total · {PAYMENT_LABEL[o.payment.method]}</Text>
          <Text className="font-extrabold text-ink">{rs(o.grandTotal)}</Text>
        </View>
        <Text className="text-xs text-muted">Includes GST {rs(o.totalTax)}</Text>
      </Card>
    </ScrollView>
  );
}
