'use client';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PageHead } from '@/components/seller';
import { ROLE_LABEL } from '@/components/phase4';
import { Card, CardTitle, Skeleton, Stat } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import { fmtTime } from '@/lib/utils';

export default function AdminHome() {
  const data = useData();
  const all = useResource(
    () =>
      Promise.all([data.listUsers(), data.listZones(), data.listAllProducts(), data.listKycDocs({ status: 'PENDING' }), data.listAudit({ max: 8 })]).then(([users, zones, products, kyc, audit]) => ({ users, zones, products, kyc, audit })),
    [data],
  );
  const d = all.data;
  const byRole = d ? Object.entries(d.users.reduce<Record<string, number>>((a, u) => ((a[u.role] = (a[u.role] ?? 0) + 1), a), {})) : [];

  return (
    <>
      <PageHead title="Overview" sub="Who can do what, where you deliver, and how every product is taxed." />
      {all.error ? <p className="text-danger">{all.error}</p> : null}
      {!d ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="People with a role" value={d.users.filter((u) => u.role !== 'customer').length} sub={`${d.users.filter((u) => u.role === 'customer').length} customers`} />
            <Stat label="Delivery zones" value={d.zones.filter((z) => z.isActive).length} sub={`${d.zones.length - d.zones.filter((z) => z.isActive).length} paused`} />
            <Stat label="Listings waiting" value={d.products.filter((p) => p.complianceStatus === 'PENDING_REVIEW').length} sub="to approve" tone="brand" />
            <Stat label="KYC documents waiting" value={d.kyc.length} sub="for compliance" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <div className="flex items-center justify-between">
                <CardTitle>Team</CardTitle>
                <Link href="/admin/users" className="inline-flex items-center gap-1 text-sm font-semibold text-kum">
                  Manage <ArrowRight className="size-4" />
                </Link>
              </div>
              <ul className="mt-3 grid gap-1 text-sm">
                {byRole.map(([r, n]) => (
                  <li key={r} className="flex justify-between border-b border-line py-1.5 last:border-0">
                    <span>{ROLE_LABEL[r] ?? r}</span>
                    <span className="num font-bold">{n}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <div className="flex items-center justify-between">
                <CardTitle>Recent changes</CardTitle>
                <Link href="/admin/audit" className="inline-flex items-center gap-1 text-sm font-semibold text-kum">
                  Audit log <ArrowRight className="size-4" />
                </Link>
              </div>
              <ul className="mt-3 grid gap-1 text-sm">
                {d.audit.map((a) => (
                  <li key={a.id} className="flex justify-between gap-3 border-b border-line py-1.5 last:border-0">
                    <span className="font-semibold">{a.action}</span>
                    <span className="num text-muted">{fmtTime(a.atMs)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
