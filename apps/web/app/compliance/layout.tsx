'use client';
import { FileCheck2, History, IdCard, Undo2 } from 'lucide-react';
import { RequireStaff } from '@/components/common';
import { PortalShell } from '@/components/portal';

const NAV = [
  { href: '/compliance', label: 'KYC review', icon: IdCard, exact: true },
  { href: '/compliance/listings', label: 'Listing review', icon: FileCheck2 },
  { href: '/compliance/recalls', label: 'Recalls', icon: Undo2 },
  { href: '/compliance/audit', label: 'Audit log', icon: History },
];

export default function ComplianceLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireStaff roles={['compliance', 'super_admin']}>
      {(u) => (
        <PortalShell user={u} sub="Compliance" nav={NAV}>
          {children}
        </PortalShell>
      )}
    </RequireStaff>
  );
}
