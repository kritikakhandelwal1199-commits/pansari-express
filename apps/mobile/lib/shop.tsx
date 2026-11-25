/** Customer shop state on the phone: address → serving store → catalogue → cart. */
import * as React from 'react';
import { deliveryFee, MIN_ORDER_VALUE, roundHalfUp } from '@pansari/shared';
import type { Address, CustomerProfile, DeliveryCheck, InventoryRow } from '@pansari/client';
import { useData, useResource } from './data';

interface Cart { storeId: string; items: Record<string, number> }

export interface ShopState {
  isCustomer: boolean;
  profile: CustomerProfile | null;
  reloadProfile: () => void;
  address: Address | null;
  chooseAddress: (id: string) => void;
  check: DeliveryCheck | null;
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
}

const Ctx = React.createContext<ShopState | null>(null);
export const useShop = () => {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('useShop outside ShopProvider');
  return c;
};

export function ShopProvider({ children }: { children: React.ReactNode }) {
  const { client, user, storage } = useData();
  const isCustomer = user?.role === 'customer';
  const prof = useResource(() => (isCustomer ? client.myProfile() : Promise.resolve(null)), [client, user?.uid, isCustomer]);
  const [addrId, setAddrId] = React.useState(() => storage.getItem('px-addr') ?? '');
  const [cart, setCart] = React.useState<Cart>(() => {
    try {
      return JSON.parse(storage.getItem('px-cart') ?? '') as Cart;
    } catch {
      return { storeId: '', items: {} };
    }
  });
  const address = prof.data?.addresses.find((a) => a.id === addrId) ?? prof.data?.addresses[0] ?? null;
  const check = useResource(() => client.checkDelivery(address ? { pincode: address.pincode, location: address.location } : { pincode: '302003' }), [client, address?.id, address?.pincode]);
  const storeId = check.data?.storeId ?? 'S1';
  const catalog = useResource(() => client.shopCatalog(storeId), [client, storeId]);

  const save = (c: Cart) => {
    storage.setItem('px-cart', JSON.stringify(c));
    return c;
  };
  React.useEffect(() => {
    setCart((c) => (c.storeId === storeId ? c : save({ storeId, items: {} })));
  }, [storeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = new Map((catalog.data ?? []).map((r) => [r.productId, r]));
  const lines = Object.entries(cart.items).map(([id, qty]) => ({ row: byId.get(id)!, qty })).filter((l) => l.row);
  const itemsTotal = lines.reduce((a, l) => a + roundHalfUp(l.row.sellingPrice * l.qty), 0);
  const fee = check.data?.serviceable && itemsTotal > 0 ? deliveryFee(itemsTotal, check.data) : 0;

  const value: ShopState = {
    isCustomer,
    profile: prof.data,
    reloadProfile: prof.reload,
    address,
    chooseAddress: (id) => {
      setAddrId(id);
      storage.setItem('px-addr', id);
    },
    check: check.data,
    storeId,
    catalog: catalog.data ?? [],
    catalogLoading: catalog.loading,
    reloadCatalog: catalog.reload,
    cart: cart.items,
    setQty: (productId, qty) =>
      setCart((c) => {
        const items = { ...c.items };
        if (qty <= 0) delete items[productId];
        else items[productId] = qty;
        return save({ storeId, items });
      }),
    clearCart: () => setCart(save({ storeId, items: {} })),
    lines,
    count: lines.reduce((a, l) => a + l.qty, 0),
    itemsTotal,
    fee,
    total: itemsTotal + fee,
    minOrderShort: itemsTotal > 0 && itemsTotal < MIN_ORDER_VALUE ? MIN_ORDER_VALUE - itemsTotal : 0,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
