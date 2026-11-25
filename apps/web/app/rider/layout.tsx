'use client';
import { Bike, IdCard, Wallet } from 'lucide-react';
import { ChatWidget } from '@/components/ChatWidget';
import { RequireStaff } from '@/components/common';
import { PortalShell } from '@/components/portal';

const NAV = [
  { href: '/rider', label: 'Deliveries', icon: Bike, exact: true },
  { href: '/rider/cash', label: 'Cash', icon: Wallet },
  { href: '/rider/kyc', label: 'Documents', icon: IdCard },
];

export default function RiderLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireStaff roles={['rider']}>
      {(u) => (
        <PortalShell narrow user={u} sub="Rider app" nav={NAV} footer={<ChatWidget role={u.role} />}>
          {children}
        </PortalShell>
      )}
    </RequireStaff>
  );
}
