'use client';
import { FileCheck2, History, LayoutGrid, Map, Percent, Users } from 'lucide-react';
import { RequireStaff } from '@/components/common';
import { PortalShell } from '@/components/portal';

const NAV = [
  { href: '/admin', label: 'Overview', icon: LayoutGrid, exact: true },
  { href: '/admin/users', label: 'People & roles', icon: Users },
  { href: '/admin/zones', label: 'Delivery zones', icon: Map },
  { href: '/admin/hsn', label: 'GST tax master', icon: Percent },
  { href: '/admin/review', label: 'Listing review', icon: FileCheck2 },
  { href: '/admin/audit', label: 'Audit log', icon: History },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireStaff roles={['super_admin']}>
      {(u) => (
        <PortalShell user={u} sub="Super admin" nav={NAV}>
          {children}
        </PortalShell>
      )}
    </RequireStaff>
  );
}
