import * as React from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { GST_SLABS } from '@pansari/shared';
import type { HsnRow } from '@pansari/client';
import { Picker, Sheet } from '@/components/role';
import { Button, ErrorText, Field } from '@/components/ui';
import { errMsg, useData, useResource } from '@/lib/data';

export default function Hsn() {
  const { client } = useData();
  const hsn = useResource(() => client.listHsn(), [client]);
  const products = useResource(() => client.listAllProducts(), [client]);
  const [form, setForm] = React.useState<(HsnRow & { isNew: boolean }) | null>(null);
  const [q, setQ] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  useFocusEffect(React.useCallback(() => hsn.reload(), [])); // eslint-disable-line react-hooks/exhaustive-deps
  const used = (c: string) => (products.data ?? []).filter((p) => p.hsnCode.startsWith(c)).length;
  const t = q.trim().toLowerCase();
  const list = (hsn.data ?? []).filter((h) => !t || h.hsnCode.startsWith(t) || h.description.toLowerCase().includes(t)).sort((a, b) => a.hsnCode.localeCompare(b.hsnCode));

  async function save() {
    if (!form) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await client.upsertHsn({ hsnCode: form.hsnCode, description: form.description, gstSlab: form.gstSlab });
      setMsg(r.productsUpdated ? `Saved · ${r.productsUpdated} product(s) now billed at ${form.gstSlab}%` : 'Saved');
      setForm(null);
      hsn.reload();
      products.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={hsn.loading} onRefresh={hsn.reload} />}>
      <Text className="text-xs text-muted">Products take their GST rate from the most specific HSN here (8, 6, then 4 digits). Confirm codes and rates with your CA.</Text>
      <Button title="Add HSN" onPress={() => (setErr(null), setForm({ isNew: true, hsnCode: '', description: '', gstSlab: 5 }))} />
      {msg ? <Text className="font-semibold text-leaf">{msg}</Text> : null}
      <TextInput placeholder="Search code or description" placeholderTextColor="#b3a090" value={q} onChangeText={setQ} className="h-12 rounded-xl border border-line bg-surface px-3 text-base text-ink" />
      {list.map((h) => (
        <Pressable key={h.hsnCode} onPress={() => (setErr(null), setForm({ ...h, isNew: false }))} className="flex-row items-center gap-3 rounded-xl border border-line bg-surface p-3">
          <View className="flex-1">
            <Text className="font-bold text-ink">{h.hsnCode}</Text>
            <Text className="text-sm text-ink">{h.description}</Text>
            <Text className="text-xs text-muted">{used(h.hsnCode)} product(s)</Text>
          </View>
          <Text className="text-lg font-extrabold text-ink">{h.gstSlab}%</Text>
        </Pressable>
      ))}
      <Sheet open={!!form} title={form?.isNew ? 'Add HSN code' : `Edit HSN ${form?.hsnCode ?? ''}`} onClose={() => setForm(null)}>
        {form ? (
          <>
            <Field label="HSN code (4, 6 or 8 digits)" keyboardType="number-pad" editable={form.isNew} value={form.hsnCode} onChangeText={(t) => setForm({ ...form, hsnCode: t.replace(/\D/g, '').slice(0, 8) })} />
            <Field label="Description" value={form.description} onChangeText={(t) => setForm({ ...form, description: t })} maxLength={120} />
            <Picker label="GST rate" value={String(form.gstSlab)} options={GST_SLABS.map((s) => ({ value: String(s), label: `${s}%` }))} onChange={(v) => setForm({ ...form, gstSlab: Number(v) as HsnRow['gstSlab'] })} />
            {!form.isNew && hsn.data?.find((h) => h.hsnCode === form.hsnCode)?.gstSlab !== form.gstSlab ? <Text className="rounded-xl bg-[#fff1cc] p-2 text-sm font-semibold text-ink">{used(form.hsnCode)} product(s) will be billed at {form.gstSlab}% from the next sale. Bills already issued don't change.</Text> : null}
            <ErrorText>{err}</ErrorText>
            <Button busy={busy} title="Save" onPress={save} />
          </>
        ) : null}
      </Sheet>
    </ScrollView>
  );
}
