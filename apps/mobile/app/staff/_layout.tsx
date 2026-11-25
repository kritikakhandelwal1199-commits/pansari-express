import { Tabs } from 'expo-router';
import { ClipboardCheck, PackageCheck, PackagePlus, SprayCan } from 'lucide-react-native';
import { RoleGate, SignOutButton, StoreProvider } from '@/components/role';

const tab = { tabBarActiveTintColor: '#a3122b', tabBarInactiveTintColor: '#7a6352', headerStyle: { backgroundColor: '#fbf6ee' }, headerTintColor: '#23140b', sceneStyle: { backgroundColor: '#fbf6ee' }, headerRight: () => <SignOutButton /> };

export default function StaffLayout() {
  return (
    <RoleGate roles={['staff', 'seller']}>
      <StoreProvider>
        <Tabs screenOptions={tab}>
          <Tabs.Screen name="index" options={{ title: 'Pick & pack', tabBarIcon: ({ color, size }) => <PackageCheck color={color} size={size} /> }} />
          <Tabs.Screen name="receive" options={{ title: 'Receive stock', tabBarIcon: ({ color, size }) => <PackagePlus color={color} size={size} /> }} />
          <Tabs.Screen name="count" options={{ title: 'Shelf count', tabBarIcon: ({ color, size }) => <ClipboardCheck color={color} size={size} /> }} />
          <Tabs.Screen name="hygiene" options={{ title: 'Hygiene', tabBarIcon: ({ color, size }) => <SprayCan color={color} size={size} /> }} />
        </Tabs>
      </StoreProvider>
    </RoleGate>
  );
}
