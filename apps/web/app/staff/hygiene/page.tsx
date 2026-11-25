'use client';
import { HygieneForm, HygieneList } from '@/components/phase4';
import { useStaffApp } from '@/components/staff';
import { Skeleton } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';

export default function HygienePage() {
  const { storeId, store } = useStaffApp();
  const data = useData();
  const list = useResource(() => data.listHygieneChecks({ storeId, days: 14 }), [data, storeId]);
  return (
    <div className="grid gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Hygiene checks</h1>
        <p className="text-sm text-muted">{store?.name} · do the daily check every morning; the compliance team sees every answer</p>
      </div>
      <HygieneForm storeId={storeId} onSaved={list.reload} />
      <h2 className="mt-2 text-lg font-bold">Last 14 days</h2>
      {list.loading && !list.data ? <Skeleton className="h-24 rounded-2xl" /> : <HygieneList rows={list.data ?? []} />}
    </div>
  );
}
