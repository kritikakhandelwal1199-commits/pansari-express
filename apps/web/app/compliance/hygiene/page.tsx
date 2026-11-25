'use client';
import * as React from 'react';
import { missingDailyChecks } from '@pansari/shared';
import { ErrorNote, useToast } from '@/components/common';
import { HygieneList } from '@/components/phase4';
import { PageHead } from '@/components/seller';
import { Button, Dialog, DialogContent, Field, Input, Skeleton } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { HygieneRow } from '@/lib/data/types';
import { errMsg } from '@/lib/utils';

export default function ComplianceHygiene() {
  const data = useData();
  const toast = useToast();
  const [flagged, setFlagged] = React.useState(true);
  const rows = useResource(() => data.listHygieneChecks({ days: 30, flaggedOnly: flagged }), [data, flagged]);
  const today = useResource(() => Promise.all([data.listStores(), data.listHygieneChecks({ days: 2 })]), [data]);
  const [sel, setSel] = React.useState<HygieneRow | null>(null);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const missing = today.data ? missingDailyChecks(today.data[0].map((s) => s.storeId), today.data[1], Date.now()) : [];
  const name = (id: string) => today.data?.[0].find((s) => s.storeId === id)?.name ?? id;

  async function review(status: 'OK' | 'ACTION_REQUIRED') {
    if (!sel) return;
    setBusy(true);
    setErr(null);
    try {
      await data.reviewHygieneCheck(sel.id, status, note || undefined);
      toast({ tone: 'good', text: status === 'OK' ? 'Marked OK' : 'Store asked to fix it' });
      setSel(null);
      rows.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHead title="Hygiene checks" sub="Daily store checklists, cool-storage temperatures, pest control and expiry sweeps. Flagged ones need a look." />
      {today.data ? (
        missing.length ? (
          <p className="mb-3 rounded-xl bg-haldi/20 p-3 text-sm font-semibold">No daily check yet today: {missing.map(name).join(', ')}</p>
        ) : (
          <p className="mb-3 text-sm font-semibold text-leaf">Every store has done today’s daily check.</p>
        )
      ) : null}
      <div className="mb-3 flex gap-2">
        <Button size="sm" variant={flagged ? 'default' : 'outline'} onClick={() => setFlagged(true)}>
          Flagged
        </Button>
        <Button size="sm" variant={!flagged ? 'default' : 'outline'} onClick={() => setFlagged(false)}>
          All (30 days)
        </Button>
      </div>
      {rows.error ? <ErrorNote>{rows.error}</ErrorNote> : null}
      {rows.loading && !rows.data ? <Skeleton className="h-32 rounded-2xl" /> : <HygieneList rows={rows.data ?? []} onReview={(h) => (setErr(null), setNote(''), setSel(h))} />}
      <Dialog open={!!sel} onOpenChange={(v) => !v && setSel(null)}>
        <DialogContent title="Review checklist" description={sel ? `${sel.storeName ?? sel.storeId} · ${new Date(sel.submittedMs).toLocaleString('en-IN')}` : undefined}>
          <Field label="Note to the store (required if action is needed)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Move kesar to the cool shelf; service the fridge" />
          </Field>
          {err ? <ErrorNote>{err}</ErrorNote> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="leaf" disabled={busy} onClick={() => review('OK')}>
              Mark OK
            </Button>
            <Button variant="destructive" disabled={busy || note.trim().length < 3} onClick={() => review('ACTION_REQUIRED')}>
              Needs action
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
