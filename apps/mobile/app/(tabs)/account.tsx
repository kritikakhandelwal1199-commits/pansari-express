import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Button, Card, ErrorText, rs } from '@/components/ui';
import { errMsg, useData, useResource } from '@/lib/data';
import { useShop } from '@/lib/shop';
import { landing, ROLE_LABEL } from '@/lib/roles';

export default function Account() {
  const { client, user } = useData();
  const shop = useShop();
  const txns = useResource(() => (shop.isCustomer ? client.walletTxns() : Promise.resolve([])), [client, shop.isCustomer, shop.profile?.walletBalance]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  useFocusEffect(React.useCallback(() => shop.reloadProfile(), [])); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shop.isCustomer)
    return (
      <View className="flex-1 items-center justify-center gap-3 p-6">
        <Text className="text-lg font-bold text-ink">{user && !user.isAnonymous ? `Signed in as ${ROLE_LABEL[user.role] ?? user.role}` : 'Sign in to your account'}</Text>
        <Text className="text-center text-muted">{user && !user.isAnonymous ? 'Your work tools are in your own app.' : 'Track orders, save addresses and use your wallet. Shop staff, riders and admins sign in here too.'}</Text>
        {user && !user.isAnonymous ? <Button title="Open my app" onPress={() => router.replace(landing(user.role))} /> : null}
        <Button variant={user && !user.isAnonymous ? 'outline' : 'kum'} title={user && !user.isAnonymous ? 'Switch account' : 'Sign in'} onPress={() => router.push('/login')} />
      </View>
    );

  async function add(amount: number) {
    setBusy(true);
    setErr(null);
    try {
      await client.topUpWallet(amount);
      shop.reloadProfile();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      <Card className="gap-1">
        <Text className="text-lg font-bold text-ink">{shop.profile?.displayName ?? 'Customer'}</Text>
        <Text className="text-muted">{user?.phone}</Text>
      </Card>
      <Card className="gap-3">
        <Text className="text-[16px] font-bold text-ink">Pansari wallet</Text>
        <Text className="text-3xl font-extrabold text-ink">{rs(shop.profile?.walletBalance ?? 0)}</Text>
        <View className="flex-row gap-2">
          {[20000, 50000, 100000].map((a) => (
            <Button key={a} variant="outline" className="flex-1" busy={busy} title={`+ ${rs(a).replace('.00', '')}`} onPress={() => add(a)} />
          ))}
        </View>
        <Text className="text-xs text-muted">Test mode: adding money simulates a UPI payment.</Text>
        <ErrorText>{err}</ErrorText>
        {txns.data?.slice(0, 6).map((t) => (
          <View key={t.id} className="flex-row justify-between border-t border-line pt-2">
            <Text className="flex-1 text-sm text-ink">{t.note ?? t.kind}</Text>
            <Text className={`text-sm font-bold ${t.amount > 0 ? 'text-leaf' : 'text-ink'}`}>{`${t.amount > 0 ? '+' : '−'}${rs(Math.abs(t.amount))}`}</Text>
          </View>
        ))}
      </Card>
      <Card className="gap-2">
        <Text className="text-[16px] font-bold text-ink">Addresses</Text>
        {shop.profile?.addresses.map((a) => (
          <Pressable key={a.id} onPress={() => shop.chooseAddress(a.id)} className={`rounded-xl border p-3 ${shop.address?.id === a.id ? 'border-kum' : 'border-line'}`}>
            <Text className="font-bold text-ink">{a.label}</Text>
            <Text className="text-sm text-muted">{a.line1}, {a.city} {a.pincode}</Text>
          </Pressable>
        ))}
        <Button variant="outline" title="Add address" onPress={() => router.push('/address')} />
      </Card>
      <Button variant="ghost" title="Sign out" onPress={() => void client.signOut()} />
    </ScrollView>
  );
}
