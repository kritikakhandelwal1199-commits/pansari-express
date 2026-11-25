'use client';
import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarClock, CheckCircle2, Clock, Download, MapPin, Minus, Plus, QrCode, Search, ShieldCheck, ShoppingBag, Smartphone, X } from 'lucide-react';
import { CATEGORY_LABELS, computeInvoice, LOOSE_UNITS } from '@pansari/shared';
import { buildUpiUri } from '@pansari/adapters';
import { Brand, ErrorNote, Qr, useToast } from '@/components/common';
import { ChatWidget } from '@/components/ChatWidget';
import { Badge, Button, Field, Input, Skeleton } from '@/components/ui';
import { useData, useGuest, useResource } from '@/lib/data/provider';
import type { GuestCart, InventoryRow, InvoiceRow, StoreInfo } from '@/lib/data/types';
import { cn, daysUntil, errMsg, fmtDate, openPdf, rs } from '@/lib/utils';

const MOCK_TURNSTILE = 'mock-turnstile-pass';

export default function StorePage() {
  return (
    <React.Suspense fallback={<Loading />}>
      <Storefront />
    </React.Suspense>
  );
}

function Loading() {
  return (
    <div className="mx-auto grid max-w-md gap-3 p-4">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-40 rounded-3xl" />
    </div>
  );
}

function Storefront() {
  const search = useSearchParams();
  const storeId = search.get('s') ?? '';
  const token = search.get('token') ?? '';
  const data = useData();
  const { user: guest, ready } = useGuest();
  const resolved = useResource(() => data.resolveStoreQr(storeId, token), [data, storeId, token]);
  const inSession = !!guest && guest.role === 'temp_qr_guest' && guest.scopedStoreId === storeId;
  const [bill, setBill] = React.useState<InvoiceRow | null>(null);

  if (resolved.loading || !ready) return <Loading />;
  if (resolved.error || !resolved.data) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-md content-center gap-4 p-6 text-center">
        <Brand />
        <div className="rounded-3xl border border-line bg-surface p-6">
          <p className="text-lg font-bold">This QR code can&apos;t be used</p>
          <p className="mt-1 text-muted">{resolved.error ?? 'Store not found'}</p>
          <p className="mt-3 text-sm text-muted">Please scan the poster at the shop counter, or ask the staff for help.</p>
        </div>
      </main>
    );
  }
  if (bill) return <BillView store={resolved.data} bill={bill} onBack={() => setBill(null)} />;
  if (!inSession) return <Welcome store={resolved.data} token={token} />;
  return <Shop store={resolved.data} onBill={setBill} qrExp={guest!.qrExp ?? 0} />;
}

/* ================================================================== welcome */
function Welcome({ store, token }: { store: StoreInfo; token: string }) {
  const data = useData();
  const [human, setHuman] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function start() {
    setBusy(true);
    setError(null);
    try {
      await data.startGuestSession(store.storeId, token, MOCK_TURNSTILE);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto grid min-h-[calc(100dvh-28px)] max-w-md content-between gap-6 p-5">
      <Brand sub="Walk-in shopping" />
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid gap-5 rounded-[28px] bg-kum p-6 text-kum-ink">
        <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
          <ShieldCheck className="size-4" /> Genuine store QR
        </div>
        <h1 className="text-[32px] font-extrabold leading-[1.05]">{store.name}</h1>
        <p className="flex items-start gap-2 text-white/85">
          <MapPin className="mt-1 size-4 shrink-0" /> {store.addressLine}, {store.city}
        </p>
        <ul className="grid gap-2 text-[15px]">
          {['See what is on this shelf right now, with aisle and expiry', 'Pay on your phone, or show a QR to the cashier', 'GST bill straight to your phone — no app, no sign-up'].map((t) => (
            <li key={t} className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-haldi" /> {t}
            </li>
          ))}
        </ul>
      </motion.section>
      <div className="grid gap-3">
        <label className="flex h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 font-semibold">
          <input type="checkbox" className="size-5 accent-[var(--kum)]" checked={human} onChange={(e) => setHuman(e.target.checked)} />
          I&apos;m a person, not a bot
          <span className="ml-auto text-[11px] font-normal text-muted">human check</span>
        </label>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <Button size="lg" disabled={!human || busy} onClick={start}>
          <ShoppingBag className="size-5" /> {busy ? 'Opening the shelf…' : 'Start shopping'}
        </Button>
        <p className="text-center text-[12px] text-muted">Your session lasts 2 hours and only works for this store.</p>
      </div>
    </main>
  );
}

/* ================================================================== shop */
function Shop({ store, onBill, qrExp }: { store: StoreInfo; onBill: (b: InvoiceRow) => void; qrExp: number }) {
  const data = useData();
  const toast = useToast();
  const shelf = useResource(() => data.guestInventory(store.storeId), [data, store.storeId]);
  const key = `pansari-cart-${store.storeId}`;
  const [items, setItems] = React.useState<Record<string, number>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  });
  const [cartId, setCartId] = React.useState<string | undefined>(() => {
    try {
      return sessionStorage.getItem(`${key}-id`) ?? undefined;
    } catch {
      return undefined;
    }
  });
  const [q, setQ] = React.useState('');
  const [cat, setCat] = React.useState('');
  const [sheet, setSheet] = React.useState<null | 'cart' | 'counter' | 'pay'>(null);
  const [checkout, setCheckout] = React.useState<{ token: string; expiresAtMs: number; cartId: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const minutesLeft = Math.max(0, Math.round((qrExp * 1000 - Date.now()) / 60_000));

  React.useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(items));
      if (cartId) sessionStorage.setItem(`${key}-id`, cartId);
    } catch {}
  }, [items, cartId, key]);

  const rows = shelf.data ?? [];
  const byId = new Map(rows.map((r) => [r.productId, r]));
  const lines = Object.entries(items).filter(([id, n]) => n > 0 && byId.has(id));
  const comp = React.useMemo(() => {
    if (!lines.length) return null;
    return computeInvoice(
      lines.map(([id, qty]) => {
        const r = byId.get(id)!;
        return { productId: id, name: r.product.name, hsnCode: r.product.hsnCode, qty, unit: r.product.unit, unitPrice: r.sellingPrice, taxType: r.product.taxType, gstSlab: r.product.gstSlab };
      }),
      { sellerStateCode: store.stateCode, placeOfSupplyStateCode: store.stateCode },
    );
  }, [JSON.stringify(lines), shelf.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = lines.reduce((a, [, n]) => a + n, 0);

  const change = (r: InventoryRow, d: number) => {
    const step = LOOSE_UNITS.includes(r.product.unit) ? 0.25 : 1;
    const next = Math.round(((items[r.productId] ?? 0) + d * step) * 1000) / 1000;
    if (next > r.onHand) return toast({ tone: 'bad', text: `Only ${r.onHand} left on the shelf` });
    setItems({ ...items, [r.productId]: Math.max(0, next) });
  };

  async function saveCart(): Promise<GuestCart> {
    const c = await data.saveGuestCart(store.storeId, lines.map(([productId, qty]) => ({ productId, qty })), cartId);
    setCartId(c.cartId);
    return c;
  }
  async function payAtCounter() {
    setBusy(true);
    try {
      const c = await saveCart();
      const t = await data.createCheckoutToken(c.cartId);
      setCheckout({ ...t, cartId: c.cartId });
      setSheet('counter');
    } catch (e) {
      toast({ tone: 'bad', text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }
  async function payNow(outcome: 'success' | 'fail') {
    setBusy(true);
    try {
      const c = await saveCart();
      const r = await data.guestCommitSale({ storeId: store.storeId, channel: 'OFFLINE_QR', tempCartId: c.cartId, payment: { method: 'UPI_QR' }, simulateOutcome: outcome });
      finish(r.invoiceId);
    } catch (e) {
      toast({ tone: 'bad', text: errMsg(e) });
      setBusy(false);
    }
  }
  async function finish(invoiceId: string) {
    const inv = await data.guestInvoice(invoiceId);
    setItems({});
    setCartId(undefined);
    try {
      sessionStorage.removeItem(`${key}-id`);
    } catch {}
    setBusy(false);
    setSheet(null);
    if (inv) onBill(inv);
  }

  // While the checkout QR is showing, watch for the cashier to bill it.
  React.useEffect(() => {
    if (sheet !== 'counter' || !checkout) return;
    const t = setInterval(async () => {
      try {
        const c = await data.getCart(checkout.cartId);
        if (c?.status === 'CONSUMED') {
          clearInterval(t);
          const latest = (await data.guestInvoices())[0];
          if (latest) void finish(latest.invoiceId);
        }
      } catch {
        /* keep polling */
      }
    }, 2500);
    return () => clearInterval(t);
  }, [sheet, checkout]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = rows.filter((r) => (!cat || r.product.category === cat) && (!q || `${r.product.name} ${r.product.nameHi ?? ''} ${r.product.brand ?? ''}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="mx-auto min-h-dvh max-w-xl pb-32">
      <header className="glass sticky top-0 z-30 border-b border-line px-4 pb-3 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[17px] font-extrabold">{store.name}</div>
            <div className="flex items-center gap-1 text-[12px] text-muted">
              <Clock className="size-3" /> Session ends in {minutesLeft} min · prices incl. GST
            </div>
          </div>
          <span className="font-brand text-lg text-kum">Pansari</span>
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted" />
          <Input className="pl-9" placeholder="Search gond, kapur, kaju…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search this shelf" />
        </div>
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
          {[['', 'All'], ...Object.entries(CATEGORY_LABELS)].map(([k, v]) => (
            <button key={k} onClick={() => setCat(k)} className={cn('h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-semibold', cat === k ? 'border-kum bg-kum text-kum-ink' : 'border-line bg-surface')}>
              {v}
            </button>
          ))}
        </div>
      </header>

      {cat === 'preg' ? <p className="mx-4 mt-3 rounded-xl bg-haldi/20 px-3 py-2 text-[13px]">Pregnancy and post-delivery herbs — use as advised by your doctor or vaidya.</p> : null}
      <ul className="grid gap-3 p-4">
        {shelf.loading ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />) : null}
        {shelf.error ? <ErrorNote>{shelf.error}</ErrorNote> : null}
        {list.map((r) => {
          const n = items[r.productId] ?? 0;
          const d = daysUntil(r.nearestExpiryMs);
          return (
            <li key={r.productId} className="grid gap-2 rounded-2xl border border-line bg-surface p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold leading-snug">{r.product.name}</div>
                  {r.product.nameHi ? <div className="text-[13px] text-muted" lang="hi">{r.product.nameHi}</div> : null}
                </div>
                <div className="text-right">
                  <div className="num text-[17px] font-extrabold">{rs(r.sellingPrice)}</div>
                  {r.mrp > r.sellingPrice ? <div className="num text-[12px] text-muted line-through">{rs(r.mrp)}</div> : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                <Badge>
                  <MapPin className="size-3" /> {r.aisleBinCode || 'Ask staff'}
                </Badge>
                {r.nearestExpiryMs ? (
                  <Badge tone={d !== null && d <= 15 ? 'warn' : 'neutral'}>
                    <CalendarClock className="size-3" /> Exp {fmtDate(r.nearestExpiryMs, { month: 'short', year: 'numeric' })}
                  </Badge>
                ) : null}
                {r.nextBatchNumber ? <span className="num text-muted">Batch {r.nextBatchNumber}</span> : null}
                {r.onHand <= 5 && r.onHand > 0 ? <span className="font-semibold text-warn">Only {r.onHand} left</span> : null}
              </div>
              <div className="flex justify-end">
                {r.onHand <= 0 ? (
                  <span className="text-sm text-muted">Out of stock</span>
                ) : n ? (
                  <div className="flex items-center overflow-hidden rounded-xl bg-leaf text-white">
                    <button className="grid size-10 place-items-center" onClick={() => change(r, -1)} aria-label="One less">
                      <Minus className="size-4" />
                    </button>
                    <span className="num min-w-8 text-center font-bold">{n}</span>
                    <button className="grid size-10 place-items-center" onClick={() => change(r, 1)} aria-label="One more">
                      <Plus className="size-4" />
                    </button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" className="border-leaf px-5 font-extrabold text-leaf" onClick={() => change(r, 1)}>
                    ADD
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <AnimatePresence>
        {count > 0 && comp ? (
          <motion.button
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            onClick={() => setSheet('cart')}
            className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-xl items-center justify-between rounded-full bg-leaf px-5 py-3.5 text-white shadow-2xl"
          >
            <span className="font-bold">
              {count} item{count === 1 ? '' : 's'} · <span className="num">{rs(comp.totals.grandTotal)}</span>
            </span>
            <span className="flex items-center gap-1 font-extrabold">
              View bill <ShoppingBag className="size-4" />
            </span>
          </motion.button>
        ) : null}
      </AnimatePresence>

      <Sheet open={!!sheet} onClose={() => !busy && setSheet(null)}>
        {sheet === 'cart' && comp ? (
          <div className="grid gap-4">
            <h2 className="text-xl font-extrabold">Your bill</h2>
            <ul className="grid gap-2">
              {comp.lines.map((l) => (
                <li key={l.productId} className="flex justify-between gap-3 text-[15px]">
                  <span>
                    {l.qty} × {l.name}
                  </span>
                  <span className="num font-semibold">{rs(l.total)}</span>
                </li>
              ))}
            </ul>
            <div className="grid gap-1 border-t border-dashed border-line pt-3 text-[14px] text-muted">
              <div className="flex justify-between">
                <span>Taxable value</span>
                <span className="num">{rs(comp.totals.taxable)}</span>
              </div>
              <div className="flex justify-between">
                <span>CGST + SGST</span>
                <span className="num">{rs(comp.totals.cgst + comp.totals.sgst)}</span>
              </div>
              <div className="flex justify-between text-lg font-extrabold text-ink">
                <span>Total</span>
                <span className="num">{rs(comp.totals.grandTotal)}</span>
              </div>
            </div>
            <Button size="lg" variant="haldi" disabled={busy} onClick={() => setSheet('pay')}>
              <Smartphone className="size-5" /> Pay now with UPI
            </Button>
            <Button size="lg" variant="outline" disabled={busy} onClick={payAtCounter}>
              <QrCode className="size-5" /> Pay at the counter
            </Button>
            <p className="text-center text-[12px] text-muted">Prices and stock are checked again when the bill is made.</p>
          </div>
        ) : null}
        {sheet === 'pay' && comp ? (
          <div className="grid justify-items-center gap-4 text-center">
            <h2 className="text-xl font-extrabold">Pay {rs(comp.totals.grandTotal)}</h2>
            {store.upiVpa ? <Qr value={buildUpiUri({ vpa: store.upiVpa, name: store.name, amount: comp.totals.grandTotal, txnRef: `QR${Date.now().toString().slice(-8)}`, note: 'Walk-in bill' })} size={200} label="UPI payment QR" /> : null}
            <p className="text-sm text-muted">Payments are in test mode until the payment gateway is switched on. Choose what the bank would answer:</p>
            <div className="grid w-full grid-cols-2 gap-2">
              <Button size="lg" variant="leaf" disabled={busy} onClick={() => payNow('success')}>
                Payment succeeds
              </Button>
              <Button size="lg" variant="outline" disabled={busy} onClick={() => payNow('fail')}>
                Payment fails
              </Button>
            </div>
          </div>
        ) : null}
        {sheet === 'counter' && checkout ? <CounterQr checkout={checkout} total={comp?.totals.grandTotal ?? 0} /> : null}
      </Sheet>
      {!sheet ? <ChatWidget role="temp_qr_guest" storeId={store.storeId} className={count > 0 ? 'bottom-24' : undefined} /> : null}
    </div>
  );
}

function CounterQr({ checkout, total }: { checkout: { token: string; expiresAtMs: number }; total: number }) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.floor((checkout.expiresAtMs - now) / 1000));
  return (
    <div className="grid justify-items-center gap-3 text-center">
      <h2 className="text-xl font-extrabold">Show this to the cashier</h2>
      <div className="rounded-3xl border-4 border-kum p-3">
        <Qr value={checkout.token} size={240} label="Checkout QR for the cashier" />
      </div>
      <div className="num text-2xl font-extrabold">{rs(total)}</div>
      <p className="text-sm text-muted">{left ? `Valid for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · works once` : 'Expired — go back and tap Pay at the counter again'}</p>
      <p className="text-[13px] text-muted">Your bill opens here automatically once the cashier takes payment.</p>
      <details className="w-full text-left text-[13px] text-muted">
        <summary className="cursor-pointer text-center font-semibold">Cashier can&apos;t scan? Show the code</summary>
        <code data-testid="checkout-code" className="mt-2 block select-all break-all rounded-xl bg-surface-2 p-3 text-[11px] text-ink">
          {checkout.token}
        </code>
      </details>
    </div>
  );
}

function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div className="fixed inset-0 z-50 bg-black/45" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[90dvh] max-w-xl overflow-y-auto rounded-t-[28px] bg-surface p-5 pb-8"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          >
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-line" />
            <button className="absolute right-4 top-4 rounded-full p-2 hover:bg-surface-2" onClick={onClose} aria-label="Close">
              <X className="size-5" />
            </button>
            {children}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

/* ================================================================== bill */
function BillView({ store, bill, onBack }: { store: StoreInfo; bill: InvoiceRow; onBack: () => void }) {
  const data = useData();
  const toast = useToast();
  const { user } = useGuest();
  const [phone, setPhone] = React.useState('');
  const [code, setCode] = React.useState('');
  const [vid, setVid] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const saved = !!user && !user.isAnonymous;
  const c = bill.computation;

  async function link() {
    setBusy(true);
    try {
      if (!vid) {
        const d = phone.replace(/\D/g, '');
        setVid((await data.sendGuestLinkOtp(d.length === 10 ? `+91${d}` : phone)).verificationId);
      } else {
        await data.confirmGuestLink(vid, code);
        toast({ tone: 'good', text: 'Bill saved to your number' });
      }
    } catch (e) {
      toast({ tone: 'bad', text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid max-w-md gap-4 p-5">
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="grid justify-items-center gap-2 rounded-[28px] bg-leaf p-6 text-center text-white">
        <CheckCircle2 className="size-10" />
        <div className="text-lg font-bold">Paid · {store.name}</div>
        <div className="num text-[40px] font-extrabold leading-none">{rs(bill.grandTotal)}</div>
        <div className="num text-sm text-white/85">
          Tax invoice {bill.invoiceNo} · GST {rs(c.totals.totalTax)}
        </div>
      </motion.div>
      <section className="rounded-3xl border border-line bg-surface p-5">
        <ul className="grid gap-1.5 text-[15px]">
          {c.lines.map((l) => (
            <li key={l.productId} className="flex justify-between gap-3">
              <span>
                {l.qty} × {l.name}
                <span className="block text-[12px] text-muted">
                  HSN {l.hsnCode} · GST {l.gstSlab}%{l.batchNumber ? ` · Batch ${l.batchNumber}` : ''}
                </span>
              </span>
              <span className="num font-semibold">{rs(l.total)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 grid gap-1 border-t border-dashed border-line pt-3 text-[14px] text-muted">
          <div className="flex justify-between">
            <span>Taxable</span>
            <span className="num">{rs(c.totals.taxable)}</span>
          </div>
          <div className="flex justify-between">
            <span>CGST</span>
            <span className="num">{rs(c.totals.cgst)}</span>
          </div>
          <div className="flex justify-between">
            <span>SGST</span>
            <span className="num">{rs(c.totals.sgst)}</span>
          </div>
        </div>
        <Button
          variant="outline"
          className="mt-4 w-full"
          onClick={async () => {
            try {
              openPdf(await data.guestInvoicePdf(bill.invoiceId), `${bill.invoiceNo.replace(/\//g, '-')}.pdf`);
            } catch (e) {
              toast({ tone: 'bad', text: errMsg(e) });
            }
          }}
        >
          <Download className="size-4" /> Download GST invoice (PDF)
        </Button>
      </section>
      <section className="rounded-3xl border border-line bg-surface p-5">
        {saved ? (
          <p className="flex items-center gap-2 font-semibold text-leaf">
            <CheckCircle2 className="size-5" /> Saved to {user?.phone}. Your bills and loyalty points stay with this number.
          </p>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void link();
            }}
          >
            <div className="font-bold">Keep this bill — add your mobile number</div>
            {!vid ? (
              <Field label="Mobile number">
                <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98XXXXXXXX" />
              </Field>
            ) : (
              <Field label="OTP" hint={process.env.NEXT_PUBLIC_DATA_MODE === 'firebase' ? undefined : 'Demo OTP: 123456'}>
                <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </Field>
            )}
            <Button type="submit" disabled={busy || (!vid ? phone.replace(/\D/g, '').length < 10 : code.length !== 6)}>
              {vid ? 'Verify and save' : 'Send OTP'}
            </Button>
          </form>
        )}
      </section>
      <Button variant="ghost" onClick={onBack}>
        Continue shopping
      </Button>
    </main>
  );
}
