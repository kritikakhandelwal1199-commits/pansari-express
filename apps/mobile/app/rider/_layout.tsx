import { Tabs } from 'expo-router';
import { Bike, IdCard, Wallet } from 'lucide-react-native';
import { RoleGate, SignOutButton } from '@/components/role';

const tab = { tabBarActiveTintColor: '#a3122b', tabBarInactiveTintColor: '#7a6352', headerStyle: { backgroundColor: '#fbf6ee' }, headerTintColor: '#23140b', sceneStyle: { backgroundColor: '#fbf6ee' }, headerRight: () => <SignOutButton /> };

export default function RiderLayout() {
  return (
    <RoleGate roles={['rider']}>
      <Tabs screenOptions={tab}>
        <Tabs.Screen name="index" options={{ title: 'Deliveries', tabBarIcon: ({ color, size }) => <Bike color={color} size={size} /> }} />
        <Tabs.Screen name="cash" options={{ title: 'Cash & pay', tabBarIcon: ({ color, size }) => <Wallet color={color} size={size} /> }} />
        <Tabs.Screen name="kyc" options={{ title: 'Documents', tabBarIcon: ({ color, size }) => <IdCard color={color} size={size} /> }} />
      </Tabs>
    </RoleGate>
  );
}
