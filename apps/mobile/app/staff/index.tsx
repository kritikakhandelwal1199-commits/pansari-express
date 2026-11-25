import * as React from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { OrderRow } from '@pansari/client';
import { RiderPicker } from '@/components/ops';
import { Empty, fmtTime, StoreSwitch, useStore, Who } from '@/components/role';
import { Badge, Button, Card, ErrorText, rs } from '@/components/ui';
import { errMsg, useData, useResource } from '@/lib/data';
import { ORDER_STATUS, PAYMENT_LABEL } from '@/lib/labels';

const QUEUE: OrderRow['status'][] = ['PLACED', 'ACCEPTED', 'PICKING', 'PACKED'];

export default function PickQueue() {
  const { client } = useData();
  const { storeId } = useStore();
  const orders = useResource(() => (storeId ? client.listOnlineOrders(storeId) : Promise.resolve([])), [client, storeId]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  useFocusEffect(React.useCallback(() => orders.reload(), [])); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const t = setInterval(orders.reload, 15_000);
    return () => clearInterval(t);
  }, [storeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = (orders.data ?? []).filter((o) => QUEUE.includes(o.status)).sort((a, b) => QUEUE.indexOf(a.status) - QUEUE.indexOf(b.status) || a.placedMs - b.placedMs);

  async function accept(o: OrderRow) {
    setBusy(o.orderId);
    setErr(null);
    try {
      await client.advanceOrder(o.orderId, 'ACCEPTED');
      orders.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={orders.loading} onRefresh={orders.reload} />}>
      <View className="gap-1">
        <StoreSwitch />
        <Who />
      </View>
      <ErrorText>{err}</ErrorText>
      {!orders.loading && !list.length ? <Empty title="Nothing to pack" sub="New delivery orders for this store show up here." /> : null}
      {list.map((o) => {
        const st = ORDER_STATUS[o.status];
        const units = o.lines.reduce((a, l) => a + l.qty, 0);
        return (
          <Card key={o.orderId} className="gap-3">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1 gap-1">
                <Badge label={st.label} tone={st.tone} />
                <Text className="font-bold text-ink">{o.lines.length} item{o.lines.length === 1 ? '' : 's'} · {units} unit{units === 1 ? '' : 's'}</Text>
                <Text className="text-xs text-muted">#{o.orderId} · {fmtTime(o.placedMs)}</Text>
              </View>
              <View className="items-end">
                <Text className="font-extrabold text-ink">{rs(o.grandTotal)}</Text>
                <Text className="text-xs text-muted">{PAYMENT_LABEL[o.payment.method]}</Text>
              </View>
            </View>
            {o.riderName ? <Text className="text-sm font-semibold text-ink">{o.riderName} will collect</Text> : null}
            {o.status !== 'PLACED' ? <RiderPicker order={o} onDone={orders.reload} /> : null}
            {o.status === 'PLACED' ? <Button title="Accept order" busy={busy === o.orderId} onPress={() => void accept(o)} /> : null}
            {o.status === 'ACCEPTED' || o.status === 'PICKING' ? <Button title={o.status === 'ACCEPTED' ? 'Start picking' : 'Continue picking'} onPress={() => router.push({ pathname: '/pick/[id]', params: { id: o.orderId } })} /> : null}
            {o.status === 'PACKED' ? <Text className="text-sm text-muted">{o.riderUid ? 'Packed — waiting for the rider to collect.' : 'Packed — assign a rider, or the owner sends it out.'}</Text> : null}
          </Card>
        );
      })}
    </ScrollView>
  );
}
