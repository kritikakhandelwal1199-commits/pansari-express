import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { usePathname, navigate } from './router';
import { DemoDataClient } from '@/lib/data/demo';
import { Providers } from '@/app/providers';
import Home from '@/app/page';
import Login from '@/app/login/page';
import SellerLayout from '@/app/seller/layout';
import Dashboard from '@/app/seller/page';
import Products from '@/app/seller/products/page';
import Inventory from '@/app/seller/inventory/page';
import Ledger from '@/app/seller/ledger/page';
import Invoices from '@/app/seller/invoices/page';
import QrPosters from '@/app/seller/qr/page';
import Pos from '@/app/pos/page';
import Store from '@/app/store/page';
import ShopLayout from '@/app/shop/layout';
import ShopHome from '@/app/shop/page';
import ShopCart from '@/app/shop/cart/page';
import ShopOrders from '@/app/shop/orders/page';
import ShopOrder from '@/app/shop/orders/view/page';
import ShopAccount from '@/app/shop/account/page';
import OnlineOrders from '@/app/seller/orders/page';
import Support from '@/app/seller/support/page';
import SellerRiders from '@/app/seller/riders/page';
import SellerKyc from '@/app/seller/kyc/page';
import AdminLayout from '@/app/admin/layout';
import AdminHome from '@/app/admin/page';
import AdminUsers from '@/app/admin/users/page';
import AdminZones from '@/app/admin/zones/page';
import AdminHsn from '@/app/admin/hsn/page';
import AdminReview from '@/app/admin/review/page';
import AdminAudit from '@/app/admin/audit/page';
import ComplianceLayout from '@/app/compliance/layout';
import ComplianceKyc from '@/app/compliance/page';
import ComplianceListings from '@/app/compliance/listings/page';
import ComplianceRecalls from '@/app/compliance/recalls/page';
import ComplianceAudit from '@/app/compliance/audit/page';
import StaffLayout from '@/app/staff/layout';
import StaffQueue from '@/app/staff/page';
import StaffPick from '@/app/staff/pick/page';
import StaffReceive from '@/app/staff/receive/page';
import StaffCount from '@/app/staff/count/page';
import RiderLayout from '@/app/rider/layout';
import RiderHome from '@/app/rider/page';
import RiderCash from '@/app/rider/cash/page';
import RiderKyc from '@/app/rider/kyc/page';

(globalThis as { __PX_PREVIEW__?: boolean }).__PX_PREVIEW__ = true;
const client = new DemoDataClient({ storeUrl: (id, token) => `${location.origin}/store?s=${id}&token=${encodeURIComponent(token)}` });

const SELLER: Record<string, React.ComponentType> = {
  '/seller': Dashboard,
  '/seller/products': Products,
  '/seller/inventory': Inventory,
  '/seller/ledger': Ledger,
  '/seller/invoices': Invoices,
  '/seller/qr': QrPosters,
  '/seller/orders': OnlineOrders,
  '/seller/support': Support,
  '/seller/riders': SellerRiders,
  '/seller/kyc': SellerKyc,
};
type Section = { prefix: string; Layout: React.ComponentType<{ children: React.ReactNode }>; home: React.ComponentType; pages: Record<string, React.ComponentType> };
const PHASE4: Section[] = [
  { prefix: '/admin', Layout: AdminLayout, home: AdminHome, pages: { '/admin/users': AdminUsers, '/admin/zones': AdminZones, '/admin/hsn': AdminHsn, '/admin/review': AdminReview, '/admin/audit': AdminAudit } },
  { prefix: '/compliance', Layout: ComplianceLayout, home: ComplianceKyc, pages: { '/compliance/listings': ComplianceListings, '/compliance/recalls': ComplianceRecalls, '/compliance/audit': ComplianceAudit } },
  { prefix: '/staff', Layout: StaffLayout, home: StaffQueue, pages: { '/staff/pick': StaffPick, '/staff/receive': StaffReceive, '/staff/count': StaffCount } },
  { prefix: '/rider', Layout: RiderLayout, home: RiderHome, pages: { '/rider/cash': RiderCash, '/rider/kyc': RiderKyc } },
];
const SHOP: Record<string, React.ComponentType> = {
  '/shop': ShopHome,
  '/shop/cart': ShopCart,
  '/shop/orders': ShopOrders,
  '/shop/orders/view': ShopOrder,
  '/shop/account': ShopAccount,
};

function Routes() {
  const path = usePathname();
  if (path.startsWith('/seller')) {
    const Page = SELLER[path] ?? Dashboard;
    return (
      <SellerLayout>
        <Page />
      </SellerLayout>
    );
  }
  if (path.startsWith('/shop')) {
    const Page = SHOP[path] ?? ShopHome;
    return (
      <ShopLayout>
        <Page />
      </ShopLayout>
    );
  }
  const sec = PHASE4.find((x) => path === x.prefix || path.startsWith(`${x.prefix}/`));
  if (sec) {
    const Page = sec.pages[path] ?? sec.home;
    return (
      <sec.Layout>
        <Page />
      </sec.Layout>
    );
  }
  if (path === '/login') return <Login />;
  if (path === '/pos') return <Pos />;
  if (path === '/store') return <Store />;
  return <Home />;
}

function PreviewBar() {
  const path = usePathname();
  const go = (p: string) => () => navigate(p);
  const items: [string, string][] = [['/', 'Home'], ['/shop', 'Customer shop'], ['/seller/orders', 'Online orders'], ['/seller', 'Seller portal'], ['/pos', 'POS counter'], ['/seller/qr', 'Store QR → customer'], ['/staff', 'Staff app'], ['/rider', 'Rider app'], ['/compliance', 'Compliance'], ['/admin', 'Super admin']];
  return (
    <nav aria-label="Preview" className="no-print sticky top-0 z-[70] flex flex-wrap items-center gap-1 bg-[#1e120b] px-3 py-1.5 text-[13px] text-[#fff6e6]">
      <span className="mr-2 font-semibold text-[#f2b705]">Phase 4 preview</span>
      {items.map(([p, l]) => (
        <button key={p} onClick={go(p)} className={`rounded-full px-3 py-1 font-semibold ${path === p ? 'bg-[#f2b705] text-[#3a1d05]' : 'hover:bg-white/10'}`}>
          {l}
        </button>
      ))}
      <button
        onClick={() => {
          client.resetDemo();
          location.reload();
        }}
        className="ml-auto rounded-full px-3 py-1 hover:bg-white/10"
      >
        Reset sample data
      </button>
    </nav>
  );
}

createRoot(document.getElementById('root')!).render(
  <>
    <PreviewBar />
    <Providers client={client}>
      <Routes />
    </Providers>
  </>,
);
