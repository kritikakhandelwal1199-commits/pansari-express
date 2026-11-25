import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { COD_LIMIT, MIN_ORDER_VALUE, type OnlinePaymentMethod } from '@pansari/shared';
import { QtyButton } from '@/components/QtyButton';
import { Button, Card, ErrorText, rs } from '@/components/ui';
import { errMsg, useData } from '@/lib/data';
import { useShop } from '@/lib/shop';

const METHODS: { id: OnlinePaymentMethod; label: string; sub: string }[] = [
  { id: 'UPI_INTENT', label: 'UPI', sub: 'GPay, PhonePe, Paytm, BHIM' },
  { id: 'CARD', label: 'Card', sub: 'Debit or credit card' },
  { id: 'WALLET', label: 'Pansari wallet', sub: '' },
  { id: 'COD', label: 'Cash on delivery', sub: `Up to ${rs(COD_LIMIT)}` },
];

export default function Cart() {
  const shop = useShop();
  const { client } = useData();
  const [method, setMethod] = React.useState<OnlinePaymentMethod>('UPI_INTENT');
  const [fail, setFail] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const wallet = shop.profile?.walletBalance ?? 0;
  const blocked = (m: OnlinePaymentMethod) => (m === 'COD' && shop.total > COD_LIMIT ? `Above ${rs(COD_LIMIT)}` : m === 'WALLET' && wallet < shop.total ? `Balance ${rs(wallet)}` : null);

  if (!shop.lines.length)
    return (
      <View className="flex-1 items-center justify-center gap-3 p-6">
        <Text className="text-lg font-bold text-ink">Your cart is empty</Text>
        <Button title="Start shopping" onPress={() => router.push('/')} />
      </View>
    );

  async function place() {
    if (!shop.address || !shop.storeId) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await client.placeOrder({ addressId: shop.address.id, storeId: shop.storeId, items: shop.lines.map((l) => ({ productId: l.row.productId, qty: l.qty })), paymentMethod: method, simulateOutcome: method === 'UPI_INTENT' || method === 'CARD' ? (fail ? 'fail' : 'success') : undefined });
      shop.clearCart();
      shop.reloadCatalog();
      shop.reloadProfile();
      router.push({ pathname: '/order/[id]', params: { id: r.orderId, new: '1' } });
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  const canPlace = shop.isCustomer && !!shop.address && !!shop.check?.serviceable && shop.itemsTotal >= MIN_ORDER_VALUE && !blocked(method);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      <Card className="gap-3">
        {shop.lines.map(({ row, qty }) => (
          <View key={row.productId} className="flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="font-bold text-ink">{row.product.name}</Text>
              <Text className="text-xs text-muted">{rs(row.sellingPrice)}</Text>
            </View>
            <QtyButton row={row} />
            <Text className="w-20 text-right font-bold text-ink">{rs(row.sellingPrice * qty)}</Text>
          </View>
        ))}
      </Card>

      <Card className="gap-2">
        <Text className="text-[16px] font-bold text-ink">Delivery address</Text>
        {!shop.isCustomer ? (
          <Button title="Sign in to continue" onPress={() => router.push('/login')} />
        ) : shop.address ? (
          <Pressable onPress={() => router.push('/address')}>
            <Text className="font-bold text-ink">{shop.address.label}</Text>
            <Text className="text-sm text-muted">
              {shop.address.line1}, {shop.address.city} {shop.address.pincode}
            </Text>
            <Text className="mt-1 font-bold text-kum">Change</Text>
          </Pressable>
        ) : (
          <Button variant="outline" title="Add delivery address" onPress={() => router.push('/address')} />
        )}
        {shop.check && !shop.check.serviceable ? <Text className="font-semibold text-danger">We don&apos;t deliver here yet.</Text> : null}
      </Card>

      <Card className="gap-1.5">
        <Text className="mb-1 text-[16px] font-bold text-ink">Bill details</Text>
        <Row l="Items total" r={rs(shop.itemsTotal)} />
        <Row l="Delivery charge" r={shop.fee ? rs(shop.fee) : 'FREE'} />
        <View className="mt-1 border-t border-line pt-2">
          <Row l="To pay" r={rs(shop.total)} bold />
        </View>
        <Text className="text-xs text-muted">Prices include GST. The GST invoice is issued when the order leaves the store.</Text>
        {shop.minOrderShort ? <Text className="rounded-lg bg-[#fff1cc] px-2 py-1.5 text-[13px] font-semibold text-warn">Add {rs(shop.minOrderShort)} more — minimum order is {rs(MIN_ORDER_VALUE)}.</Text> : null}
      </Card>

      <Card className="gap-2">
        <Text className="mb-1 text-[16px] font-bold text-ink">Pay with</Text>
        {METHODS.map((m) => {
          const why = blocked(m.id);
          return (
            <Pressable key={m.id} disabled={!!why} onPress={() => setMethod(m.id)} className={`flex-row items-center rounded-2xl border p-3 ${method === m.id ? 'border-kum bg-[#fdf2f4]' : 'border-line'} ${why ? 'opacity-50' : ''}`}>
              <View className="flex-1">
                <Text className="font-bold text-ink">{m.label}</Text>
                <Text className="text-xs text-muted">{why ?? (m.id === 'WALLET' ? `Balance ${rs(wallet)}` : m.sub)}</Text>
              </View>
              <View className={`h-4 w-4 rounded-full border-2 ${method === m.id ? 'border-kum bg-kum' : 'border-line'}`} />
            </Pressable>
          );
        })}
        {method === 'UPI_INTENT' || method === 'CARD' ? (
          <Pressable onPress={() => setFail((v) => !v)} className="rounded-xl border border-dashed border-line p-3">
            <Text className="text-[13px] text-ink">Test mode — no money moves. Outcome: <Text className="font-bold">{fail ? 'payment fails' : 'payment succeeds'}</Text> (tap to switch)</Text>
          </Pressable>
        ) : null}
        <ErrorText>{err}</ErrorText>
        <Button variant="leaf" busy={busy} disabled={!canPlace} title={method === 'COD' ? 'Place order' : `Pay ${rs(shop.total)}`} onPress={place} />
      </Card>
    </ScrollView>
  );
}

function Row({ l, r, bold }: { l: string; r: string; bold?: boolean }) {
  return (
    <View className="flex-row justify-between">
      <Text className={`${bold ? 'text-lg font-extrabold' : 'text-[15px]'} text-ink`}>{l}</Text>
      <Text className={`${bold ? 'text-lg font-extrabold' : 'text-[15px]'} text-ink`}>{r}</Text>
    </View>
  );
}
