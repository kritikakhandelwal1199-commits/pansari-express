'use client';
/**
 * Customer shop state: who is signed in, the delivery address, which store
 * serves it (zone check), that store's catalogue and the cart.
 * The cart lives in localStorage and is tied to one store; prices shown are the
 * store's shelf prices (GST included) — the server recomputes everything at checkout.
 */
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Loader2, LocateFixed, MapPin, Package, Plus, ShoppingBag, Trash2, User } from 'lucide-react';
import { deliveryFee, MIN_ORDER_VALUE, roundHalfUp } from '@pansari/shared';
import { useToast } from '@/components/common';
import { Button, DialogContent, Dialog, Field, Input } from '@/components/ui';
import { useData, useResource, useStaff } from '@/lib/data/provider';
import type { Address, AppUser, CustomerProfile, DeliveryCheck, InventoryRow } from '@/lib/data/types';
import { cn, errMsg, rs } from '@/lib/utils';

const CART_KEY = 'px-cart';
const ADDR_KEY = 'px-addr';
const PIN_KEY = 'px-pin';

interface Cart {
  storeId: string;
  items: Record<string, number>;
}

export interface ShopCtx {
  user: AppUser | null;
  ready: boolean;
  isCustomer: boolean;
  profile: CustomerProfile | null;
  reloadProfile: () => void;
  address: Address | null;
  pincode: string;
  check: DeliveryCheck | null;
  checking: boolean;
  storeId: string | null;
  catalog: InventoryRow[];
  catalogLoading: boolean;
  reloadCatalog: () => void;
  cart: Record<string, number>;
  setQty: (productId: string, qty: number) => void;
  clearCart: () => void;
  lines: { row: InventoryRow; qty: number }[];
  count: number;
  itemsTotal: number;
  fee: number;
  total: number;
  minOrderShort: number;
  chooseAddress: (id: string) => void;
  choosePincode: (pin: string) => void;
  openLocation: () => void;
}

const Ctx = React.createContext<ShopCtx | null>(null);
export const useShop = () => {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('useShop outside ShopProvider');
  return c;
};

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

export function ShopProvider({ children }: { children: React.ReactNode }) {
  const data = useData();
  const toast = useToast();
  const { user, ready } = useStaff();
  const isCustomer = user?.role === 'customer';
  const profileRes = useResource(() => (isCustomer ? data.myProfile() : Promise.resolve(null)), [data, user?.uid, isCustomer]);
  const profile = profileRes.data;
  const [addrId, setAddrId] = React.useState<string>('');
  const [pincode, setPincode] = React.useState('302003');
  const [cart, setCart] = React.useState<Cart>({ storeId: '', items: {} });
  const [locOpen, setLocOpen] = React.useState(false);

  React.useEffect(() => {
    setAddrId(read(ADDR_KEY, ''));
    setPincode(read(PIN_KEY, '302003'));
    setCart(read<Cart>(CART_KEY, { storeId: '', items: {} }));
  }, []);

  const address = profile?.addresses.find((a) => a.id === addrId) ?? profile?.addresses[0] ?? null;
  const checkRes = useResource(() => data.checkDelivery(address ? { pincode: address.pincode, location: address.location } : { pincode }), [data, address?.id, address?.pincode, pincode]);
  const check = checkRes.data;
  const stores = useResource(() => data.deliveryStores(), [data]);
  const storeId = check?.storeId ?? stores.data?.[0]?.storeId ?? null;
  const catalogRes = useResource(() => (storeId ? data.shopCatalog(storeId) : Promise.resolve([] as InventoryRow[])), [data, storeId]);
  const catalog = catalogRes.data ?? [];

  // A different store now serves this address: the cart belongs to the old store.
  React.useEffect(() => {
    if (!storeId) return;
    setCart((c) => {
      if (c.storeId === storeId) return c;
      if (c.storeId && Object.keys(c.items).length) toast({ tone: 'info', text: 'A different store delivers here, so your cart was emptied.' });
      const next = { storeId, items: {} };
      write(CART_KEY, next);
      return next;
    });
  }, [storeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setQty = React.useCallback(
    (productId: string, qty: number) => {
      setCart((c) => {
        const items = { ...c.items };
        if (qty <= 0) delete items[productId];
        else items[productId] = qty;
        const next = { storeId: storeId ?? c.storeId, items };
        write(CART_KEY, next);
        return next;
      });
    },
    [storeId],
  );
  const clearCart = React.useCallback(() => {
    const next = { storeId: storeId ?? '', items: {} };
    write(CART_KEY, next);
    setCart(next);
  }, [storeId]);

  const byId = React.useMemo(() => new Map(catalog.map((r) => [r.productId, r])), [catalog]);
  const lines = Object.entries(cart.storeId === storeId ? cart.items : {})
    .map(([id, qty]) => ({ row: byId.get(id)!, qty }))
    .filter((l) => l.row);
  const count = lines.reduce((a, l) => a + l.qty, 0);
  const itemsTotal = lines.reduce((a, l) => a + roundHalfUp(l.row.sellingPrice * l.qty), 0);
  const fee = check?.serviceable && itemsTotal > 0 ? deliveryFee(itemsTotal, check) : 0;

  const value: ShopCtx = {
    user,
    ready,
    isCustomer,
    profile,
    reloadProfile: profileRes.reload,
    address,
    pincode,
    check,
    checking: checkRes.loading,
    storeId,
    catalog,
    catalogLoading: catalogRes.loading,
    reloadCatalog: catalogRes.reload,
    cart: cart.items,
    setQty,
    clearCart,
    lines,
    count,
    itemsTotal,
    fee,
    total: itemsTotal + fee,
    minOrderShort: itemsTotal > 0 && itemsTotal < MIN_ORDER_VALUE ? MIN_ORDER_VALUE - itemsTotal : 0,
    chooseAddress: (id) => {
      setAddrId(id);
      write(ADDR_KEY, id);
    },
    choosePincode: (pin) => {
      setPincode(pin);
      write(PIN_KEY, pin);
    },
    openLocation: () => setLocOpen(true),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <LocationDialog open={locOpen} onOpenChange={setLocOpen} />
    </Ctx.Provider>
  );
}

/* ------------------------------------------------------------------ Delivery line */
export function deliveryText(check: DeliveryCheck | null, checking: boolean): { title: string; tone: 'good' | 'bad' | 'muted' } {
  if (checking && !check) return { title: 'Checking delivery…', tone: 'muted' };
  if (!check) return { title: 'Set delivery location', tone: 'muted' };
  if (check.serviceable) return { title: `Delivery in ${check.etaMinutes ?? 10} min`, tone: 'good' };
  if (check.reason === 'UNKNOWN_PINCODE') return { title: 'Pincode not found', tone: 'bad' };
  return { title: 'Not delivering here yet', tone: 'bad' };
}

/* ------------------------------------------------------------------ Location dialog */
function LocationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const shop = useShop();
  const [adding, setAdding] = React.useState(false);
  const [pin, setPin] = React.useState(shop.pincode);
  React.useEffect(() => {
    if (open) {
      setPin(shop.pincode);
      setAdding(!!shop.isCustomer && (shop.profile?.addresses.length ?? 0) === 0);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Delivery location" description="We deliver from the nearest Pansari store.">
        {shop.isCustomer ? (
          adding ? (
            <AddressForm
              onDone={(a) => {
                shop.chooseAddress(a.id);
                shop.reloadProfile();
                setAdding(false);
                onOpenChange(false);
              }}
              onCancel={(shop.profile?.addresses.length ?? 0) > 0 ? () => setAdding(false) : undefined}
            />
          ) : (
            <div className="grid gap-2">
              {shop.profile?.addresses.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    shop.chooseAddress(a.id);
                    onOpenChange(false);
                  }}
                  className={cn('flex items-start gap-3 rounded-2xl border p-3 text-left', shop.address?.id === a.id ? 'border-kum bg-kum/5' : 'border-line hover:border-haldi')}
                >
                  <MapPin className="mt-0.5 size-5 shrink-0 text-kum" />
                  <span className="min-w-0">
                    <span className="block font-bold">{a.label}</span>
                    <span className="block text-sm text-muted">
                      {a.line1}
                      {a.line2 ? `, ${a.line2}` : ''}, {a.city} {a.pincode}
                    </span>
                  </span>
                </button>
              ))}
              <Button variant="outline" onClick={() => setAdding(true)}>
                <Plus className="size-4" /> Add a new address
              </Button>
            </div>
          )
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              shop.choosePincode(pin.trim());
              onOpenChange(false);
            }}
          >
            <Field label="Your pincode" hint="Sign in at checkout to save your full address.">
              <Input inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoFocus />
            </Field>
            <Button type="submit" disabled={pin.length !== 6}>
              Check delivery
            </Button>
            <p className="text-[13px] text-muted">We deliver across Jaipur — try 302003 (Johari Bazaar), 302021 (Vaishali Nagar) or 302028 (Amer). 305001 (Ajmer) is outside our area.</p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AddressForm({ initial, onDone, onCancel }: { initial?: Address; onDone: (a: Address) => void; onCancel?: () => void }) {
  const data = useData();
  const [label, setLabel] = React.useState(initial?.label ?? 'Home');
  const [line1, setLine1] = React.useState(initial?.line1 ?? '');
  const [line2, setLine2] = React.useState(initial?.line2 ?? '');
  const [pincode, setPincode] = React.useState(initial?.pincode ?? '');
  const [loc, setLoc] = React.useState<{ lat: number; lng: number } | null>(initial?.location ?? null);
  const [busy, setBusy] = React.useState(false);
  const [locating, setLocating] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  function locate() {
    if (!navigator.geolocation) return setErr('Location is not available on this device');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLoc({ lat: p.coords.latitude, lng: p.coords.longitude });
        setLocating(false);
      },
      () => {
        setErr('Could not get your location — the pincode will be used');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const a = await data.saveAddress({ id: initial?.id, label, line1, line2, pincode, location: loc });
      onDone(a);
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="grid gap-3" onSubmit={save}>
      <div className="flex gap-2">
        {['Home', 'Work', 'Other'].map((l) => (
          <button type="button" key={l} onClick={() => setLabel(l)} className={cn('h-9 rounded-full border px-3.5 text-sm font-semibold', label === l ? 'border-kum bg-kum text-kum-ink' : 'border-line')}>
            {l === 'Home' ? <Home className="mr-1 inline size-3.5" /> : null}
            {l}
          </button>
        ))}
      </div>
      <Field label="House / flat, street">
        <Input value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="House 21, Haldiyon ka Rasta" autoComplete="address-line1" />
      </Field>
      <Field label="Landmark (optional)">
        <Input value={line2} onChange={(e) => setLine2(e.target.value)} placeholder="Near Johari Bazaar" autoComplete="address-line2" />
      </Field>
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Field label="Pincode">
          <Input inputMode="numeric" maxLength={6} value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))} autoComplete="postal-code" />
        </Field>
        <Button type="button" variant="outline" onClick={locate} disabled={locating}>
          {locating ? <Loader2 className="size-4 animate-spin" /> : <LocateFixed className="size-4" />} {loc ? 'Location set' : 'Use my location'}
        </Button>
      </div>
      {err ? <p className="text-sm font-medium text-danger">{err}</p> : null}
      <div className="flex gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" className="flex-1" disabled={busy || line1.trim().length < 4 || pincode.length !== 6}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Save address
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ Bottom nav (phones) */
export function ShopNav() {
  const path = usePathname() ?? '';
  const { count } = useShop();
  const items = [
    { href: '/shop', label: 'Shop', icon: Home, on: path === '/shop' },
    { href: '/shop/cart', label: 'Cart', icon: ShoppingBag, on: path.startsWith('/shop/cart'), badge: count },
    { href: '/shop/orders', label: 'Orders', icon: Package, on: path.startsWith('/shop/orders') },
    { href: '/shop/account', label: 'Account', icon: User, on: path.startsWith('/shop/account') },
  ];
  return (
    <nav className="glass fixed inset-x-0 bottom-0 z-40 border-t border-line pb-[env(safe-area-inset-bottom)] sm:hidden" aria-label="Shop sections">
      <div className="mx-auto grid max-w-xl grid-cols-4">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className={cn('relative grid h-14 place-items-center content-center gap-0.5 text-[11px] font-semibold', i.on ? 'text-kum' : 'text-muted')}>
            <i.icon className="size-5" />
            {i.label}
            {i.badge ? <span className="num absolute right-[calc(50%-20px)] top-1.5 grid min-w-4 place-items-center rounded-full bg-leaf px-1 text-[10px] text-white">{i.badge}</span> : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function QtyButton({ row, compact }: { row: InventoryRow; compact?: boolean }) {
  const { cart, setQty } = useShop();
  const n = cart[row.productId] ?? 0;
  const max = Math.floor(row.onHand);
  if (row.onHand <= 0) return <span className="text-[13px] font-semibold text-muted">Out of stock</span>;
  if (!n)
    return (
      <Button variant="outline" size="sm" className={cn('border-leaf font-extrabold text-leaf', compact ? 'px-4' : 'px-5')} onClick={() => setQty(row.productId, 1)} aria-label={`Add ${row.product.name}`}>
        ADD
      </Button>
    );
  return (
    <div className="flex items-center overflow-hidden rounded-xl bg-leaf text-white">
      <button className="grid size-9 place-items-center" onClick={() => setQty(row.productId, n - 1)} aria-label="One less">
        {n === 1 ? <Trash2 className="size-3.5" /> : <span className="text-lg leading-none">−</span>}
      </button>
      <span className="num min-w-7 text-center font-bold">{n}</span>
      <button className="grid size-9 place-items-center disabled:opacity-50" disabled={n >= max} onClick={() => setQty(row.productId, n + 1)} aria-label="One more">
        <Plus className="size-4" />
      </button>
    </div>
  );
}

export const money = rs;
