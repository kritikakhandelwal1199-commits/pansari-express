import * as React from 'react';
import { FlatList, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { fmtDate, Seg, StoreSwitch, useStore } from '@/components/role';
import { Badge, rs } from '@/components/ui';
import { useData, useResource } from '@/lib/data';

export default function Stock() {
  const { client } = useData();
  const { storeId } = useStore();
  const inv = useResource(() => (storeId ? client.listInventory(storeId) : Promise.resolve([])), [client, storeId]);
  const [q, setQ] = React.useState('');
  const [show, setShow] = React.useState<'all' | 'low' | 'expiry'>('all');
  useFocusEffect(React.useCallback(() => inv.reload(), [])); // eslint-disable-line react-hooks/exhaustive-deps
  const soon = Date.now() + 60 * 86_400_000;
  const t = q.trim().toLowerCase();
  const rows = (inv.data ?? [])
    .filter((r) => !t || r.product.name.toLowerCase().includes(t) || r.product.barcode === q.trim())
    .filter((r) => show === 'all' || (show === 'low' ? r.lowStock : r.nearestExpiryMs !== null && r.nearestExpiryMs < soon));
  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.productId}
      refreshing={inv.loading}
      onRefresh={inv.reload}
      contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}
      ListHeaderComponent={
        <View className="mb-2 gap-3">
          <StoreSwitch />
          <TextInput placeholder="Search stock" placeholderTextColor="#b3a090" value={q} onChangeText={setQ} className="h-12 rounded-xl border border-line bg-surface px-3 text-base text-ink" />
          <Seg value={show} onChange={setShow} options={[{ value: 'all', label: 'All' }, { value: 'low', label: 'Low stock' }, { value: 'expiry', label: 'Expiring in 60 days' }]} />
          <Text className="text-xs text-muted">Prices and catalogue are edited on the web seller portal.</Text>
        </View>
      }
      renderItem={({ item: r }) => (
        <View className="flex-row items-center gap-3 rounded-2xl border border-line bg-surface p-3">
          <View className="flex-1 gap-0.5">
            <Text className="font-bold text-ink">{r.product.name}</Text>
            <Text className="text-xs text-muted">{r.aisleBinCode || 'No bin'} · {rs(r.sellingPrice)}{r.nearestExpiryMs ? ` · exp ${fmtDate(r.nearestExpiryMs)}` : ''}</Text>
          </View>
          <View className="items-end gap-1">
            <Text className="text-lg font-extrabold text-ink">{r.onHand}</Text>
            {r.lowStock ? <Badge label="Low" tone="warn" /> : null}
          </View>
        </View>
      )}
    />
  );
}
