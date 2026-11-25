import { Tabs } from 'expo-router';
import { BadgeCheck, Bike, Boxes, Users } from 'lucide-react-native';
import { RoleGate, SignOutButton, StoreProvider } from '@/components/role';

const tab = { tabBarActiveTintColor: '#a3122b', tabBarInactiveTintColor: '#7a6352', headerStyle: { backgroundColor: '#fbf6ee' }, headerTintColor: '#23140b', sceneStyle: { backgroundColor: '#fbf6ee' }, headerRight: () => <SignOutButton /> };

export default function OwnerLayout() {
  return (
    <RoleGate roles={['seller']}>
      <StoreProvider>
        <Tabs screenOptions={tab}>
          <Tabs.Screen name="index" options={{ title: 'Online orders', tabBarIcon: ({ color, size }) => <Bike color={color} size={size} /> }} />
          <Tabs.Screen name="riders" options={{ title: 'Riders & cash', tabBarIcon: ({ color, size }) => <Users color={color} size={size} /> }} />
          <Tabs.Screen name="stock" options={{ title: 'Stock', tabBarIcon: ({ color, size }) => <Boxes color={color} size={size} /> }} />
          <Tabs.Screen name="kyc" options={{ title: 'Business KYC', tabBarIcon: ({ color, size }) => <BadgeCheck color={color} size={size} /> }} />
        </Tabs>
      </StoreProvider>
    </RoleGate>
  );
}
