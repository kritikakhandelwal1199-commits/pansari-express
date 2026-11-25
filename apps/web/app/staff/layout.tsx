'use client';
import * as React from 'react';
import { ClipboardCheck, PackageCheck, PackagePlus, ScanBarcode, SprayCan } from 'lucide-react';
import { RequireStaff, useSelectedStore } from '@/components/common';
import { PortalShell } from '@/components/portal';
import { StaffContext } from '@/components/staff';
import { useData, useResource } from '@/lib/data/provider';
import type { AppUser } from '@/lib/data/types';

const NAV = [
  { href: '/staff', label: 'Pick', icon: PackageCheck, exact: true },
  { href: '/staff/receive', label: 'Receive', icon: PackagePlus },
  { href: '/staff/count', label: 'Count', icon: ClipboardCheck },
  { href: '/staff/hygiene', label: 'Hygiene', icon: SprayCan },
  { href: '/pos', label: 'POS', icon: ScanBarcode },
];

function Shell({ user, children }: { user: AppUser; children: React.ReactNode }) {
  const data = useData();
  const stores = useResource(() => data.listStores(), [data, user.uid]);
  const ids = React.useMemo(() => (stores.data ?? []).map((s) => s.storeId), [stores.data]);
  const [storeId, setStoreId] = useSelectedStore(ids);
  const list = stores.data ?? [];
  return (
    <StaffContext.Provider value={{ user, stores: list, storeId, store: list.find((s) => s.storeId === storeId) }}>
      <PortalShell narrow user={user} sub="Staff app" nav={NAV} stores={list} storeId={storeId} setStoreId={setStoreId}>
        {storeId ? children : null}
      </PortalShell>
    </StaffContext.Provider>
  );
}

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <RequireStaff roles={['staff', 'seller']}>{(u) => <Shell user={u}>{children}</Shell>}</RequireStaff>;
}
