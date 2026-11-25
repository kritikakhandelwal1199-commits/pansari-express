'use client';
import { AuditTable } from '@/components/phase4';
import { PageHead } from '@/components/seller';

export default function ComplianceAudit() {
  return (
    <>
      <PageHead title="Audit log" sub="Read-only record of every sensitive change." />
      <AuditTable />
    </>
  );
}
