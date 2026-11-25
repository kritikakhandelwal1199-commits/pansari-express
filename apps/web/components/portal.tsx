'use client';
/**
 * Shell for the Phase 4 portals (admin, compliance, staff picker, rider).
 * Desktop: left rail. Phone: compact header + horizontally scrolling tabs.
 */
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, type LucideIcon } from 'lucide-react';
import { Brand } from '@/components/common';
import { Button, Select } from '@/components/ui';
import { useData } from '@/lib/data/provider';
import type { AppUser, StoreInfo } from '@/lib/data/types';
import { cn } from '@/lib/utils';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Exact match only (for the section home). */
  exact?: boolean;
  badge?: number | null;
}

export function PortalShell({
  user,
  sub,
  nav,
  children,
  stores,
  storeId,
  setStoreId,
  narrow,
  footer,
}: {
  user: AppUser;
  sub: string;
  nav: NavItem[];
  children: React.ReactNode;
  stores?: StoreInfo[];
  storeId?: string;
  setStoreId?: (id: string) => void;
  /** Phone-first apps (rider, picker): single column, no side rail. */
  narrow?: boolean;
  footer?: React.ReactNode;
}) {
  const data = useData();
  const path = usePathname();
  const isOn = (n: NavItem) => (n.exact ? path === n.href || path === `${n.href}/` : path?.startsWith(n.href));
  const storePicker =
    stores && stores.length > 1 && setStoreId ? (
      <Select aria-label="Store" value={storeId} onChange={(e) => setStoreId(e.target.value)} className="h-10 w-auto max-w-[200px] text-sm">
        {stores.map((s) => (
          <option key={s.storeId} value={s.storeId}>
            {s.name}
          </option>
        ))}
      </Select>
    ) : stores?.length === 1 ? (
      <span className="max-w-[40vw] truncate text-sm font-semibold sm:max-w-none">{stores[0]!.name}</span>
    ) : null;

  const links = nav.map((n) => (
    <Link key={n.href} href={n.href} className={cn('flex h-10 shrink-0 items-center gap-2.5 rounded-xl px-3 text-[14px] font-semibold', isOn(n) ? 'bg-kum text-kum-ink' : 'text-muted hover:bg-surface-2 hover:text-ink')}>
      <n.icon className="size-4" />
      {n.label}
      {n.badge ? <span className={cn('num ml-auto rounded-full px-1.5 text-[11px] font-bold', isOn(n) ? 'bg-white/20' : 'bg-haldi text-[#3a1d05]')}>{n.badge}</span> : null}
    </Link>
  ));

  if (narrow) {
    return (
      <div className="mx-auto min-h-dvh max-w-xl">
        <header className="no-print glass sticky top-0 z-30 border-b border-line px-4 pb-2 pt-3">
          <div className="flex items-center justify-between gap-3">
            <Brand sub={sub} className="shrink-0" />
            <div className="flex min-w-0 items-center gap-2">
              {storePicker}
              <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => data.signOut()}>
                <LogOut className="size-5" />
              </Button>
            </div>
          </div>
          <nav className="-mx-1 mt-2 flex gap-1 overflow-x-auto" aria-label={`${sub} sections`}>
            {links}
          </nav>
        </header>
        <main className="min-w-0 px-4 pb-24 pt-5">{children}</main>
        {footer}
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="no-print glass sticky top-0 z-30 border-b border-line px-4 py-3 lg:h-dvh lg:border-b-0 lg:border-r lg:py-6">
        <div className="flex items-center justify-between gap-3 lg:block">
          <Brand sub={sub} />
          <div className="lg:mt-6">{storePicker}</div>
        </div>
        <nav className="-mx-1 mt-3 flex gap-1 overflow-x-auto lg:mx-0 lg:mt-6 lg:grid" aria-label={`${sub} sections`}>
          {links}
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
      {footer}
    </div>
  );
}
