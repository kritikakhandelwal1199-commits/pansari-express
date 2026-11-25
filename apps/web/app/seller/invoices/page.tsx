'use client';
import * as React from 'react';
import { Download, FileText, Printer } from 'lucide-react';
import { stateName, summarizeGstr1, type Gstr1Summary } from '@pansari/shared';
import { ErrorNote, useToast } from '@/components/common';
import { PageHead, useSeller } from '@/components/seller';
import { Badge, Button, Card, CardTitle, EmptyState, Segmented, Skeleton, Stat, Table, Td, Th } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import { PAYMENT_LABEL } from '@/lib/labels';
import { downloadBlob, errMsg, fmtTime, openPdf, rs } from '@/lib/utils';

type Period = 'today' | 'month' | 'last' | 'fy';
const IST = 330 * 60_000;
/** B2CL threshold (inter-state B2C invoice value). Confirm the current notified value with your CA. */
const B2CL_THRESHOLD = 1_00_000_00;

function range(p: Period): { from: number; to: number; label: string } {
  const now = new Date(Date.now() + IST);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const utc = (yy: number, mm: number, dd = 1) => Date.UTC(yy, mm, dd) - IST;
  if (p === 'today') return { from: utc(y, m, now.getUTCDate()), to: Date.now() + 60_000, label: 'Today' };
  if (p === 'month') return { from: utc(y, m), to: Date.now() + 60_000, label: now.toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
  if (p === 'last') {
    const d = new Date(Date.UTC(y, m - 1, 1));
    return { from: utc(d.getUTCFullYear(), d.getUTCMonth()), to: utc(y, m) - 1, label: d.toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
  }
  const fyStart = m >= 3 ? y : y - 1;
  return { from: utc(fyStart, 3), to: Date.now() + 60_000, label: `FY ${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}` };
}

const r2 = (p: number) => (p / 100).toFixed(2);

function hsnCsv(s: Gstr1Summary) {
  const head = 'Table,HSN,Rate %,Quantity,Total value,Taxable value,IGST,CGST,SGST,Cess';
  const rows = [
    ...s.hsnB2B.map((h) => ['B2B', h.hsnCode, h.rate, h.qty, r2(h.totalValue), r2(h.taxable), r2(h.igst), r2(h.cgst), r2(h.sgst), r2(h.cess)].join(',')),
    ...s.hsnB2C.map((h) => ['B2C', h.hsnCode, h.rate, h.qty, r2(h.totalValue), r2(h.taxable), r2(h.igst), r2(h.cgst), r2(h.sgst), r2(h.cess)].join(',')),
  ];
  return [head, ...rows].join('\n');
}

export default function InvoicesPage() {
  const data = useData();
  const toast = useToast();
  const { stores } = useSeller();
  const [period, setPeriod] = React.useState<Period>('month');
  const [tab, setTab] = React.useState<'bills' | 'gstr1'>('bills');
  const r = range(period);
  const invoices = useResource(() => data.listInvoices({ fromMs: r.from, toMs: r.to }), [data, period]);
  const list = invoices.data ?? [];
  const summary = React.useMemo(
    () => summarizeGstr1(list.map((i) => ({ invoiceNo: i.invoiceNo, issuedMs: i.issuedMs, kind: i.kind, buyerGstin: i.buyer.gstin, placeOfSupplyStateCode: i.buyer.placeOfSupplyStateCode, computation: i.computation })), { fromMs: r.from, toMs: r.to, b2clThreshold: B2CL_THRESHOLD }),
    [list, r.from, r.to],
  );
  const storeName = (id: string) => stores.find((s) => s.storeId === id)?.name ?? id;

  async function pdf(id: string, no: string, format: 'A4' | 'THERMAL_80MM') {
    try {
      openPdf(await data.invoicePdf(id, format), `${no.replace(/\//g, '-')}-${format === 'A4' ? 'a4' : '80mm'}.pdf`);
    } catch (e) {
      toast({ tone: 'bad', text: errMsg(e) });
    }
  }

  return (
    <>
      <PageHead
        title="Invoices & GST"
        sub={`${r.label} · invoice numbers run continuously across all stores for the financial year`}
        actions={<Segmented value={period} onChange={setPeriod} options={[{ value: 'today', label: 'Today' }, { value: 'month', label: 'This month' }, { value: 'last', label: 'Last month' }, { value: 'fy', label: 'This FY' }]} />}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat tone="brand" label="Invoice value" value={rs(summary.totals.invoiceValue)} sub={`${summary.totals.invoices} invoices`} />
        <Stat label="Taxable value" value={rs(summary.totals.taxable)} />
        <Stat label="CGST" value={rs(summary.totals.cgst)} />
        <Stat label="SGST" value={rs(summary.totals.sgst)} />
        <Stat label="IGST" value={rs(summary.totals.igst)} />
      </div>
      <div className="mb-4 mt-6 flex flex-wrap items-center justify-between gap-2">
        <Segmented value={tab} onChange={setTab} options={[{ value: 'bills', label: 'Bills' }, { value: 'gstr1', label: 'GSTR-1 summary' }]} />
        {tab === 'gstr1' ? (
          <Button variant="outline" onClick={() => downloadBlob(new Blob([hsnCsv(summary)], { type: 'text/csv' }), `HSN-summary-${r.label.replace(/\s/g, '-')}.csv`)}>
            <Download className="size-4" /> HSN summary (CSV)
          </Button>
        ) : null}
      </div>

      {invoices.loading ? <Skeleton className="h-72 rounded-2xl" /> : invoices.error ? <ErrorNote>{invoices.error}</ErrorNote> : null}

      {!invoices.loading && !invoices.error && tab === 'bills' ? (
        list.length === 0 ? (
          <EmptyState title="No invoices in this period" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Customer</Th>
                <Th>Store · payment</Th>
                <Th className="text-right">Taxable</Th>
                <Th className="text-right">GST</Th>
                <Th className="text-right">Total</Th>
                <Th className="w-0" />
              </tr>
            </thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.invoiceId}>
                  <Td>
                    <div className="num font-semibold">{i.invoiceNo}</div>
                    <div className="num text-[12px] text-muted">{fmtTime(i.issuedMs)}</div>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      {i.kind === 'B2B' ? <Badge tone="brand">B2B</Badge> : <Badge>B2C</Badge>}
                      <span className="truncate">{i.buyer.name ?? 'Walk-in'}</span>
                    </div>
                    {i.buyer.gstin ? <div className="num text-[12px] text-muted">{i.buyer.gstin}</div> : null}
                    {i.irn ? <div className="num text-[11px] text-muted">IRN {i.irn.slice(0, 10)}… (test)</div> : null}
                  </Td>
                  <Td className="text-[13px]">
                    {storeName(i.storeId)}
                    <div className="text-muted">{PAYMENT_LABEL[i.paymentMethod]}</div>
                  </Td>
                  <Td className="num text-right">{rs(i.computation.totals.taxable)}</Td>
                  <Td className="num text-right">{rs(i.computation.totals.totalTax)}</Td>
                  <Td className="num text-right font-bold">{rs(i.grandTotal)}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => pdf(i.invoiceId, i.invoiceNo, 'A4')} aria-label="A4 invoice PDF">
                        <FileText className="size-4" /> A4
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => pdf(i.invoiceId, i.invoiceNo, 'THERMAL_80MM')} aria-label="Thermal receipt PDF">
                        <Printer className="size-4" /> 80mm
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      ) : null}

      {!invoices.loading && !invoices.error && tab === 'gstr1' ? <Gstr1View s={summary} /> : null}
    </>
  );
}

function Gstr1View({ s }: { s: Gstr1Summary }) {
  const money = (p: number) => <span className="num">{rs(p)}</span>;
  return (
    <div className="grid gap-4">
      <Card>
        <CardTitle>Documents issued (Table 13)</CardTitle>
        <p className="mt-2 text-[15px]">
          {s.documents.issued ? (
            <>
              Invoices <b className="num">{s.documents.from}</b> to <b className="num">{s.documents.to}</b> · {s.documents.issued} issued · {s.documents.cancelled} cancelled
            </>
          ) : (
            'No invoices in this period.'
          )}
        </p>
      </Card>
      <Card>
        <CardTitle>B2B invoices (Table 4A) · {s.b2b.length}</CardTitle>
        {s.b2b.length ? (
          <div className="mt-3">
            <Table>
              <thead>
                <tr>
                  <Th>Buyer GSTIN</Th>
                  <Th>Invoice</Th>
                  <Th>Place of supply</Th>
                  <Th className="text-right">Value</Th>
                  <Th>Rates</Th>
                </tr>
              </thead>
              <tbody>
                {s.b2b.map((b) => (
                  <tr key={b.invoiceNo}>
                    <Td className="num">{b.gstin}</Td>
                    <Td className="num">{b.invoiceNo}</Td>
                    <Td>{stateName(b.pos)}</Td>
                    <Td className="text-right">{money(b.invoiceValue)}</Td>
                    <Td className="text-[13px]">{b.rates.map((x) => `${x.rate}% on ${rs(x.taxable)}`).join(' · ')}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">No sales to registered buyers.</p>
        )}
      </Card>
      {s.b2cl.length ? (
        <Card>
          <CardTitle>B2C large inter-state (Table 5) · {s.b2cl.length}</CardTitle>
          <p className="mt-1 text-sm text-muted">Inter-state B2C invoices above the notified value — confirm the threshold with your CA.</p>
        </Card>
      ) : null}
      <Card>
        <CardTitle>B2C others (Table 7)</CardTitle>
        <div className="mt-3">
          <Table>
            <thead>
              <tr>
                <Th>Place of supply</Th>
                <Th>Type</Th>
                <Th className="text-right">Rate</Th>
                <Th className="text-right">Taxable</Th>
                <Th className="text-right">CGST</Th>
                <Th className="text-right">SGST</Th>
                <Th className="text-right">IGST</Th>
              </tr>
            </thead>
            <tbody>
              {s.b2cs.map((x) => (
                <tr key={`${x.pos}-${x.rate}-${x.supplyType}`}>
                  <Td>{stateName(x.pos)}</Td>
                  <Td>{x.supplyType === 'INTRA_STATE' ? 'Intra-state' : 'Inter-state'}</Td>
                  <Td className="num text-right">{x.rate}%</Td>
                  <Td className="text-right">{money(x.taxable)}</Td>
                  <Td className="text-right">{money(x.cgst)}</Td>
                  <Td className="text-right">{money(x.sgst)}</Td>
                  <Td className="text-right">{money(x.igst)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
      {(['hsnB2C', 'hsnB2B'] as const).map((k) => (
        <Card key={k}>
          <CardTitle>HSN summary — {k === 'hsnB2C' ? 'B2C' : 'B2B'} (Table 12)</CardTitle>
          {s[k].length ? (
            <div className="mt-3">
              <Table>
                <thead>
                  <tr>
                    <Th>HSN</Th>
                    <Th className="text-right">Rate</Th>
                    <Th className="text-right">Qty</Th>
                    <Th className="text-right">Value</Th>
                    <Th className="text-right">Taxable</Th>
                    <Th className="text-right">CGST</Th>
                    <Th className="text-right">SGST</Th>
                    <Th className="text-right">IGST</Th>
                  </tr>
                </thead>
                <tbody>
                  {s[k].map((h) => (
                    <tr key={`${h.hsnCode}-${h.rate}`}>
                      <Td className="num">{h.hsnCode}</Td>
                      <Td className="num text-right">{h.rate}%</Td>
                      <Td className="num text-right">{h.qty}</Td>
                      <Td className="text-right">{money(h.totalValue)}</Td>
                      <Td className="text-right">{money(h.taxable)}</Td>
                      <Td className="text-right">{money(h.cgst)}</Td>
                      <Td className="text-right">{money(h.sgst)}</Td>
                      <Td className="text-right">{money(h.igst)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">Nothing in this table for the period.</p>
          )}
        </Card>
      ))}
      <p className="text-[13px] text-muted">Figures are prepared from issued invoices for your accountant. Filing itself happens on the GST portal; check HSN rates and thresholds with your CA.</p>
    </div>
  );
}
