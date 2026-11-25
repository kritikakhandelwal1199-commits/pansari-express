import * as React from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { RIDER_COD_CASH_LIMIT, RIDER_PAY_PER_DROP } from '@pansari/shared';
import { Empty, fmtTime } from '@/components/role';
import { Card, rs } from '@/components/ui';
import { useData, useResource } from '@/lib/data';

export default function RiderCash() {
  const { client } = useData();
  const me = useResource(() => client.myRider(), [client]);
  const ledger = useResource(() => client.riderCash(), [client]);
  useFocusEffect(React.useCallback(() => (me.reload(), ledger.reload()), [])); // eslint-disable-line react-hooks/exhaustive-deps
  const r = me.data;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={ledger.loading} onRefresh={() => (me.reload(), ledger.reload())} />}>
      {r ? (
        <View className="flex-row gap-2">
          <Card className="flex-1 gap-1">
            <Text className="text-xs font-semibold text-muted">Cash in hand</Text>
            <Text className={`text-2xl font-extrabold ${r.codCashInHand > RIDER_COD_CASH_LIMIT * 0.8 ? 'text-danger' : 'text-ink'}`}>{rs(r.codCashInHand)}</Text>
            <Text className="text-xs text-muted">Hand it in at the counter. Above {rs(RIDER_COD_CASH_LIMIT)} you can't take more cash orders.</Text>
          </Card>
          <Card className="flex-1 gap-1">
            <Text className="text-xs font-semibold text-muted">Earned, not yet paid</Text>
            <Text className="text-2xl font-extrabold text-ink">{rs(r.earningsBalance)}</Text>
            <Text className="text-xs text-muted">{rs(RIDER_PAY_PER_DROP)} per delivery, paid by the shop.</Text>
          </Card>
        </View>
      ) : null}
      <Text className="text-lg font-bold text-ink">Cash ledger</Text>
      {ledger.data && !ledger.data.length ? <Empty title="No cash yet" sub="Cash-on-delivery money you collect and hand in is listed here." /> : null}
      {(ledger.data ?? []).map((x) => (
        <View key={x.id} className="flex-row items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2">
          <View className="flex-1">
            <Text className="font-bold text-ink">{x.kind === 'COLLECT' ? 'Collected' : 'Handed in at store'}</Text>
            <Text className="text-xs text-muted">{fmtTime(x.atMs)}{x.orderId ? ` · #${x.orderId}` : ''}</Text>
          </View>
          <View className="items-end">
            <Text className={`font-bold ${x.amount < 0 ? 'text-leaf' : 'text-ink'}`}>{x.amount > 0 ? '+' : '−'}{rs(Math.abs(x.amount))}</Text>
            <Text className="text-xs text-muted">left {rs(x.balanceAfter)}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
