import * as React from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { nextForwardStatus, operatorCanCancel, riderHasPicked, type OrderStatus } from '@pansari/shared';
import type { OrderRow } from '@pansari/client';
import { RiderPicker } from '@/components/ops';
import { Empty, fmtTime, Seg, Sheet, StoreSwitch, useStore, Who } from '@/components/role';
import { Badge, Button, Card, ErrorText, Field, rs } from '@/components/ui';
import { errMsg, useData, useResource } from '@/lib/data';
import { ORDER_STATUS, PAYMENT_LABEL } from '@/lib/labels';

const ACTION: Partial<Record<OrderStatus, string>> = {
  ACCEPTED: 'Accept',
  PICKING: 'Start packing',
  PACKED: 'Mark packed',
  HANDED_TO_RIDER: 'Hand to rider (issues GST bill)',
  OUT_FOR_DELIVERY: 'Send out (issues GST bill)',
  DELIVERED: 'Delivered — enter code',
};

export default function OwnerOrders() {
  const { client } = useData();
  const { storeId } = useStore();
  const [show, setShow] = React.useState<'open' | 'all'>('open');
  const orders = useResource(() => (storeId ? client.listOnlineOrders(storeId, { includeClosed: show === 'all' }) : Promise.resolve([])), [client, storeId, show]);
  const recalls = useResource(() => client.listRecalls(), [client]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [sheet, setSheet] = React.useState<{ o: OrderRow; kind: 'otp' | 'cancel' } | null>(null);
  const [text, setText] = React.useState('');
  useFocusEffect(React.useCallback(() => orders.reload(), [])); // eslint-disable-line react-hooks/exhaustive-deps

  async function move(o: OrderRow, to: OrderStatus, opts: { otp?: string; reason?: string } = {}) {
    setBusy(o.orderId);
    setErr(null);
    try {
      await client.advanceOrder(o.orderId, to, opts);
      setSheet(null);
      orders.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  }
  const active = (recalls.data ?? []).filter((r) => r.status === 'ACTIVE');
  const list = orders.data ?? [];

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={orders.loading} onRefresh={orders.reload} />}>
      <View className="gap-1">
        <StoreSwitch />
        <Who />
      </View>
      {active.map((r) => (
        <View key={r.id} className="gap-1 rounded-2xl border border-danger bg-[#fde7ea] p-3">
          <Text className="font-bold text-danger">Product recall — keep off the shelf</Text>
          <Text className="text-sm text-ink">{r.productName} · {r.batchNumbers.length ? `batch ${r.batchNumbers.join(', ')}` : 'all batches'} — {r.reason}</Text>
        </View>
      ))}
      <Seg value={show} onChange={setShow} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} />
      <Button variant="outline" title="Open staff tools (pick, receive, count)" onPress={() => router.push('/staff')} />
      {!sheet ? <ErrorText>{err}</ErrorText> : null}
      {!orders.loading && !list.length ? <Empty title="No orders" sub="Delivery orders for this store show up here." /> : null}
      {list.map((o) => {
        const st = ORDER_STATUS[o.status];
        const withRider = !!o.riderUid && riderHasPicked(o.status);
        const next = withRider ? null : o.riderUid && o.status === 'PACKED' ? 'HANDED_TO_RIDER' : nextForwardStatus(o.status);
        return (
          <Card key={o.orderId} className="gap-3">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1 gap-1">
                <Badge label={st.label} tone={st.tone} />
                <Text className="text-xs text-muted">#{o.orderId} · {fmtTime(o.placedMs)}</Text>
                {o.customerName ? <Text className="text-sm text-ink">{o.customerName}{o.deliveryAddress ? ` · ${o.deliveryAddress.line1}` : ''}</Text> : null}
              </View>
              <View className="items-end">
                <Text className="font-extrabold text-ink">{rs(o.grandTotal)}</Text>
                <Text className="text-xs text-muted">{PAYMENT_LABEL[o.payment.method]}{o.invoiceNo ? ` · ${o.invoiceNo}` : ''}</Text>
              </View>
            </View>
            <Text numberOfLines={2} className="text-sm text-ink">{o.lines.map((l) => `${l.name} × ${l.qty}`).join(', ')}</Text>
            {o.cancelReason ? <Text className="text-sm font-semibold text-danger">{o.cancelReason}</Text> : null}
            {withRider ? <Text className="text-sm font-semibold text-ink">{o.status === 'DELIVERED' ? `Delivered by ${o.riderName ?? 'the rider'}` : `${o.riderName ?? 'Rider'} has this order`}</Text> : null}
            <RiderPicker order={o} onDone={orders.reload} />
            <View className="flex-row gap-2">
              {next && ACTION[next] ? (
                <Button className="flex-1" busy={busy === o.orderId} title={ACTION[next]!} onPress={() => (next === 'DELIVERED' ? (setErr(null), setText(''), setSheet({ o, kind: 'otp' })) : void move(o, next))} />
              ) : null}
              {operatorCanCancel(o.status) && !withRider ? <Button variant="danger" title="Cancel" onPress={() => (setErr(null), setText(''), setSheet({ o, kind: 'cancel' }))} /> : null}
            </View>
          </Card>
        );
      })}
      <Sheet open={!!sheet} title={sheet?.kind === 'otp' ? 'Delivery code' : 'Cancel order'} onClose={() => setSheet(null)}>
        <Field
          label={sheet?.kind === 'otp' ? "Customer's 4-digit code" : 'Reason shown to the customer'}
          keyboardType={sheet?.kind === 'otp' ? 'number-pad' : 'default'}
          maxLength={sheet?.kind === 'otp' ? 4 : 140}
          value={text}
          onChangeText={setText}
          autoFocus
        />
        <ErrorText>{err}</ErrorText>
        <Button
          variant={sheet?.kind === 'otp' ? 'leaf' : 'kum'}
          busy={!!sheet && busy === sheet.o.orderId}
          disabled={sheet?.kind === 'otp' ? text.length !== 4 : text.trim().length < 3}
          title={sheet?.kind === 'otp' ? 'Mark delivered' : 'Cancel order'}
          onPress={() => sheet && void move(sheet.o, sheet.kind === 'otp' ? 'DELIVERED' : 'CANCELLED', sheet.kind === 'otp' ? { otp: text } : { reason: text.trim() })}
        />
      </Sheet>
    </ScrollView>
  );
}
