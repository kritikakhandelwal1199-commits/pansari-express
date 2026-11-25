import * as React from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { fmtTime, Who } from '@/components/role';
import { Button, Card } from '@/components/ui';
import { useData, useResource } from '@/lib/data';
import { ROLE_LABEL } from '@/lib/roles';

export default function AdminHome() {
  const { client } = useData();
  const all = useResource(() => Promise.all([client.listUsers(), client.listZones(), client.listAllProducts(), client.listKycDocs({ status: 'PENDING' }), client.listAudit({ max: 6 })]).then(([users, zones, products, kyc, audit]) => ({ users, zones, products, kyc, audit })), [client]);
  useFocusEffect(React.useCallback(() => all.reload(), [])); // eslint-disable-line react-hooks/exhaustive-deps
  const d = all.data;
  const Stat = ({ label, value, sub }: { label: string; value: number; sub: string }) => (
    <Card className="flex-1 gap-0.5">
      <Text className="text-xs font-semibold text-muted">{label}</Text>
      <Text className="text-2xl font-extrabold text-ink">{value}</Text>
      <Text className="text-xs text-muted">{sub}</Text>
    </Card>
  );
  const byRole = d ? Object.entries(d.users.reduce<Record<string, number>>((a, u) => ((a[u.role] = (a[u.role] ?? 0) + 1), a), {})) : [];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={all.loading} onRefresh={all.reload} />}>
      <Who />
      {d ? (
        <>
          <View className="flex-row gap-2">
            <Stat label="People with a role" value={d.users.filter((u) => u.role !== 'customer').length} sub={`${d.users.filter((u) => u.role === 'customer').length} customers`} />
            <Stat label="Delivery zones" value={d.zones.filter((z) => z.isActive).length} sub={`${d.zones.filter((z) => !z.isActive).length} paused`} />
          </View>
          <View className="flex-row gap-2">
            <Stat label="Listings waiting" value={d.products.filter((p) => p.complianceStatus === 'PENDING_REVIEW').length} sub="to approve" />
            <Stat label="KYC waiting" value={d.kyc.length} sub="for compliance" />
          </View>
          <Card className="gap-1">
            <Text className="mb-1 text-[16px] font-bold text-ink">Team</Text>
            {byRole.map(([r, n]) => (
              <View key={r} className="flex-row justify-between border-b border-line py-1.5">
                <Text className="text-ink">{ROLE_LABEL[r] ?? r}</Text>
                <Text className="font-bold text-ink">{n}</Text>
              </View>
            ))}
          </Card>
          <Card className="gap-1">
            <Text className="mb-1 text-[16px] font-bold text-ink">Recent changes</Text>
            {d.audit.map((a) => (
              <View key={a.id} className="flex-row justify-between gap-2 border-b border-line py-1.5">
                <Text className="flex-1 font-semibold text-ink">{a.action}</Text>
                <Text className="text-xs text-muted">{fmtTime(a.atMs)}</Text>
              </View>
            ))}
          </Card>
          <Button variant="outline" title="Compliance tools (KYC, recalls)" onPress={() => router.push('/compliance')} />
        </>
      ) : null}
    </ScrollView>
  );
}
