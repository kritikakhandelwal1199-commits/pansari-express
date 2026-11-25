import * as React from 'react';
import { RefreshControl, ScrollView, Text } from 'react-native';
import { HygieneEmpty, HygieneForm, HygieneItem } from '@/components/hygiene';
import { StoreSwitch, useStore } from '@/components/role';
import { useData, useResource } from '@/lib/data';

export default function Hygiene() {
  const { client } = useData();
  const { storeId } = useStore();
  const list = useResource(() => (storeId ? client.listHygieneChecks({ storeId, days: 14 }) : Promise.resolve([])), [client, storeId]);
  const [msg, setMsg] = React.useState<string | null>(null);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} />}>
      <StoreSwitch />
      <Text className="text-sm text-muted">Do the daily check every morning. The compliance team sees every answer.</Text>
      {msg ? <Text className="font-semibold text-leaf">{msg}</Text> : null}
      {storeId ? <HygieneForm storeId={storeId} onSaved={(f) => (setMsg(f ? 'Saved — problems flagged to compliance' : 'Checklist saved'), list.reload())} /> : null}
      <Text className="text-lg font-bold text-ink">Last 14 days</Text>
      {list.data && !list.data.length ? <HygieneEmpty /> : null}
      {(list.data ?? []).map((h) => <HygieneItem key={h.id} h={h} />)}
    </ScrollView>
  );
}
