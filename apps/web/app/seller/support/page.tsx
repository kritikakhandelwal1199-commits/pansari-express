'use client';
import * as React from 'react';
import { ErrorNote, useToast } from '@/components/common';
import { PageHead } from '@/components/seller';
import { Badge, Card, EmptyState, Select, Skeleton } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { TicketRow } from '@/lib/data/types';
import { errMsg, fmtTime } from '@/lib/utils';

const CAT: Record<TicketRow['category'], string> = { ORDER: 'Order', PAYMENT: 'Payment', INVOICE: 'Invoice', DAMAGED_ITEM: 'Damaged item', STOCK: 'Stock', KYC: 'KYC', OTHER: 'Other' };

export default function SupportPage() {
  const data = useData();
  const toast = useToast();
  const tickets = useResource(() => data.listSupportTickets(), [data]);

  async function setStatus(t: TicketRow, status: TicketRow['status']) {
    try {
      await data.setTicketStatus?.(t.id, status);
      tickets.reload();
    } catch (e) {
      toast({ tone: 'bad', text: errMsg(e) });
    }
  }

  return (
    <>
      <PageHead title="Help requests" sub="Raised by customers and staff from the help chat. Call the customer, fix it, then mark it resolved." />
      {tickets.loading && !tickets.data ? <Skeleton className="h-32 rounded-2xl" /> : null}
      {tickets.error ? <ErrorNote>{tickets.error}</ErrorNote> : null}
      {tickets.data?.length === 0 ? <EmptyState title="No help requests">When the chatbot cannot answer, the request lands here.</EmptyState> : null}
      <div className="grid gap-3">
        {tickets.data?.map((t) => (
          <Card key={t.id} className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={t.priority === 'HIGH' || t.priority === 'URGENT' ? 'bad' : 'neutral'}>{CAT[t.category]}</Badge>
                <span className="font-bold">{t.subject}</span>
              </div>
              <Select aria-label="Status" value={t.status} onChange={(e) => setStatus(t, e.target.value as TicketRow['status'])} className="h-9 w-auto text-sm">
                {['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ').toLowerCase()}
                  </option>
                ))}
              </Select>
            </div>
            <div className="num text-[13px] text-muted">
              {fmtTime(t.createdMs)} · {t.creatorRole.replace('_', ' ')}
              {t.orderId ? ` · order ${t.orderId}` : ''}
              {t.storeId ? ` · store ${t.storeId}` : ''}
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-kum">Chat transcript ({t.transcript.length})</summary>
              <ul className="mt-2 grid gap-1">
                {t.transcript.map((m, i) => (
                  <li key={i} className={m.from === 'user' ? 'font-semibold' : 'text-muted'}>
                    {m.from === 'user' ? 'Customer' : 'Bot'}: {m.text}
                  </li>
                ))}
              </ul>
            </details>
          </Card>
        ))}
      </div>
    </>
  );
}
