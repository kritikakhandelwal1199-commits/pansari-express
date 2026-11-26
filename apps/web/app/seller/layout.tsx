'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BadgeCheck, BookText, Bike, Boxes, FileText, LayoutGrid, LifeBuoy, LogOut, Map as MapIcon, Package, PackageCheck, QrCode, ScanBarcode, Users } from 'lucide-react';
import { ChatWidget } from '@/components/ChatWidget';
import { Brand, RequireStaff, useSelectedStore } from '@/components/common';
import { Button, Select } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { AppUser } from '@/lib/data/types';
import { SellerContext, type SellerCtx } from '@/components/seller';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/seller', label: 'Dashboard', icon: LayoutGrid, roles: ['seller', 'staff', 'super_admin'] },
  { href: '/seller/orders', label: 'Online orders', icon: Bike, roles: ['seller', 'staff'] },
  { href: '/seller/map', label: 'Delivery map', icon: MapIcon, roles: ['seller', 'staff'] },
  { href: '/seller/riders', label: 'Riders & cash', icon: Users, roles: ['seller', 'staff'] },
  { href: '/seller/products', label: 'Products', icon: Package, roles: ['seller', 'super_admin'] },
  { href: '/seller/inventory', label: 'Stock', icon: Boxes, roles: ['seller', 'staff'] },
  { href: '/seller/ledger', label: 'Stock ledger', icon: BookText, roles: ['seller', 'staff'] },
  { href: '/seller/invoices', label: 'Invoices & GST', icon: FileText, roles: ['seller', 'staff'] },
  { href: '/seller/qr', label: 'Store QR', icon: QrCode, roles: ['seller'] },
  { href: '/seller/kyc', label: 'Business KYC', icon: BadgeCheck, roles: ['seller'] },
  { href: '/seller/support', label: 'Help requests', icon: LifeBuoy, roles: ['seller', 'staff', 'super_admin'] },
];

function Shell({ user, children }: { user: AppUser; children: React.ReactNode }) {
  const data = useData();
  const path = usePathname();
  const stores = useResource(() => data.listStores(), [data, user.uid]);
  const ids = React.useMemo(() => (stores.data ?? []).map((s) => s.storeId), [stores.data]);
  const [storeId, setStoreId] = useSelectedStore(ids);
  const nav = NAV.filter((n) => n.roles.includes(user.role));
  const value: SellerCtx = { user, stores: stores.data ?? [], storeId, store: stores.data?.find((s) => s.storeId === storeId), setStoreId, isOwner: user.role === 'seller' };

  return (
    <SellerContext.Provider value={value}>
      <div className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="no-print glass sticky top-0 z-30 border-b border-line px-4 py-3 lg:h-dvh lg:border-b-0 lg:border-r lg:py-6">
          <div className="flex items-center justify-between gap-3 lg:block">
            <Brand sub="Seller portal" />
            <div className="flex items-center gap-2 lg:mt-6 lg:grid">
              {value.stores.length > 1 ? (
                <Select aria-label="Store" value={storeId} onChange={(e) => setStoreId(e.target.value)} className="h-10 w-auto max-w-[180px] text-sm lg:w-full lg:max-w-none">
                  {value.stores.map((s) => (
                    <option key={s.storeId} value={s.storeId}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              ) : value.store ? (
                <span className="text-sm font-semibold">{value.store.name}</span>
              ) : null}
            </div>
          </div>
          <nav className="-mx-1 mt-3 flex gap-1 overflow-x-auto lg:mx-0 lg:mt-6 lg:grid" aria-label="Seller sections">
            {nav.map((n) => {
              const on = n.href === '/seller' ? path === '/seller' : path?.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} className={cn('flex h-10 shrink-0 items-center gap-2.5 rounded-xl px-3 text-[14px] font-semibold', on ? 'bg-kum text-kum-ink' : 'text-muted hover:bg-surface-2 hover:text-ink')}>
                  <n.icon className="size-4" />
                  {n.label}
                </Link>
              );
            })}
            {user.role !== 'super_admin' ? (
              <Link href="/staff" className="flex h-10 shrink-0 items-center gap-2.5 rounded-xl px-3 text-[14px] font-semibold text-muted hover:bg-surface-2 hover:text-ink lg:mt-3">
                <PackageCheck className="size-4" /> Staff app (pick, count)
              </Link>
            ) : null}
            {user.role !== 'super_admin' ? (
              <Link href="/pos" className="flex h-10 shrink-0 items-center gap-2.5 rounded-xl bg-haldi px-3 text-[14px] font-bold text-[#3a1d05] lg:mt-3">
                <ScanBarcode className="size-4" /> Open POS counter
              </Link>
            ) : null}
          </nav>
          <div className="mt-6 hidden border-t border-line pt-4 text-sm lg:block">
            <div className="font-semibold">{user.displayName ?? user.phone}</div>
            <div className="text-muted capitalize">{user.role.replace('_', ' ')}</div>
            <Button variant="ghost" size="sm" className="mt-2 -ml-3" onClick={() => data.signOut()}>
              <LogOut className="size-4" /> Sign out
            </Button>
          </div>
        </aside>
        <main className="min-w-0 px-4 pb-16 pt-6 sm:px-6 lg:px-8">{children}</main>
      </div>
      <ChatWidget role={user.role} storeId={storeId} />
    </SellerContext.Provider>
  );
}

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  return <RequireStaff roles={['seller', 'staff', 'super_admin']}>{(u) => <Shell user={u}>{children}</Shell>}</RequireStaff>;
}

