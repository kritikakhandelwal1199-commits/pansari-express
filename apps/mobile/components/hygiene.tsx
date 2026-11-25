/** Hygiene checklists on the phone: staff fill them in, compliance reviews them. */
import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { COLD_RANGE, HYGIENE_KIND_LABEL, HYGIENE_QUESTIONS, type HygieneKind } from '@pansari/shared';
import type { HygieneRow } from '@pansari/client';
import { Empty, fmtTime, Picker } from '@/components/role';
import { Badge, Button, Card, ErrorText, Field } from '@/components/ui';
import { errMsg, useData } from '@/lib/data';

export function HygieneForm({ storeId, onSaved }: { storeId: string; onSaved: (flagged: boolean) => void }) {
  const { client } = useData();
  const [kind, setKind] = React.useState<HygieneKind>('HYGIENE_DAILY');
  const qs = HYGIENE_QUESTIONS[kind];
  const blank = () => HYGIENE_QUESTIONS[kind].map(() => ({ ok: null as boolean | null, note: '' }));
  const [ans, setAns] = React.useState(blank);
  const [temp, setTemp] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    setAns(blank());
    setTemp('');
    setErr(null);
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = ans.length === qs.length && ans.every((a) => a.ok !== null && (a.ok || a.note.trim().length >= 3)) && (kind !== 'COLD_CHAIN' || temp.trim() !== '');
  const set = (i: number, p: Partial<{ ok: boolean | null; note: string }>) => setAns(ans.map((x, j) => (j === i ? { ...x, ...p } : x)));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const r = await client.submitHygieneCheck({ storeId, kind, answers: qs.map((question, i) => ({ question, ok: ans[i]!.ok === true, note: ans[i]!.note.trim() || undefined })), temperatureC: kind === 'COLD_CHAIN' ? Number(temp) : null });
      setAns(blank());
      setTemp('');
      onSaved(r.flagged);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="gap-3">
      <Picker label="Checklist" value={kind} options={(Object.keys(HYGIENE_QUESTIONS) as HygieneKind[]).map((k) => ({ value: k, label: HYGIENE_KIND_LABEL[k] }))} onChange={(v) => setKind(v as HygieneKind)} />
      {qs.map((q, i) => {
        const a = ans[i] ?? { ok: null, note: '' };
        return (
          <View key={q} className="gap-2 rounded-xl border border-line p-3">
            <Text className="font-semibold text-ink">{q}</Text>
            <View className="flex-row gap-2">
              <Pressable accessibilityRole="button" accessibilityState={{ selected: a.ok === true }} onPress={() => set(i, { ok: true })} className={`h-10 flex-1 items-center justify-center rounded-xl ${a.ok === true ? 'bg-leaf' : 'border border-line bg-surface'}`}>
                <Text className={`font-bold ${a.ok === true ? 'text-white' : 'text-ink'}`}>Yes</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityState={{ selected: a.ok === false }} onPress={() => set(i, { ok: false })} className={`h-10 flex-1 items-center justify-center rounded-xl ${a.ok === false ? 'bg-danger' : 'border border-line bg-surface'}`}>
                <Text className={`font-bold ${a.ok === false ? 'text-white' : 'text-ink'}`}>No</Text>
              </Pressable>
            </View>
            {a.ok === false ? <Field label="What is wrong, and what you did" value={a.note} onChangeText={(t) => set(i, { note: t })} maxLength={200} /> : null}
          </View>
        );
      })}
      {kind === 'COLD_CHAIN' ? <Field label={`Temperature now °C (safe ${COLD_RANGE.min}–${COLD_RANGE.max})`} keyboardType="decimal-pad" value={temp} onChangeText={setTemp} /> : null}
      <ErrorText>{err}</ErrorText>
      <Button busy={busy} disabled={!ready} title="Submit checklist" onPress={save} />
    </Card>
  );
}

const STATUS = { PENDING: { label: 'Not reviewed', tone: 'neutral' }, OK: { label: 'Reviewed — OK', tone: 'good' }, ACTION_REQUIRED: { label: 'Action needed', tone: 'bad' } } as const;

export function HygieneItem({ h, onReview }: { h: HygieneRow; onReview?: () => void }) {
  const [open, setOpen] = React.useState(false);
  const bad = h.answers.filter((a) => !a.ok).length;
  return (
    <Pressable onPress={() => setOpen((o) => !o)} className={`gap-2 rounded-2xl border bg-surface p-3 ${h.flagged ? 'border-danger' : 'border-line'}`}>
      <Text className="font-bold text-ink">{HYGIENE_KIND_LABEL[h.kind]}</Text>
      <Text className="text-xs text-muted">{h.storeName ?? h.storeId} · {fmtTime(h.submittedMs)} · {h.submittedByName ?? 'staff'}{h.temperatureC !== null ? ` · ${h.temperatureC}°C` : ''}</Text>
      <View className="flex-row flex-wrap gap-1">
        <Badge label={h.flagged ? (bad ? `${bad} problem(s)` : 'Temperature out of range') : 'All OK'} tone={h.flagged ? 'bad' : 'good'} />
        <Badge label={STATUS[h.reviewStatus].label} tone={STATUS[h.reviewStatus].tone} />
      </View>
      {h.reviewNote ? <Text className="text-sm font-semibold text-danger">Compliance: {h.reviewNote}</Text> : null}
      {open
        ? h.answers.map((a) => (
            <Text key={a.question} className="text-sm text-ink">
              <Text className={a.ok ? 'text-leaf' : 'text-danger'}>{a.ok ? '✓ ' : '✗ '}</Text>
              {a.question}
              {a.note ? <Text className="text-muted">{`\n   ${a.note}`}</Text> : null}
            </Text>
          ))
        : null}
      {onReview && h.reviewStatus === 'PENDING' ? <Button variant={h.flagged ? 'kum' : 'outline'} title="Review" onPress={onReview} /> : null}
    </Pressable>
  );
}

export function HygieneEmpty() {
  return <Empty title="No checklists yet" sub="Submitted checklists appear here." />;
}
