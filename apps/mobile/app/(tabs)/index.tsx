import * as React from 'react';
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Link, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bike, ChevronDown, MapPin, MessageCircleQuestion, Search } from 'lucide-react-native';
import { CATEGORY_LABELS } from '@pansari/shared';
import type { InventoryRow } from '@pansari/client';
import { QtyButton } from '@/components/QtyButton';
import { rs } from '@/components/ui';
import { useShop } from '@/lib/shop';

const TILE: Record<string, string> = { preg: 'bg-[#fde7ea]', pooja: 'bg-[#fff1cc]', shaadi: 'bg-[#fbe3d3]', dry: 'bg-[#efe3d3]', home: 'bg-[#e3f1df]' };

function Product({ r }: { r: InventoryRow }) {
  const off = r.mrp > r.sellingPrice ? Math.round(((r.mrp - r.sellingPrice) / r.mrp) * 100) : 0;
  return (
    <View className="m-1.5 flex-1 rounded-2xl border border-line bg-surface p-2.5">
      <View className={`h-24 items-center justify-center rounded-xl ${TILE[r.product.category] ?? 'bg-surface-2'}`}>
        <Text className="text-xs font-bold text-muted">{CATEGORY_LABELS[r.product.category as keyof typeof CATEGORY_LABELS] ?? ''}</Text>
        <Text className="mt-1 rounded-md bg-white/80 px-1.5 text-xs font-bold text-ink">{r.product.netQuantity}</Text>
        {off >= 5 ? <Text className="absolute left-1.5 top-1.5 overflow-hidden rounded-md bg-[#2f6fd6] px-1.5 text-[11px] font-extrabold text-white">{off}% OFF</Text> : null}
      </View>
      <Text numberOfLines={2} className="mt-2 min-h-[36px] text-[14px] font-bold leading-snug text-ink">
        {r.product.name}
      </Text>
      <Text numberOfLines={1} className="text-xs text-muted">{r.product.nameHi ?? ' '}</Text>
      <View className="mt-2 flex-row items-end justify-between">
        <View>
          <Text className="text-[15px] font-extrabold text-ink">{rs(r.sellingPrice)}</Text>
          {off ? <Text className="text-xs text-muted line-through">{rs(r.mrp)}</Text> : null}
        </View>
        <QtyButton row={r} />
      </View>
    </View>
  );
}

export default function Shop() {
  const shop = useShop();
  const [q, setQ] = React.useState('');
  const [cat, setCat] = React.useState('');
  const list = shop.catalog.filter((r) => (!cat || r.product.category === cat) && (!q || `${r.product.name} ${r.product.nameHi ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const ok = shop.check?.serviceable;

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-bg">
      <View className="flex-row items-center justify-between border-b border-line px-4 py-2.5">
        <Pressable accessibilityRole="button" accessibilityLabel="Change delivery location" onPress={() => router.push(shop.isCustomer ? '/address' : '/login')} className="flex-1 flex-row items-center gap-2">
          <View className={`h-10 w-10 items-center justify-center rounded-xl ${ok ? 'bg-[#e3f1df]' : 'bg-[#fde7ea]'}`}>
            <MapPin color={ok ? '#2f7a35' : '#b3261e'} size={20} />
          </View>
          <View className="flex-1">
            <Text className={`text-[15px] font-extrabold ${ok ? 'text-ink' : 'text-danger'}`}>{ok ? `Delivery in ${shop.check?.etaMinutes ?? 10} min` : shop.check ? 'Not delivering here yet' : 'Checking…'}</Text>
            <View className="flex-row items-center">
              <Text numberOfLines={1} className="text-xs text-muted">{shop.address ? `${shop.address.label} · ${shop.address.line1}` : 'Pincode 302003 · sign in to set address'}</Text>
              <ChevronDown color="#7a6352" size={12} />
            </View>
          </View>
        </Pressable>
        <Link href="/help" asChild>
          <Pressable accessibilityLabel="Help" className="h-10 w-10 items-center justify-center rounded-xl bg-kum">
            <MessageCircleQuestion color="#fff" size={20} />
          </Pressable>
        </Link>
      </View>

      <FlatList
        data={list}
        keyExtractor={(r) => r.productId}
        numColumns={2}
        contentContainerStyle={{ padding: 10, paddingBottom: shop.count ? 90 : 24 }}
        refreshing={shop.catalogLoading}
        onRefresh={shop.reloadCatalog}
        ListHeaderComponent={
          <View className="gap-3 px-1.5 pb-2">
            <View className="flex-row items-center gap-3 rounded-3xl bg-kum p-4">
              <View className="flex-1">
                <Text className="text-xl font-bold text-haldi">Pooja to pantry, at your door.</Text>
                <Text className="mt-1 text-[13px] text-white/90">From {shop.check?.storeName ?? 'your nearest store'}{shop.check?.freeDeliveryAbove ? ` · free delivery above ${rs(shop.check.freeDeliveryAbove)}` : ''}</Text>
              </View>
              <View className="items-center rounded-2xl bg-white/10 px-3 py-2">
                <Bike color="#f2b705" size={22} />
                <Text className="text-lg font-extrabold text-white">{shop.check?.etaMinutes ?? '—'} min</Text>
              </View>
            </View>
            <View className="h-12 flex-row items-center rounded-xl border border-line bg-surface px-3">
              <Search color="#7a6352" size={16} />
              <TextInput value={q} onChangeText={setQ} placeholder="Search kesar, kaju, kapur…" placeholderTextColor="#b3a090" className="ml-2 flex-1 text-base text-ink" accessibilityLabel="Search products" />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {[['', 'All'], ...Object.entries(CATEGORY_LABELS)].map(([k, v]) => (
                <Pressable key={k} onPress={() => setCat(k!)} className={`h-9 justify-center rounded-full border px-3.5 ${cat === k ? 'border-kum bg-kum' : 'border-line bg-surface'}`}>
                  <Text className={`text-[13px] font-semibold ${cat === k ? 'text-white' : 'text-ink'}`}>{v}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        }
        renderItem={({ item }) => <Product r={item} />}
        ListEmptyComponent={shop.catalogLoading ? undefined : <Text className="py-10 text-center text-muted">No items match.</Text>}
      />

      {shop.count > 0 ? (
        <Link href="/cart" asChild>
          <Pressable className="absolute bottom-3 left-3 right-3 flex-row items-center justify-between rounded-2xl bg-leaf px-4 py-3.5">
            <Text className="font-bold text-white">
              {shop.count} item{shop.count === 1 ? '' : 's'} · {rs(shop.itemsTotal)}
            </Text>
            <Text className="font-extrabold text-white">View cart ›</Text>
          </Pressable>
        </Link>
      ) : null}
    </SafeAreaView>
  );
}
