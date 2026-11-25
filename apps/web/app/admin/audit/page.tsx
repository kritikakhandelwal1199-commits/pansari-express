'use client';
import { AuditTable } from '@/components/phase4';
import { PageHead } from '@/components/seller';

export default function AdminAudit() {
  return (
    <>
      <PageHead title="Audit log" sub="Every role change, zone and tax edit, listing decision, KYC review, recall, dispatch and cash hand-in. Tap a row to see what changed." />
      <AuditTable />
    </>
  );
}
