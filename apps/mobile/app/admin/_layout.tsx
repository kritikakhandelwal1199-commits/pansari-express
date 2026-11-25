import { Tabs } from 'expo-router';
import { FileCheck2, History, LayoutGrid, Map, Percent, Users } from 'lucide-react-native';
import { RoleGate, SignOutButton } from '@/components/role';

const tab = { tabBarActiveTintColor: '#a3122b', tabBarInactiveTintColor: '#7a6352', headerStyle: { backgroundColor: '#fbf6ee' }, headerTintColor: '#23140b', sceneStyle: { backgroundColor: '#fbf6ee' }, headerRight: () => <SignOutButton />, tabBarLabelStyle: { fontSize: 10 } };

export default function AdminLayout() {
  return (
    <RoleGate roles={['super_admin']}>
      <Tabs screenOptions={tab}>
        <Tabs.Screen name="index" options={{ title: 'Overview', tabBarIcon: ({ color, size }) => <LayoutGrid color={color} size={size} /> }} />
        <Tabs.Screen name="users" options={{ title: 'People', tabBarIcon: ({ color, size }) => <Users color={color} size={size} /> }} />
        <Tabs.Screen name="zones" options={{ title: 'Zones', tabBarIcon: ({ color, size }) => <Map color={color} size={size} /> }} />
        <Tabs.Screen name="hsn" options={{ title: 'GST master', tabBarIcon: ({ color, size }) => <Percent color={color} size={size} /> }} />
        <Tabs.Screen name="review" options={{ title: 'Listings', tabBarIcon: ({ color, size }) => <FileCheck2 color={color} size={size} /> }} />
        <Tabs.Screen name="audit" options={{ title: 'Audit', tabBarIcon: ({ color, size }) => <History color={color} size={size} /> }} />
      </Tabs>
    </RoleGate>
  );
}
