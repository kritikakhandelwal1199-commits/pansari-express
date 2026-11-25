import * as React from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Check } from 'lucide-react-native';
import { parseZoneGeometry, rectangleGeometry } from '@pansari/shared';
import type { DeliveryCheck, ZoneRow } from '@pansari/client';
import { Sheet, toPaise } from '@/components/role';
import { Badge, Button, Card, ErrorText, Field, rs } from '@/components/ui';
import { errMsg, useData, useResource } from '@/lib/data';

interface Form { zoneId?: string; name: string; storeIds: string[]; fee: string; freeAbove: string; surge: string; isActive: boolean; box: { south: string; west: string; north: string; east: string }; rawGeometry: string | null }

function boxOf(json: string): Form['box'] | null {
  try {
    const g = parseZoneGeometry(json);
    if (g.type !== 'Polygon' || g.coordinates.length !== 1 || g.coordinates[0]!.length !== 5) return null;
    const r = g.coordinates[0]!;
    const lats = [...new Set(r.map((p) => p[1]))];
    const lngs = [...new Set(r.map((p) => p[0]))];
    if (lats.length !== 2 || lngs.length !== 2) return null;
    return { south: String(Math.min(...lats)), north: String(Math.max(...lats)), west: String(Math.min(...lngs)), east: String(Math.max(...lngs)) };
  } catch {
    return null;
  }
}

export default function Zones() {
  const { client } = useData();
  const zones = useResource(() => client.listZones(), [client]);
  const stores = useResource(() => client.listStores(), [client]);
  const [form, setForm] = React.useState<Form | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [probe, setProbe] = React.useState('');
  const [out, setOut] = React.useState<DeliveryCheck | null>(null);
  useFocusEffect(React.useCallback(() => zones.reload(), [])); // eslint-disable-line react-hooks/exhaustive-deps
  const delivering = (stores.data ?? []).filter((s) => s.type !== 'WAREHOUSE');
  const name = (id: string) => stores.data?.find((s) => s.storeId === id)?.name ?? id;

  function open(z?: ZoneRow) {
    setErr(null);
    if (!z) return setForm({ name: '', storeIds: [], fee: '25', freeAbove: '499', surge: '1.0', isActive: true, box: { south: '', west: '', north: '', east: '' }, rawGeometry: null });
    const box = boxOf(z.geometryJson);
    setForm({ zoneId: z.zoneId, name: z.name, storeIds: [...z.storeIds], fee: String(z.baseDeliveryFee / 100), freeAbove: String(z.freeDeliveryAbove / 100), surge: (z.surgeMultiplierBps / 10_000).toFixed(2), isActive: z.isActive, box: box ?? { south: '', west: '', north: '', east: '' }, rawGeometry: box ? null : z.geometryJson });
  }
  async function save() {
    if (!form) return;
    setBusy(true);
    setErr(null);
    try {
      const geometryJson = form.rawGeometry ?? rectangleGeometry(Number(form.box.south), Number(form.box.west), Number(form.box.north), Number(form.box.east));
      await client.saveZone({ zoneId: form.zoneId, name: form.name, storeIds: form.storeIds, geometryJson, baseDeliveryFee: toPaise(form.fee) ?? -1, freeDeliveryAbove: toPaise(form.freeAbove) ?? -1, surgeMultiplierBps: Math.round(Number(form.surge) * 10_000), isActive: form.isActive });
      setForm(null);
      zones.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(probe);
    setOut(await client.checkDelivery(m ? { pincode: '000000', location: { lat: Number(m[1]), lng: Number(m[2]) } } : { pincode: probe.trim() }).catch(() => null));
  }
  const Tick = ({ on }: { on: boolean }) => <View className={`h-5 w-5 items-center justify-center rounded border-2 ${on ? 'border-kum bg-kum' : 'border-line'}`}>{on ? <Check color="#fff" size={14} /> : null}</View>;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={zones.loading} onRefresh={zones.reload} />}>
      <Button title="New zone" onPress={() => open()} />
      <Card className="gap-2">
        <Text className="font-bold text-ink">Check an address</Text>
        <Field label="Pincode, or lat, lng" placeholder="26.91, 75.74" value={probe} onChangeText={setProbe} />
        <Button variant="outline" title="Check" onPress={() => void test()} />
        {out ? (
          <Text className={`text-sm font-semibold ${out.serviceable ? 'text-leaf' : 'text-danger'}`}>
            {out.serviceable ? `Delivers from ${out.storeName} · ~${out.etaMinutes} min · fee ${rs(out.baseDeliveryFee)}` : { OUTSIDE_ZONES: 'Outside every active zone', NO_STORE_IN_ZONE: 'Zone has no open store', TOO_FAR: 'Inside a zone, but the store is too far', UNKNOWN_PINCODE: 'Pincode not known — try lat, lng', OK: '' }[out.reason]}
          </Text>
        ) : null}
      </Card>
      {(zones.data ?? []).map((z) => (
        <Pressable key={z.zoneId} onPress={() => open(z)} className="gap-1 rounded-2xl border border-line bg-surface p-3">
          <View className="flex-row justify-between gap-2">
            <Text className="flex-1 font-bold text-ink">{z.name}</Text>
            <Badge label={z.isActive ? 'Active' : 'Paused'} tone={z.isActive ? 'good' : 'neutral'} />
          </View>
          <Text className="text-xs text-muted">{z.storeIds.map(name).join(', ')}</Text>
          <Text className="text-sm text-ink">Fee {rs(z.baseDeliveryFee)} · free above {z.freeDeliveryAbove ? rs(z.freeDeliveryAbove) : '—'} · surge {(z.surgeMultiplierBps / 10_000).toFixed(2)}×</Text>
        </Pressable>
      ))}
      <Sheet open={!!form} title={form?.zoneId ? `Edit ${form.name}` : 'New delivery zone'} onClose={() => setForm(null)}>
        {form ? (
          <>
            <Field label="Zone name" value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} maxLength={60} />
            <Text className="text-sm font-semibold text-muted">Stores that deliver here</Text>
            {delivering.map((s) => {
              const on = form.storeIds.includes(s.storeId);
              return (
                <Pressable key={s.storeId} onPress={() => setForm({ ...form, storeIds: on ? form.storeIds.filter((x) => x !== s.storeId) : [...form.storeIds, s.storeId] })} className="flex-row items-center gap-3">
                  <Tick on={on} />
                  <Text className="text-ink">{s.name}</Text>
                </Pressable>
              );
            })}
            <View className="flex-row gap-2">
              <View className="flex-1"><Field label="Fee ₹" keyboardType="decimal-pad" value={form.fee} onChangeText={(t) => setForm({ ...form, fee: t })} /></View>
              <View className="flex-1"><Field label="Free above ₹" keyboardType="decimal-pad" value={form.freeAbove} onChangeText={(t) => setForm({ ...form, freeAbove: t })} /></View>
              <View className="flex-1"><Field label="Surge ×" keyboardType="decimal-pad" value={form.surge} onChangeText={(t) => setForm({ ...form, surge: t })} /></View>
            </View>
            {form.rawGeometry ? (
              <Text className="text-sm text-muted">This zone has a custom outline. Edit its shape on the web admin; fees and stores can be changed here.</Text>
            ) : (
              <>
                <Text className="text-sm font-semibold text-muted">Area (rectangle)</Text>
                <View className="flex-row gap-2">
                  <View className="flex-1"><Field label="South lat" keyboardType="decimal-pad" placeholder="26.88" value={form.box.south} onChangeText={(t) => setForm({ ...form, box: { ...form.box, south: t } })} /></View>
                  <View className="flex-1"><Field label="North lat" keyboardType="decimal-pad" placeholder="26.94" value={form.box.north} onChangeText={(t) => setForm({ ...form, box: { ...form.box, north: t } })} /></View>
                </View>
                <View className="flex-row gap-2">
                  <View className="flex-1"><Field label="West lng" keyboardType="decimal-pad" placeholder="75.70" value={form.box.west} onChangeText={(t) => setForm({ ...form, box: { ...form.box, west: t } })} /></View>
                  <View className="flex-1"><Field label="East lng" keyboardType="decimal-pad" placeholder="75.78" value={form.box.east} onChangeText={(t) => setForm({ ...form, box: { ...form.box, east: t } })} /></View>
                </View>
              </>
            )}
            <Pressable onPress={() => setForm({ ...form, isActive: !form.isActive })} className="flex-row items-center gap-3">
              <Tick on={form.isActive} />
              <Text className="font-semibold text-ink">Taking orders in this zone</Text>
            </Pressable>
            <ErrorText>{err}</ErrorText>
            <Button busy={busy} title="Save zone" onPress={save} />
          </>
        ) : null}
      </Sheet>
    </ScrollView>
  );
}
