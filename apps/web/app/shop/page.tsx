'use client';
import * as React from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { Bike, Flower2, Gem, Heart, Home as HomeIcon, Nut, Search, ShoppingBag, TriangleAlert } from 'lucide-react';
import { CATEGORY_LABELS } from '@pansari/shared';
import { QtyButton, useShop } from '@/components/shop';
import { Input, Skeleton } from '@/components/ui';
import { productArtUrl, type InventoryRow } from '@/lib/data/types';
import { cn, rs } from '@/lib/utils';

const CAT_STYLE: Record<string, { icon: React.ComponentType<{ className?: string }>; tile: string }> = {
  preg: { icon: Heart, tile: 'bg-[#fde7ea] text-[#a3122b] dark:bg-[#3a1418] dark:text-[#ff9aa8]' },
  pooja: { icon: Flower2, tile: 'bg-[#fff1cc] text-[#8a5a00] dark:bg-[#3a2a08] dark:text-[#ffd36b]' },
  shaadi: { icon: Gem, tile: 'bg-[#fbe3d3] text-[#9a3b0c] dark:bg-[#3a1d0e] dark:text-[#ffb07a]' },
  dry: { icon: Nut, tile: 'bg-[#efe3d3] text-[#6b4320] dark:bg-[#2f2116] dark:text-[#e2bf96]' },
  home: { icon: HomeIcon, tile: 'bg-[#e3f1df] text-[#2f7a35] dark:bg-[#15291a] dark:text-[#8fd18a]' },
};

function ProductCard({ r }: { r: InventoryRow }) {
  const s = CAT_STYLE[r.product.category] ?? CAT_STYLE.home!;
  const off = r.mrp > r.sellingPrice ? Math.round(((r.mrp - r.sellingPrice) / r.mrp) * 100) : 0;
  const art = productArtUrl(r.productId);
  return (
    <li className="flex flex-col rounded-2xl border border-line bg-surface p-2.5">
      <div className={cn('relative grid aspect-[4/3] place-items-center overflow-hidden rounded-xl', s.tile)}>
        {art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={art} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
        ) : (
          <s.icon className="size-9 opacity-80" />
        )}
        <span className="absolute bottom-1.5 left-1.5 rounded-md bg-white/80 px-1.5 py-0.5 text-[11px] font-bold text-[#23140b]">{r.product.netQuantity}</span>
        {off >= 5 ? <span className="absolute left-1.5 top-1.5 rounded-md bg-[#2f6fd6] px-1.5 py-0.5 text-[11px] font-extrabold text-white">{off}% OFF</span> : null}
      </div>
      <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-muted">
        <Bike className="size-3" /> {r.onHand > 0 ? (r.onHand <= 5 ? `Only ${r.onHand} left` : 'In stock') : 'Out of stock'}
      </div>
      <div className="mt-0.5 line-clamp-2 min-h-[2.6em] text-[14px] font-bold leading-snug">{r.product.name}</div>
      {r.product.nameHi ? (
        <div className="truncate text-[12px] text-muted" lang="hi">
          {r.product.nameHi}
        </div>
      ) : (
        <div className="h-[18px]" />
      )}
      <div className="mt-auto flex items-end justify-between gap-2 pt-2">
        <div className="leading-tight">
          <div className="num text-[15px] font-extrabold">{rs(r.sellingPrice)}</div>
          {off ? <div className="num text-[12px] text-muted line-through">{rs(r.mrp)}</div> : null}
        </div>
        <QtyButton row={r} compact />
      </div>
    </li>
  );
}

export default function ShopPage() {
  const shop = useShop();
  const [q, setQ] = React.useState('');
  const [cat, setCat] = React.useState('');
  const list = shop.catalog.filter((r) => (!cat || r.product.category === cat) && (!q || `${r.product.name} ${r.product.nameHi ?? ''} ${r.product.brand ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const cats = Object.entries(CATEGORY_LABELS).filter(([k]) => shop.catalog.some((r) => r.product.category === k));
  const notServed = shop.check && !shop.check.serviceable;

  return (
    <main className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
      {notServed ? (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="text-sm">
            <div className="font-bold">We don&apos;t deliver to this location yet</div>
            <p className="text-muted">You can still browse. Change the address, or visit a store and scan its QR.</p>
            <button onClick={shop.openLocation} className="mt-1 font-bold text-kum underline">
              Change location
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-4 grid gap-3 rounded-3xl bg-kum p-4 text-kum-ink sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
          <div>
            <div className="font-brand text-[clamp(24px,3.4vw,34px)] leading-tight text-haldi">Pooja to pantry, at your door.</div>
            <p className="mt-1 text-[14px] text-white/85">
              Jadibuti, pooja and shaadi samagri, dry fruits and daily kirana from {shop.check?.storeName ?? 'your nearest store'}.
              {shop.check?.freeDeliveryAbove ? ` Free delivery above ${rs(shop.check.freeDeliveryAbove)}.` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3">
            <Bike className="size-6 text-haldi" />
            <div>
              <div className="num text-2xl font-extrabold leading-none">{shop.check?.etaMinutes ?? '—'} min</div>
              <div className="text-[12px] text-white/80">estimated delivery</div>
            </div>
          </div>
        </div>
      )}

      <div className="sticky top-[61px] z-20 -mx-4 bg-bg/95 px-4 pb-2 pt-1 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted" />
          <Input className="pl-9" placeholder="Search kesar, kaju, kapur, mehndi…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
        </div>
        <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {[['', 'All'], ...cats].map(([k, v]) => (
            <button key={k} onClick={() => setCat(k!)} className={cn('h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-semibold', cat === k ? 'border-kum bg-kum text-kum-ink' : 'border-line bg-surface')}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {cat === 'preg' ? <p className="mt-2 rounded-xl bg-haldi/20 px-3 py-2 text-[13px]">Pregnancy and post-delivery herbs — use as advised by your doctor or vaidya.</p> : null}

      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {shop.catalogLoading && !shop.catalog.length ? Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />) : null}
        {list.map((r) => (
          <ProductCard key={r.productId} r={r} />
        ))}
      </ul>
      {!shop.catalogLoading && !list.length ? <p className="py-10 text-center text-muted">No items match. Try another word.</p> : null}

      <AnimatePresence>
        {shop.count > 0 ? (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} className="fixed inset-x-3 bottom-[72px] z-30 mx-auto max-w-xl sm:bottom-6">
            <Link href="/shop/cart" className="flex items-center justify-between rounded-2xl bg-leaf px-4 py-3 text-white shadow-2xl">
              <span className="flex items-center gap-2 font-bold">
                <ShoppingBag className="size-5" />
                <span>
                  {shop.count} item{shop.count === 1 ? '' : 's'} · <span className="num">{rs(shop.itemsTotal)}</span>
                  {shop.check?.freeDeliveryAbove && shop.itemsTotal < shop.check.freeDeliveryAbove ? <span className="block text-[12px] font-semibold text-white/85">Add {rs(shop.check.freeDeliveryAbove - shop.itemsTotal)} for free delivery</span> : null}
                </span>
              </span>
              <span className="font-extrabold">View cart ›</span>
            </Link>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </main>
  );
}
