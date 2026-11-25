import * as React from 'react';
import { RefreshControl, ScrollView, Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { missingDailyChecks } from '@pansari/shared';
import type { HygieneRow } from '@pansari/client';
import { HygieneEmpty, HygieneItem } from '@/components/hygiene';
import { Seg, Sheet } from '@/components/role';
import { Button, ErrorText, Field } from '@/components/ui';
import { errMsg, useData, useResource } from '@/lib/data';

export default function ComplianceHygiene() {
  const { client } = useData();
  const [show, setShow] = React.useState<'flagged' | 'all'>('flagged');
  const rows = useResource(() => client.listHygieneChecks({ days: 30, flaggedOnly: show === 'flagged' }), [client, show]);
  const today = useResource(() => Promise.all([client.listStores(), client.listHygieneChecks({ days: 2 })]), [client]);
  const [sel, setSel] = React.useState<HygieneRow | null>(null);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  useFocusEffect(React.useCallback(() => (rows.reload(), today.reload()), [])); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = today.data ? missingDailyChecks(today.data[0].map((s) => s.storeId), today.data[1], Date.now()) : [];
  const name = (id: string) => today.data?.[0].find((s) => s.storeId === id)?.name ?? id;

  async function review(status: 'OK' | 'ACTION_REQUIRED') {
    if (!sel) return;
    setBusy(true);
    setErr(null);
    try {
      await client.reviewHygieneCheck(sel.id, status, note || undefined);
      setSel(null);
      rows.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={rows.loading} onRefresh={rows.reload} />}>
      {today.data ? <Text className={`rounded-xl p-3 text-sm font-semibold ${missing.length ? 'bg-[#fff1cc] text-ink' : 'bg-[#eef7ec] text-leaf'}`}>{missing.length ? `No daily check yet today: ${missing.map(name).join(', ')}` : 'Every store has done today’s daily check.'}</Text> : null}
      <Seg value={show} onChange={setShow} options={[{ value: 'flagged', label: 'Flagged' }, { value: 'all', label: 'All (30 days)' }]} />
      {rows.data && !rows.data.length ? <HygieneEmpty /> : null}
      {(rows.data ?? []).map((h) => <HygieneItem key={h.id} h={h} onReview={() => (setErr(null), setNote(''), setSel(h))} />)}
      <Sheet open={!!sel} title="Review checklist" onClose={() => setSel(null)}>
        <Field label="Note to the store (required if action is needed)" value={note} onChangeText={setNote} maxLength={200} />
        <ErrorText>{err}</ErrorText>
        <Button variant="leaf" busy={busy} title="Mark OK" onPress={() => void review('OK')} />
        <Button variant="outline" disabled={busy || note.trim().length < 3} title="Needs action" onPress={() => void review('ACTION_REQUIRED')} />
      </Sheet>
    </ScrollView>
  );
}
