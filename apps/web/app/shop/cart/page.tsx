'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Banknote, Bike, CreditCard, Loader2, MapPin, ShieldCheck, Smartphone, Wallet } from 'lucide-react';
import { COD_LIMIT, MIN_ORDER_VALUE, type OnlinePaymentMethod } from '@pansari/shared';
import { ErrorNote, useToast } from '@/components/common';
import { QtyButton, deliveryText, useShop } from '@/components/shop';
import { Button, Card, CardTitle, EmptyState } from '@/components/ui';
import { useData } from '@/lib/data/provider';
import { productArtUrl } from '@/lib/data/types';
import { cn, errMsg, rs } from '@/lib/utils';

const METHODS: { id: OnlinePaymentMethod; label: string; sub: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'UPI_INTENT', label: 'UPI', sub: 'GPay, PhonePe, Paytm, BHIM', icon: Smartphone },
  { id: 'CARD', label: 'Card', sub: 'Debit or credit card', icon: CreditCard },
  { id: 'WALLET', label: 'Pansari wallet', sub: 'Refunds and added money', icon: Wallet },
  { id: 'COD', label: 'Cash on delivery', sub: `Up to ${rs(COD_LIMIT)}`, icon: Banknote },
];

export default function CartPage() {
  const shop = useShop();
  const data = useData();
  const toast = useToast();
  const router = useRouter();
  const [method, setMethod] = React.useState<OnlinePaymentMethod>('UPI_INTENT');
  const [simulate, setSimulate] = React.useState<'success' | 'fail'>('success');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const d = deliveryText(shop.check, shop.checking);
  const wallet = shop.profile?.walletBalance ?? 0;
  const methodBlocked = (m: OnlinePaymentMethod) => (m === 'COD' && shop.total > COD_LIMIT ? `Above ${rs(COD_LIMIT)}` : m === 'WALLET' && wallet < shop.total ? `Balance ${rs(wallet)}` : null);

  async function place() {
    if (!shop.address || !shop.storeId) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await data.placeOrder({ addressId: shop.address.id, storeId: shop.storeId, items: shop.lines.map((l) => ({ productId: l.row.productId, qty: l.qty })), paymentMethod: method, simulateOutcome: method === 'UPI_INTENT' || method === 'CARD' ? simulate : undefined });
      shop.clearCart();
      shop.reloadCatalog();
      shop.reloadProfile();
      toast({ tone: 'good', text: `Order placed · ${rs(r.grandTotal)}` });
      router.push(`/shop/orders/view?id=${r.orderId}&new=1`);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'STORE_CHANGED') shop.reloadCatalog();
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (!shop.lines.length) {
    return (
      <main className="mx-auto max-w-xl px-4 pt-6">
        <EmptyState title="Your cart is empty">
          <Link href="/shop" className="font-bold text-kum underline">
            Start shopping
          </Link>
        </EmptyState>
      </main>
    );
  }

  const blocked = methodBlocked(method);
  const canPlace = shop.isCustomer && !!shop.address && !!shop.check?.serviceable && shop.itemsTotal >= MIN_ORDER_VALUE && !blocked;

  return (
    <main className="mx-auto grid max-w-5xl gap-4 px-4 pt-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid content-start gap-4">
        <Card className="flex items-center gap-3">
          <span className={cn('grid size-11 place-items-center rounded-xl', d.tone === 'good' ? 'bg-leaf/15 text-leaf' : 'bg-danger/10 text-danger')}>
            <Bike className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-extrabold">{d.title}</div>
            <div className="text-[13px] text-muted">
              {shop.lines.length} product{shop.lines.length === 1 ? '' : 's'} from {shop.check?.storeName ?? 'the store'}
            </div>
          </div>
        </Card>

        <Card className="grid gap-0 p-0 sm:p-0">
          <ul className="divide-y divide-line">
            {shop.lines.map(({ row, qty }) => (
              <li key={row.productId} className="flex items-center gap-3 px-4 py-3">
                <Thumb id={row.productId} />
                <div className="min-w-0 flex-1">
                  <div className="font-bold leading-snug">{row.product.name}</div>
                  <div className="text-[13px] text-muted">
                    {row.product.netQuantity} · <span className="num">{rs(row.sellingPrice)}</span>
                  </div>
                </div>
                <QtyButton row={row} />
                <div className="num w-20 text-right font-bold">{rs(row.sellingPrice * qty)}</div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="grid gap-3">
          <div className="flex items-center justify-between">
            <CardTitle>Delivery address</CardTitle>
            {shop.isCustomer ? (
              <button onClick={shop.openLocation} className="text-sm font-bold text-kum">
                {shop.address ? 'Change' : 'Add'}
              </button>
            ) : null}
          </div>
          {!shop.ready ? null : !shop.isCustomer ? (
            <div className="grid gap-2">
              <p className="text-sm text-muted">{shop.user ? 'You are signed in with a shop account. Sign in with a customer number to order.' : 'Sign in with your mobile number to save your address and place the order.'}</p>
              <Button asChild size="lg">
                <Link href="/login?next=/shop/cart">Sign in to continue</Link>
              </Button>
            </div>
          ) : shop.address ? (
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 size-5 shrink-0 text-kum" />
              <div className="text-sm">
                <div className="font-bold">{shop.address.label}</div>
                <div className="text-muted">
                  {shop.address.line1}
                  {shop.address.line2 ? `, ${shop.address.line2}` : ''}, {shop.address.city} {shop.address.pincode}
                </div>
                {shop.check && !shop.check.serviceable ? <div className="mt-1 font-semibold text-danger">We don&apos;t deliver here yet.</div> : null}
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={shop.openLocation}>
              <MapPin className="size-4" /> Add delivery address
            </Button>
          )}
        </Card>
      </div>

      <div className="grid content-start gap-4 lg:sticky lg:top-20">
        <Card className="grid gap-2 text-[15px]">
          <CardTitle className="mb-1">Bill details</CardTitle>
          <div className="flex justify-between">
            <span>Items total</span>
            <span className="num">{rs(shop.itemsTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>Delivery charge</span>
            <span className={cn('num', shop.fee === 0 && 'font-bold text-leaf')}>{shop.fee === 0 ? 'FREE' : rs(shop.fee)}</span>
          </div>
          {shop.check?.freeDeliveryAbove && shop.fee > 0 ? <div className="text-[13px] text-muted">Free delivery above {rs(shop.check.freeDeliveryAbove)}</div> : null}
          <div className="mt-1 flex justify-between border-t border-line pt-2 text-lg font-extrabold">
            <span>To pay</span>
            <span className="num">{rs(shop.total)}</span>
          </div>
          <p className="text-[12px] text-muted">Prices include GST. Your GST invoice is issued when the order leaves the store; the final amount is confirmed by the store system.</p>
          {shop.minOrderShort ? <p className="rounded-lg bg-haldi/20 px-2 py-1.5 text-[13px] font-semibold">Add {rs(shop.minOrderShort)} more — minimum order is {rs(MIN_ORDER_VALUE)}.</p> : null}
        </Card>

        <Card className="grid gap-2">
          <CardTitle className="mb-1">Pay with</CardTitle>
          {METHODS.map((m) => {
            const why = methodBlocked(m.id);
            return (
              <button key={m.id} disabled={!!why} onClick={() => setMethod(m.id)} className={cn('flex items-center gap-3 rounded-2xl border p-3 text-left disabled:opacity-50', method === m.id ? 'border-kum bg-kum/5' : 'border-line hover:border-haldi')}>
                <m.icon className="size-5 text-kum" />
                <span className="flex-1">
                  <span className="block font-bold">{m.label}</span>
                  <span className="text-[13px] text-muted">{why ?? (m.id === 'WALLET' ? `Balance ${rs(wallet)}` : m.sub)}</span>
                </span>
                <span className={cn('size-4 rounded-full border-2', method === m.id ? 'border-kum bg-kum' : 'border-line')} />
              </button>
            );
          })}
          {method === 'UPI_INTENT' || method === 'CARD' ? (
            <div className="rounded-xl border border-dashed border-line p-3 text-[13px]">
              <div className="font-bold">Test mode — no money moves</div>
              <div className="mt-1 flex gap-3">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={simulate === 'success'} onChange={() => setSimulate('success')} /> Payment succeeds
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={simulate === 'fail'} onChange={() => setSimulate('fail')} /> Payment fails
                </label>
              </div>
            </div>
          ) : null}
          {err ? <ErrorNote>{err}</ErrorNote> : null}
          <Button size="lg" variant="leaf" disabled={!canPlace || busy} onClick={place}>
            {busy ? <Loader2 className="size-5 animate-spin" /> : <ShieldCheck className="size-5" />} {method === 'COD' ? 'Place order' : `Pay ${rs(shop.total)}`}
          </Button>
        </Card>
      </div>
    </main>
  );
}

function Thumb({ id }: { id: string }) {
  const art = productArtUrl(id);
  // eslint-disable-next-line @next/next/no-img-element
  return art ? <img src={art} alt="" className="size-12 shrink-0 rounded-lg object-cover" /> : <div className="size-12 shrink-0 rounded-lg bg-surface-2" />;
}
