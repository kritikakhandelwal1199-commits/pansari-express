import * as React from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Badge, Button, rs } from '@/components/ui';
import { useData, useResource } from '@/lib/data';
import { ORDER_STATUS } from '@/lib/labels';
import { useShop } from '@/lib/shop';

export default function Orders() {
  const { client } = useData();
  const shop = useShop();
  const orders = useResource(() => (shop.isCustomer ? client.myOrders() : Promise.resolve([])), [client, shop.isCustomer]);
  useFocusEffect(React.useCallback(() => orders.reload(), [])); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shop.isCustomer)
    return (
      <View className="flex-1 items-center justify-center gap-3 p-6">
        <Text className="text-lg font-bold text-ink">Sign in to see your orders</Text>
        <Button title="Sign in" onPress={() => router.push('/login')} />
      </View>
    );
  return (
    <FlatList
      data={orders.data ?? []}
      keyExtractor={(o) => o.orderId}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      refreshing={orders.loading}
      onRefresh={orders.reload}
      ListEmptyComponent={orders.loading ? undefined : <Text className="py-10 text-center text-muted">No orders yet.</Text>}
      renderItem={({ item: o }) => (
        <Pressable onPress={() => router.push({ pathname: '/order/[id]', params: { id: o.orderId } })} className="flex-row items-center gap-3 rounded-2xl border border-line bg-surface p-4">
          <View className="flex-1 gap-1">
            <Badge label={ORDER_STATUS[o.status].label} tone={ORDER_STATUS[o.status].tone} />
            <Text numberOfLines={1} className="text-sm text-ink">
              {o.lines.map((l) => `${l.name} × ${l.qty}`).join(', ')}
            </Text>
            <Text className="text-xs text-muted">{new Date(o.placedMs).toLocaleString('en-IN')}</Text>
          </View>
          <Text className="font-extrabold text-ink">{rs(o.grandTotal)}</Text>
        </Pressable>
      )}
    />
  );
}
