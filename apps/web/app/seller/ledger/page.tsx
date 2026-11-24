'use client';
import * as React from 'react';
import { Search } from 'lucide-react';
import { ErrorNote } from '@/components/common';
import { PageHead, useSeller } from '@/components/seller';
import { Badge, EmptyState, Input, Select, Skeleton, Table, Td, Th } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import { fmtTime } from '@/lib/utils';
import { MOVEMENT_LABEL } from '@/lib/labels';


export default function LedgerPage() {
  const data = useData();
  const { storeId, store } = useSeller();
  const rows = useResource(() => (storeId ? data.listLedger(storeId, 500) : Promise.resolve([])), [data, storeId]);
  const [q, setQ] = React.useState('');
  const [mv, setMv] = React.useState('');
  const list = (rows.data ?? []).filter((r) => (!mv || r.movement === mv) && (!q || `${r.productName} ${r.refId} ${r.reason ?? ''}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <>
      <PageHead title="Stock ledger" sub={`${store?.name ?? ''} · every unit in or out, with the balance after it. Entries cannot be edited or deleted.`} />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted" />
          <Input className="pl-9" placeholder="Item, bill number or reason" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search ledger" />
        </div>
        <Select className="w-auto" value={mv} onChange={(e) => setMv(e.target.value)} aria-label="Movement">
          <option value="">All movements</option>
          {Object.entries(MOVEMENT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
      </div>
      {rows.loading ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : rows.error ? (
        <ErrorNote>{rows.error}</ErrorNote>
      ) : !list.length ? (
        <EmptyState title="No stock movements yet">Receive stock or make a sale to see entries here.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Item</Th>
              <Th>Movement</Th>
              <Th className="text-right">Qty</Th>
              <Th className="text-right">Balance</Th>
              <Th>Reference</Th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <Td className="num text-muted">{fmtTime(r.atMs)}</Td>
                <Td className="font-semibold">{r.productName}</Td>
                <Td>
                  <Badge tone={MOVEMENT_LABEL[r.movement].tone}>{MOVEMENT_LABEL[r.movement].label}</Badge>
                </Td>
                <Td className={`num text-right font-bold ${r.qtyDelta < 0 ? 'text-danger' : 'text-leaf'}`}>{r.qtyDelta > 0 ? `+${r.qtyDelta}` : r.qtyDelta}</Td>
                <Td className="num text-right">{r.balanceAfter}</Td>
                <Td className="text-[13px]">
                  <span className="num">{r.refType === 'ORDER' ? `Order ${r.refId.slice(-6)}` : r.refId}</span>
                  {r.reason ? <div className="text-muted">{r.reason}</div> : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
