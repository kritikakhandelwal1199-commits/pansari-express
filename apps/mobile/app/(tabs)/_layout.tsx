import { Tabs } from 'expo-router';
import { House, Package, ShoppingBag, User } from 'lucide-react-native';
import { useShop } from '@/lib/shop';

export default function TabsLayout() {
  const { count } = useShop();
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#a3122b', tabBarInactiveTintColor: '#7a6352', headerStyle: { backgroundColor: '#fbf6ee' }, headerTintColor: '#23140b', sceneStyle: { backgroundColor: '#fbf6ee' } }}>
      <Tabs.Screen name="index" options={{ title: 'Shop', headerShown: false, tabBarIcon: ({ color, size }) => <House color={color} size={size} /> }} />
      <Tabs.Screen name="cart" options={{ title: 'Cart', tabBarBadge: count || undefined, tabBarBadgeStyle: { backgroundColor: '#2f7a35' }, tabBarIcon: ({ color, size }) => <ShoppingBag color={color} size={size} /> }} />
      <Tabs.Screen name="orders" options={{ title: 'Orders', tabBarIcon: ({ color, size }) => <Package color={color} size={size} /> }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: ({ color, size }) => <User color={color} size={size} /> }} />
    </Tabs>
  );
}
