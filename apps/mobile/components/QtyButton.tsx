import { Pressable, Text, View } from 'react-native';
import type { InventoryRow } from '@pansari/client';
import { useShop } from '@/lib/shop';

export function QtyButton({ row }: { row: InventoryRow }) {
  const { cart, setQty } = useShop();
  const n = cart[row.productId] ?? 0;
  if (row.onHand <= 0) return <Text className="text-xs font-semibold text-muted">Out of stock</Text>;
  if (!n)
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`Add ${row.product.name}`} onPress={() => setQty(row.productId, 1)} className="h-9 items-center justify-center rounded-xl border border-leaf bg-surface px-4">
        <Text className="font-extrabold text-leaf">ADD</Text>
      </Pressable>
    );
  return (
    <View className="h-9 flex-row items-center overflow-hidden rounded-xl bg-leaf">
      <Pressable accessibilityLabel="One less" onPress={() => setQty(row.productId, n - 1)} className="h-9 w-9 items-center justify-center">
        <Text className="text-lg font-bold text-white">−</Text>
      </Pressable>
      <Text className="min-w-6 text-center font-bold text-white">{n}</Text>
      <Pressable accessibilityLabel="One more" disabled={n >= Math.floor(row.onHand)} onPress={() => setQty(row.productId, n + 1)} className="h-9 w-9 items-center justify-center">
        <Text className="text-lg font-bold text-white">+</Text>
      </Pressable>
    </View>
  );
}
