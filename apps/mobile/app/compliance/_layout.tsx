import { Tabs } from 'expo-router';
import { FileCheck2, History, IdCard, Undo2 } from 'lucide-react-native';
import { RoleGate, SignOutButton } from '@/components/role';

const tab = { tabBarActiveTintColor: '#a3122b', tabBarInactiveTintColor: '#7a6352', headerStyle: { backgroundColor: '#fbf6ee' }, headerTintColor: '#23140b', sceneStyle: { backgroundColor: '#fbf6ee' }, headerRight: () => <SignOutButton /> };

export default function ComplianceLayout() {
  return (
    <RoleGate roles={['compliance', 'super_admin']}>
      <Tabs screenOptions={tab}>
        <Tabs.Screen name="index" options={{ title: 'KYC review', tabBarIcon: ({ color, size }) => <IdCard color={color} size={size} /> }} />
        <Tabs.Screen name="listings" options={{ title: 'Listings', tabBarIcon: ({ color, size }) => <FileCheck2 color={color} size={size} /> }} />
        <Tabs.Screen name="recalls" options={{ title: 'Recalls', tabBarIcon: ({ color, size }) => <Undo2 color={color} size={size} /> }} />
        <Tabs.Screen name="audit" options={{ title: 'Audit log', tabBarIcon: ({ color, size }) => <History color={color} size={size} /> }} />
      </Tabs>
    </RoleGate>
  );
}
