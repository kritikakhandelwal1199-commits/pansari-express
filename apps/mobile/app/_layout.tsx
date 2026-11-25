import '@/lib/polyfills';
import '../global.css';
import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DataProvider } from '@/lib/data';
import { ShopProvider } from '@/lib/shop';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <DataProvider
        fallback={
          <View className="flex-1 items-center justify-center bg-bg">
            <ActivityIndicator color="#a3122b" />
          </View>
        }
      >
        <ShopProvider>
          <Stack screenOptions={{ headerTintColor: '#a3122b', headerStyle: { backgroundColor: '#fbf6ee' }, contentStyle: { backgroundColor: '#fbf6ee' } }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="order/[id]" options={{ title: 'Order' }} />
            <Stack.Screen name="login" options={{ title: 'Sign in', presentation: 'modal' }} />
            <Stack.Screen name="address" options={{ title: 'Delivery address', presentation: 'modal' }} />
            <Stack.Screen name="help" options={{ title: 'Pansari help', presentation: 'modal' }} />
          </Stack>
        </ShopProvider>
      </DataProvider>
    </SafeAreaProvider>
  );
}
