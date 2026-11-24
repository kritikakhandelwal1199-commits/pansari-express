'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowRight, Boxes, QrCode, ScanBarcode, Store } from 'lucide-react';
import { Brand, Qr } from '@/components/common';
import { Button } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import { toAppPath } from '@/lib/utils';

const tiles = [
  { href: '/seller', icon: Boxes, title: 'Seller portal', text: 'Catalogue, stock with batches and expiry, prices per store, GST invoices and the GSTR-1 summary.', tone: 'bg-kum text-kum-ink' },
  { href: '/pos', icon: ScanBarcode, title: 'POS counter', text: 'Scan barcodes, bill in seconds, take cash or UPI, and check out walk-in QR carts.', tone: 'bg-haldi text-[#3a1d05]' },
];

export default function Home() {
  const data = useData();
  const router = useRouter();
  const poster = useResource(() => (data.demoPoster ? data.demoPoster('S1') : Promise.resolve(null)), [data]);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      <header className="flex items-center justify-between">
        <Brand sub="Kirana · jadibuti · pooja · shaadi · dry fruits" />
        <Button variant="outline" size="sm" asChild>
          <Link href="/login">Staff sign in</Link>
        </Button>
      </header>

      <section className="mt-8 grid gap-4 md:grid-cols-[1.25fr_1fr]">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-line bg-surface p-6 sm:p-8">
          <h1 className="text-[clamp(30px,4.4vw,48px)] font-extrabold leading-[1.04] tracking-tight text-balance">One stock book for the counter, the QR shelf and online orders.</h1>
          <p className="mt-3 max-w-xl text-[17px] text-muted">Every sale — billed at the till, paid from a customer&apos;s phone after scanning the store QR, or delivered — deducts from the same batches, first-expiry-first, with GST worked out per product.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {tiles.map((t) => (
              <Link key={t.href} href={t.href} className={`group rounded-2xl p-4 ${t.tone}`}>
                <t.icon className="size-6" />
                <div className="mt-3 flex items-center gap-2 text-lg font-bold">
                  {t.title}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </div>
                <p className="mt-1 text-[14px] opacity-90">{t.text}</p>
              </Link>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }} className="grid content-start gap-4 rounded-3xl bg-kum p-6 text-kum-ink sm:p-8">
          <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
            <QrCode className="size-4" /> Counter poster · Johari Bazaar Store
          </div>
          <div className="grid justify-items-center gap-3 rounded-2xl bg-white/8 p-5">
            <div className="font-brand text-2xl text-haldi">Scan to shop this store</div>
            {poster.data ? <Qr value={poster.data.url} size={190} label="Store QR poster" /> : <div className="grid size-[190px] place-items-center rounded-lg bg-white/15 text-sm">{data.mode === 'demo' ? '…' : 'Print posters from the seller portal'}</div>}
            <div className="text-center text-sm text-white/85">No app, no sign-up. See this shelf&apos;s live stock, aisle and expiry, then pay or show a QR at the counter.</div>
          </div>
          {poster.data ? (
            <Button variant="haldi" size="lg" onClick={() => router.push(toAppPath(poster.data!.url) ?? '/')}>
              <Store className="size-5" /> Shop as a walk-in customer
            </Button>
          ) : null}
        </motion.div>
      </section>

      <section className="mt-4 grid gap-4 sm:grid-cols-3">
        {[
          ['Same stock everywhere', 'Online, QR and counter sales lock the same Firestore batches, so the last packet is never sold twice.'],
          ['GST done per item', 'HSN and slab come from the tax master; CGST + SGST or IGST is decided by place of supply.'],
          ['Every unit accounted for', 'Purchases, sales, returns, damage and stock counts each write a ledger line with the running balance.'],
        ].map(([h, t]) => (
          <div key={h} className="rounded-2xl border border-line bg-surface p-5">
            <div className="font-bold">{h}</div>
            <p className="mt-1 text-[14px] text-muted">{t}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
