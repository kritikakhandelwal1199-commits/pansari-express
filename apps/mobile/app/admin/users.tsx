import * as React from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Check } from 'lucide-react-native';
import { ASSIGNABLE_ROLES, type Role } from '@pansari/shared';
import type { RoleInput, UserRow } from '@pansari/client';
import { Picker, Seg, Sheet } from '@/components/role';
import { Badge, Button, ErrorText, Field } from '@/components/ui';
import { errMsg, useData, useResource } from '@/lib/data';
import { ROLE_LABEL } from '@/lib/roles';

const HELP: Record<string, string> = {
  super_admin: 'Everything, including roles, zones and the tax master.',
  seller: 'Shop owner: all stores (or the ones ticked), prices, catalogue.',
  staff: 'Billing, packing and stock at the ticked stores. No price changes.',
  rider: 'Delivers from one store. Uploads documents before going on shift.',
  compliance: 'KYC and listing review, recalls, audit log.',
  customer: 'Regular shopper. Choose this to remove staff access.',
};
const e164 = (v: string) => {
  const d = v.replace(/\D/g, '');
  return d.length === 10 ? `+91${d}` : d.length === 12 && d.startsWith('91') ? `+${d}` : v.trim();
};

export default function People() {
  const { client } = useData();
  const users = useResource(() => client.listUsers(), [client]);
  const stores = useResource(() => client.listStores(), [client]);
  const [show, setShow] = React.useState<'team' | 'all'>('team');
  const [form, setForm] = React.useState<(RoleInput & { isNew: boolean }) | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  useFocusEffect(React.useCallback(() => users.reload(), [])); // eslint-disable-line react-hooks/exhaustive-deps
  const storeName = (id: string) => stores.data?.find((s) => s.storeId === id)?.name ?? id;
  const list = (users.data ?? []).filter((u) => show === 'all' || u.role !== 'customer');

  const edit = (u: UserRow) => (setErr(null), setForm({ isNew: false, uid: u.uid, displayName: u.displayName ?? '', role: u.role, storeIds: u.storeIds, homeStoreId: u.homeStoreId }));
  async function save() {
    if (!form) return;
    setBusy(true);
    setErr(null);
    try {
      const { isNew, ...i } = form;
      const r = await client.setUserRole({ ...i, phone: isNew ? e164(i.phone ?? '') : undefined, storeIds: i.role === 'seller' || i.role === 'staff' ? i.storeIds : undefined, homeStoreId: i.role === 'rider' ? i.homeStoreId : undefined });
      setMsg(`${r.displayName ?? r.phone} is now ${ROLE_LABEL[r.role]?.toLowerCase()}`);
      setForm(null);
      users.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={users.loading} onRefresh={users.reload} />}>
      <Button title="Add person" onPress={() => (setErr(null), setForm({ isNew: true, phone: '', displayName: '', role: 'staff', storeIds: [], homeStoreId: null }))} />
      <Seg value={show} onChange={setShow} options={[{ value: 'team', label: 'Team' }, { value: 'all', label: 'Everyone' }]} />
      <Text className="text-xs text-muted">A changed role applies the next time the person signs in.</Text>
      {msg ? <Text className="font-semibold text-leaf">{msg}</Text> : null}
      {list.map((u) => (
        <Pressable key={u.uid} onPress={() => edit(u)} className="gap-1 rounded-2xl border border-line bg-surface p-3">
          <View className="flex-row items-center justify-between gap-2">
            <Text className="flex-1 font-bold text-ink">{u.displayName ?? '—'}</Text>
            <Badge label={ROLE_LABEL[u.role] ?? u.role} tone={u.role === 'super_admin' ? 'brand' : u.role === 'customer' ? 'neutral' : 'good'} />
          </View>
          <Text className="text-xs text-muted">
            {u.phone ?? '—'} · {u.role === 'rider' ? (u.homeStoreId ? storeName(u.homeStoreId) : '—') : u.role === 'seller' && !u.storeIds.length ? 'All stores' : u.storeIds.map(storeName).join(', ') || '—'}
          </Text>
        </Pressable>
      ))}
      <Sheet open={!!form} title={form?.isNew ? 'Add a person' : 'Change role'} onClose={() => setForm(null)}>
        {form ? (
          <>
            {form.isNew ? <Field label="Mobile number" keyboardType="phone-pad" placeholder="98XXXXXXXX" value={form.phone ?? ''} onChangeText={(t) => setForm({ ...form, phone: t })} /> : null}
            <Field label="Name" value={form.displayName ?? ''} onChangeText={(t) => setForm({ ...form, displayName: t })} maxLength={60} />
            <Picker label="Role" value={form.role} options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] ?? r, sub: HELP[r] }))} onChange={(v) => setForm({ ...form, role: v as Role })} />
            {form.role === 'seller' || form.role === 'staff' ? (
              <View className="gap-2">
                <Text className="text-sm font-semibold text-muted">{form.role === 'seller' ? 'Stores (none ticked = all)' : 'Stores they work at'}</Text>
                {(stores.data ?? []).map((s) => {
                  const on = form.storeIds?.includes(s.storeId) ?? false;
                  return (
                    <Pressable key={s.storeId} onPress={() => setForm({ ...form, storeIds: on ? form.storeIds!.filter((x) => x !== s.storeId) : [...(form.storeIds ?? []), s.storeId] })} className="flex-row items-center gap-3">
                      <View className={`h-5 w-5 items-center justify-center rounded border-2 ${on ? 'border-kum bg-kum' : 'border-line'}`}>{on ? <Check color="#fff" size={14} /> : null}</View>
                      <Text className="text-ink">{s.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {form.role === 'rider' ? <Picker label="Home store" value={form.homeStoreId ?? ''} placeholder="Choose a store" options={(stores.data ?? []).filter((s) => s.type !== 'WAREHOUSE').map((s) => ({ value: s.storeId, label: s.name }))} onChange={(v) => setForm({ ...form, homeStoreId: v })} /> : null}
            <ErrorText>{err}</ErrorText>
            <Button busy={busy} disabled={form.isNew && e164(form.phone ?? '').length !== 13} title="Save" onPress={save} />
          </>
        ) : null}
      </Sheet>
    </ScrollView>
  );
}
