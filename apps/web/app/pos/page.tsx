'use client';
import * as React from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { Banknote, CreditCard, FileText, LayoutGrid, Minus, Plus, Printer, QrCode, ScanLine, Search, Smartphone, Trash2, X } from 'lucide-react';
import { CATEGORY_LABELS, computeInvoice, LOOSE_UNITS, validateGstin, type InvoiceComputation } from '@pansari/shared';
import { buildUpiUri } from '@pansari/adapters';
import { CameraScanner } from '@/components/CameraScanner';
import { Brand, ErrorNote, Qr, RequireStaff, useSelectedStore, useToast } from '@/components/common';
import { Badge, Button, Dialog, DialogContent, Field, Input, Select, Skeleton } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { AppUser, InventoryRow, SaleResult } from '@/lib/data/types';
import { cn, errMsg, openPdf, rs } from '@/lib/utils';

type Line = { productId: string; qty: number };
type PayMethod = 'CASH' | 'UPI_QR' | 'CARD';

export default function PosPage() {
  return <RequireStaff roles={['seller', 'staff']}>{(u) => <Counter user={u} />}</RequireStaff>;
}

function Counter({ user }: { user: AppUser }) {
  const data = useData();
  const toast = useToast();
  const stores = useResource(() => data.listStores(), [data, user.uid]);
  const sellable = React.useMemo(() => (stores.data ?? []).filter((s) => s.type !== 'WAREHOUSE'), [stores.data]);
  const [storeId, setStoreId] = useSelectedStore(sellable.map((s) => s.storeId));
  const store = sellable.find((s) => s.storeId === storeId);
  const stock = useResource(() => (storeId ? data.listInventory(storeId) : Promise.resolve([])), [data, storeId]);
  const byId = React.useMemo(() => new Map((stock.data ?? []).map((r) => [r.productId, r])), [stock.data]);

  const [lines, setLines] = React.useState<Line[]>([]);
  const [cart, setCart] = React.useState<{ cartId: string } | null>(null);
  const [q, setQ] = React.useState('');
  const [cat, setCat] = React.useState('');
  const [buyer, setBuyer] = React.useState({ name: '', gstin: '' });
  const [showBuyer, setShowBuyer] = React.useState(false);
  const [pay, setPay] = React.useState<PayMethod | null>(null);
  const [scan, setScan] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [receipt, setReceipt] = React.useState<SaleResult | null>(null);
  const search = React.useRef<HTMLInputElement>(null);

  const gstinCheck = buyer.gstin.trim() ? validateGstin(buyer.gstin) : null;
  const preview: InvoiceComputation | null = React.useMemo(() => {
    if (!store || !lines.length) return null;
    try {
      return computeInvoice(
        lines.filter((l) => byId.has(l.productId)).map((l) => {
          const r = byId.get(l.productId)!;
          return { productId: l.productId, name: r.product.name, hsnCode: r.product.hsnCode, qty: l.qty, unit: r.product.unit, unitPrice: r.sellingPrice, taxType: r.product.taxType, gstSlab: r.product.gstSlab };
        }),
        { sellerStateCode: store.stateCode, placeOfSupplyStateCode: store.stateCode, buyerGstin: gstinCheck?.valid ? buyer.gstin : null },
      );
    } catch {
      return null;
    }
  }, [lines, byId, store, buyer.gstin, gstinCheck?.valid]);

  const step = (r: InventoryRow) => (LOOSE_UNITS.includes(r.product.unit) ? 0.25 : 1);
  const add = React.useCallback(
    (r: InventoryRow, n = 1) => {
      if (cart) return toast({ tone: 'bad', text: 'Finish or clear the walk-in cart first' });
      if (!r.sellingPrice) return toast({ tone: 'bad', text: `${r.product.name} has no price yet` });
      const cur = lines.find((l) => l.productId === r.productId);
      const qty = Math.round(((cur?.qty ?? 0) + n * step(r)) * 1000) / 1000;
      if (qty > r.onHand) return toast({ tone: 'bad', text: `Only ${r.onHand} of ${r.product.name} in stock` });
      if (qty <= 0) setLines(lines.filter((l) => l.productId !== r.productId));
      else setLines(cur ? lines.map((l) => (l.productId === r.productId ? { ...l, qty } : l)) : [...lines, { productId: r.productId, qty }]);
    },
    [cart, toast, lines],
  );

  const redeem = React.useCallback(
    async (token: string) => {
      setScan(false);
      setBusy(true);
      try {
        const r = await data.redeemCheckout(token);
        if (r.storeId !== storeId) setStoreId(r.storeId);
        const c = await data.getCart(r.cartId);
        if (!c || !c.items.length) throw new Error('The cart is empty');
        setCart({ cartId: c.cartId });
        setLines(c.items);
        toast({ tone: 'good', text: `Walk-in cart loaded · ${c.items.length} item${c.items.length === 1 ? '' : 's'}` });
      } catch (e) {
        toast({ tone: 'bad', text: errMsg(e) });
      } finally {
        setBusy(false);
      }
    },
    [data, storeId, setStoreId, toast],
  );

  function onSearchEnter() {
    const v = q.trim();
    if (!v) return;
    if (v.startsWith('v1.')) {
      setQ('');
      void redeem(v);
      return;
    }
    const exact = (stock.data ?? []).find((r) => r.product.barcode === v);
    const hits = filtered();
    const hit = exact ?? (hits.length === 1 ? hits[0] : undefined);
    if (hit) {
      add(hit);
      setQ('');
    } else toast({ tone: 'bad', text: exact === undefined && /^\d{8,14}$/.test(v) ? `No item with barcode ${v}` : 'Pick an item from the list' });
  }
  const filtered = () => (stock.data ?? []).filter((r) => (!cat || r.product.category === cat) && (!q || `${r.product.name} ${r.product.nameHi ?? ''} ${r.product.barcode ?? ''}`.toLowerCase().includes(q.toLowerCase())));

  function clearBill() {
    setLines([]);
    setCart(null);
    setBuyer({ name: '', gstin: '' });
    setShowBuyer(false);
    search.current?.focus();
  }

  async function commit(method: PayMethod) {
    if (!store || !lines.length) return;
    if (buyer.gstin.trim() && !gstinCheck?.valid) return toast({ tone: 'bad', text: `GSTIN: ${gstinCheck?.reason}` });
    setBusy(true);
    try {
      const res = await data.commitSale({
        storeId: store.storeId,
        channel: cart ? 'OFFLINE_QR' : 'POS_WALKIN',
        ...(cart ? { tempCartId: cart.cartId } : { items: lines }),
        payment: { method },
        buyer: buyer.name.trim() || buyer.gstin.trim() ? { name: buyer.name.trim() || null, gstin: buyer.gstin.trim() || null } : undefined,
      });
      setPay(null);
      setReceipt(res);
      clearBill();
      stock.reload();
    } catch (e) {
      toast({ tone: 'bad', text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        search.current?.focus();
      } else if (e.key === 'F4' && lines.length) {
        e.preventDefault();
        setPay('CASH');
      } else if (e.key === 'F8' && lines.length) {
        e.preventDefault();
        setPay('UPI_QR');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lines.length]);

  const total = preview?.totals.grandTotal ?? 0;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="no-print glass sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
        <Brand sub="POS counter" />
        <Select aria-label="Store" className="h-10 w-auto text-sm" value={storeId} onChange={(e) => { setStoreId(e.target.value); clearBill(); }}>
          {sellable.map((s) => (
            <option key={s.storeId} value={s.storeId}>
              {s.name}
            </option>
          ))}
        </Select>
        <span className="hidden text-sm text-muted md:inline">
          Cashier: <b className="text-ink">{user.displayName ?? user.phone}</b>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[12px] text-muted lg:inline">F2 search · F4 cash · F8 UPI</span>
          <Button variant="outline" size="sm" onClick={() => setScan(true)} disabled={busy}>
            <QrCode className="size-4" /> Walk-in QR
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/seller">
              <LayoutGrid className="size-4" /> Portal
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[minmax(0,1fr)] gap-0 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="min-w-0 p-4 pb-24 lg:pb-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-4 size-5 text-muted" />
            <Input
              ref={search}
              autoFocus
              className="h-14 rounded-2xl pl-12 text-lg"
              placeholder="Scan barcode or type item name, then Enter"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onSearchEnter())}
              aria-label="Scan or search item"
            />
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {[['', 'All'], ...Object.entries(CATEGORY_LABELS)].map(([k, v]) => (
              <button key={k} onClick={() => setCat(k)} className={cn('h-10 shrink-0 rounded-full border px-4 text-sm font-semibold', cat === k ? 'border-kum bg-kum text-kum-ink' : 'border-line bg-surface')}>
                {v}
              </button>
            ))}
          </div>
          {stock.loading ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
          ) : stock.error ? (
            <div className="mt-4">
              <ErrorNote>{stock.error}</ErrorNote>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {filtered().map((r) => {
                const inBill = lines.find((l) => l.productId === r.productId)?.qty ?? 0;
                const out = r.onHand <= 0 || !r.sellingPrice;
                return (
                  <button
                    key={r.productId}
                    disabled={out || !!cart}
                    onClick={() => add(r)}
                    className={cn('relative grid min-h-28 content-between gap-2 rounded-2xl border bg-surface p-3 text-left transition-colors hover:border-haldi disabled:opacity-45', inBill ? 'border-kum ring-2 ring-kum/30' : 'border-line')}
                  >
                    <span className="text-[15px] font-semibold leading-snug">{r.product.name}</span>
                    <span className="flex flex-wrap items-end justify-between gap-x-2">
                      <span className="num text-[17px] font-extrabold">{r.sellingPrice ? rs(r.sellingPrice) : '—'}</span>
                      <span className={cn('num text-[12px] font-semibold', r.lowStock ? 'text-warn' : 'text-muted')}>{r.onHand} · {r.aisleBinCode || '—'}</span>
                    </span>
                    {inBill ? <span className="num absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-kum text-[13px] font-extrabold text-kum-ink">{inBill}</span> : null}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside id="bill" className="no-print flex flex-col border-t border-line bg-surface lg:sticky lg:top-[57px] lg:h-[calc(100dvh-57px)] lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-extrabold">Bill</h2>
            {lines.length ? (
              <Button variant="ghost" size="sm" onClick={clearBill}>
                <Trash2 className="size-4" /> Clear
              </Button>
            ) : null}
          </div>
          {cart ? (
            <div className="mx-4 mt-2 flex items-center gap-2 rounded-xl bg-haldi/25 px-3 py-2 text-sm font-semibold">
              <ScanLine className="size-4" /> Walk-in QR cart · prices and stock re-checked at billing
            </div>
          ) : null}
          <ul className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
            <AnimatePresence initial={false}>
              {lines.map((l) => {
                const r = byId.get(l.productId);
                const c = preview?.lines.find((x) => x.productId === l.productId);
                return (
                  <motion.li key={l.productId} layout initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-3 border-b border-line py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{r?.product.name ?? l.productId}</div>
                      <div className="num text-[12px] text-muted">
                        {r ? rs(r.sellingPrice) : ''} · GST {r?.product.gstSlab}%
                      </div>
                    </div>
                    {r && !cart ? (
                      <div className="flex items-center rounded-xl border border-line">
                        <button className="grid size-9 place-items-center" onClick={() => add(r, -1)} aria-label="Less">
                          <Minus className="size-4" />
                        </button>
                        <span className="num min-w-8 text-center font-bold">{l.qty}</span>
                        <button className="grid size-9 place-items-center" onClick={() => add(r, 1)} aria-label="More">
                          <Plus className="size-4" />
                        </button>
                      </div>
                    ) : (
                      <span className="num font-bold">× {l.qty}</span>
                    )}
                    <span className="num w-20 text-right font-bold">{c ? rs(c.total) : ''}</span>
                  </motion.li>
                );
              })}
            </AnimatePresence>
            {!lines.length ? <li className="py-10 text-center text-muted">Scan or tap items to start a bill.</li> : null}
          </ul>
          <div className="grid gap-3 border-t border-line p-4">
            {showBuyer ? (
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Customer name" value={buyer.name} onChange={(e) => setBuyer((b) => ({ ...b, name: e.target.value }))} aria-label="Customer name" />
                <Input placeholder="GSTIN (B2B)" value={buyer.gstin} onChange={(e) => setBuyer((b) => ({ ...b, gstin: e.target.value.toUpperCase() }))} aria-label="Customer GSTIN" className={gstinCheck && !gstinCheck.valid ? 'border-danger' : ''} />
                {gstinCheck ? <span className={cn('col-span-2 text-[12px] font-semibold', gstinCheck.valid ? 'text-leaf' : 'text-danger')}>{gstinCheck.valid ? 'Valid GSTIN — tax invoice with IRN (B2B)' : gstinCheck.reason}</span> : null}
              </div>
            ) : (
              <button className="text-left text-sm font-semibold text-kum underline" onClick={() => setShowBuyer(true)}>
                + Customer name / GSTIN
              </button>
            )}
            {preview ? (
              <div className="grid gap-1 text-[14px]">
                <div className="flex justify-between text-muted">
                  <span>Taxable</span>
                  <span className="num">{rs(preview.totals.taxable)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>CGST + SGST</span>
                  <span className="num">{rs(preview.totals.cgst + preview.totals.sgst)}</span>
                </div>
                {preview.totals.roundOff ? (
                  <div className="flex justify-between text-muted">
                    <span>Round off</span>
                    <span className="num">{rs(preview.totals.roundOff)}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="flex items-end justify-between">
              <span className="font-semibold text-muted">Total</span>
              <span className="num text-[34px] font-extrabold leading-none">{rs(total)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button size="lg" variant="leaf" disabled={!lines.length || busy} onClick={() => setPay('CASH')}>
                <Banknote className="size-5" /> Cash
              </Button>
              <Button size="lg" variant="haldi" disabled={!lines.length || busy} onClick={() => setPay('UPI_QR')}>
                <Smartphone className="size-5" /> UPI
              </Button>
              <Button size="lg" variant="outline" disabled={!lines.length || busy} onClick={() => setPay('CARD')}>
                <CreditCard className="size-5" /> Card
              </Button>
            </div>
          </div>
        </aside>
      </div>

      {lines.length ? (
        <button
          onClick={() => document.getElementById('bill')?.scrollIntoView({ behavior: 'smooth' })}
          className="no-print fixed inset-x-3 bottom-3 z-40 flex items-center justify-between rounded-full bg-kum px-5 py-3 text-kum-ink shadow-2xl lg:hidden"
        >
          <span className="font-bold">
            {lines.length} item{lines.length === 1 ? '' : 's'} · <span className="num">{rs(total)}</span>
          </span>
          <span className="font-extrabold">Bill & pay</span>
        </button>
      ) : null}

      <Dialog open={!!pay} onOpenChange={(o) => !o && setPay(null)}>
        {pay ? <PayDialog method={pay} amount={total} vpa={store?.upiVpa ?? null} payee={store?.name ?? 'Pansari Express'} busy={busy} onConfirm={() => commit(pay)} /> : null}
      </Dialog>
      <Dialog open={scan} onOpenChange={setScan}>
        {scan ? <ScanDialog onToken={redeem} /> : null}
      </Dialog>
      <Dialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)}>
        {receipt ? <ReceiptDialog r={receipt} onNew={() => setReceipt(null)} /> : null}
      </Dialog>
    </div>
  );
}

function PayDialog({ method, amount, vpa, payee, busy, onConfirm }: { method: PayMethod; amount: number; vpa: string | null; payee: string; busy: boolean; onConfirm: () => void }) {
  const [tendered, setTendered] = React.useState('');
  const change = Math.round(Number(tendered || 0) * 100) - amount;
  const upi = method === 'UPI_QR' && vpa ? buildUpiUri({ vpa, name: payee, amount, txnRef: `POS${Date.now().toString().slice(-8)}`, note: 'Counter bill' }) : null;
  return (
    <DialogContent title={method === 'CASH' ? 'Cash payment' : method === 'UPI_QR' ? 'UPI payment' : 'Card payment'} description={`Amount ${rs(amount)}`}>
      {method === 'CASH' ? (
        <div className="grid gap-3">
          <Field label="Cash received (₹)">
            <Input autoFocus inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && onConfirm()} />
          </Field>
          <div className="flex flex-wrap gap-2">
            {[amount, Math.ceil(amount / 10000) * 10000, Math.ceil(amount / 50000) * 50000, Math.ceil(amount / 200000) * 200000].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
              <Button key={v} variant="outline" size="sm" onClick={() => setTendered(String(v / 100))}>
                {rs(v)}
              </Button>
            ))}
          </div>
          {tendered ? <div className={cn('text-lg font-extrabold', change < 0 ? 'text-danger' : 'text-leaf')}>{change < 0 ? `Short by ${rs(-change)}` : `Return ${rs(change)}`}</div> : null}
        </div>
      ) : method === 'UPI_QR' ? (
        <div className="grid justify-items-center gap-3 text-center">
          {upi ? <Qr value={upi} size={220} label="UPI payment QR" /> : <ErrorNote>This store has no UPI id set.</ErrorNote>}
          <p className="text-sm text-muted">Customer scans with any UPI app. Confirm only after you see the payment on your UPI app or soundbox.</p>
        </div>
      ) : (
        <p className="text-sm text-muted">Take the card payment on your card machine, then confirm here.</p>
      )}
      <Button size="lg" disabled={busy || (method === 'CASH' && tendered !== '' && change < 0)} onClick={onConfirm}>
        {busy ? 'Saving bill…' : method === 'CASH' ? 'Cash received — print bill' : 'Payment received — print bill'}
      </Button>
    </DialogContent>
  );
}

function ScanDialog({ onToken }: { onToken: (t: string) => void }) {
  const [paste, setPaste] = React.useState('');
  return (
    <DialogContent title="Scan the customer's checkout QR" description="The cart loads with prices re-checked. Each checkout QR works once and expires in 10 minutes.">
      <CameraScanner onResult={onToken} formats={['qr_code']} />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (paste.trim()) onToken(paste.trim());
        }}
      >
        <Input placeholder="…or paste the code" value={paste} onChange={(e) => setPaste(e.target.value)} aria-label="Checkout code" />
        <Button type="submit">Load</Button>
      </form>
    </DialogContent>
  );
}

function ReceiptDialog({ r, onNew }: { r: SaleResult; onNew: () => void }) {
  const data = useData();
  const toast = useToast();
  const get = async (format: 'A4' | 'THERMAL_80MM') => {
    try {
      openPdf(await data.invoicePdf(r.invoiceId, format), `${r.invoiceNo.replace(/\//g, '-')}.pdf`);
    } catch (e) {
      toast({ tone: 'bad', text: errMsg(e) });
    }
  };
  return (
    <DialogContent title="Bill saved" description="Stock deducted first-expiry-first and the invoice is in the GST register.">
      <div className="grid justify-items-center gap-1 rounded-2xl bg-surface-2 p-5 text-center">
        <Badge tone={r.kind === 'B2B' ? 'brand' : 'good'}>{r.kind === 'B2B' ? 'Tax invoice · B2B' : 'Tax invoice'}</Badge>
        <div className="num mt-1 text-lg font-bold">{r.invoiceNo}</div>
        <div className="num text-[40px] font-extrabold leading-none">{rs(r.grandTotal)}</div>
        <div className="num text-sm text-muted">incl. GST {rs(r.totalTax)}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => get('THERMAL_80MM')}>
          <Printer className="size-4" /> 80 mm receipt
        </Button>
        <Button variant="outline" onClick={() => get('A4')}>
          <FileText className="size-4" /> A4 invoice
        </Button>
      </div>
      <Button size="lg" autoFocus onClick={onNew}>
        <X className="size-4" /> Next customer
      </Button>
    </DialogContent>
  );
}
