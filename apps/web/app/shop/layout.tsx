'use client';
import * as React from 'react';
import Link from 'next/link';
import { ChevronDown, MapPin, MessageCircleQuestion, Package, ShoppingBag, User } from 'lucide-react';
import { ChatWidget } from '@/components/ChatWidget';
import { ShopNav, ShopProvider, deliveryText, useShop } from '@/components/shop';
import { cn } from '@/lib/utils';

function Header() {
  const shop = useShop();
  const d = deliveryText(shop.check, shop.checking);
  const where = shop.address ? `${shop.address.label} · ${shop.address.line1}` : shop.check?.storeName ? `Pincode ${shop.pincode}` : `Pincode ${shop.pincode}`;
  return (
    <header className="glass sticky top-0 z-30 border-b border-line">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <button onClick={shop.openLocation} className="flex min-w-0 items-center gap-2 text-left" aria-label="Change delivery location">
          <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', d.tone === 'good' ? 'bg-leaf/15 text-leaf' : d.tone === 'bad' ? 'bg-danger/10 text-danger' : 'bg-surface-2 text-muted')}>
            <MapPin className="size-5" />
          </span>
          <span className="min-w-0">
            <span className={cn('block text-[15px] font-extrabold leading-tight', d.tone === 'bad' && 'text-danger')}>{d.title}</span>
            <span className="flex items-center gap-0.5 truncate text-[12px] text-muted">
              <span className="truncate">{where}</span> <ChevronDown className="size-3 shrink-0" />
            </span>
          </span>
        </button>
        <button onClick={() => window.dispatchEvent(new Event('px-help-toggle'))} className="grid size-10 shrink-0 place-items-center rounded-xl bg-kum text-kum-ink sm:hidden" aria-label="Help">
          <MessageCircleQuestion className="size-5" />
        </button>
        <Link href="/" className="hidden font-brand text-2xl text-kum md:block">
          Pansari Express
        </Link>
        <nav className="hidden items-center gap-1 sm:flex" aria-label="Account">
          <Link href="/shop/orders" className="flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold hover:bg-surface-2">
            <Package className="size-4" /> Orders
          </Link>
          <Link href="/shop/account" className="flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold hover:bg-surface-2">
            <User className="size-4" /> {shop.isCustomer ? 'Account' : 'Sign in'}
          </Link>
          <Link href="/shop/cart" className="flex h-10 items-center gap-1.5 rounded-xl bg-leaf px-3.5 text-sm font-bold text-white">
            <ShoppingBag className="size-4" /> {shop.count ? `${shop.count} item${shop.count === 1 ? '' : 's'}` : 'Cart'}
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Help() {
  const shop = useShop();
  return <ChatWidget role={shop.user?.role ?? 'anonymous'} storeId={shop.storeId} lift />;
}

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <ShopProvider>
      <Header />
      <div className="pb-24 sm:pb-10">{children}</div>
      <ShopNav />
      <Help />
    </ShopProvider>
  );
}
