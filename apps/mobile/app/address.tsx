import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { Button, ErrorText, Field } from '@/components/ui';
import { errMsg, useData } from '@/lib/data';
import { useShop } from '@/lib/shop';

export default function AddressScreen() {
  const { client } = useData();
  const shop = useShop();
  const [label, setLabel] = React.useState('Home');
  const [line1, setLine1] = React.useState('');
  const [line2, setLine2] = React.useState('');
  const [pincode, setPincode] = React.useState('');
  const [loc, setLoc] = React.useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function locate() {
    setErr(null);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return setErr('Location permission was not given — the pincode will be used');
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setLoc({ lat: p.coords.latitude, lng: p.coords.longitude });
  }
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const a = await client.saveAddress({ label, line1, line2, pincode, location: loc });
      shop.chooseAddress(a.id);
      shop.reloadProfile();
      router.back();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
      {shop.profile?.addresses.length ? (
        <View className="gap-2">
          <Text className="text-sm font-bold text-muted">Saved addresses</Text>
          {shop.profile.addresses.map((a) => (
            <Pressable key={a.id} onPress={() => { shop.chooseAddress(a.id); router.back(); }} className={`rounded-xl border p-3 ${shop.address?.id === a.id ? 'border-kum' : 'border-line'}`}>
              <Text className="font-bold text-ink">{a.label}</Text>
              <Text className="text-sm text-muted">{a.line1}, {a.city} {a.pincode}</Text>
            </Pressable>
          ))}
          <Text className="mt-3 text-sm font-bold text-muted">Or add a new one</Text>
        </View>
      ) : null}
      <View className="flex-row gap-2">
        {['Home', 'Work', 'Other'].map((l) => (
          <Pressable key={l} onPress={() => setLabel(l)} className={`h-9 justify-center rounded-full border px-4 ${label === l ? 'border-kum bg-kum' : 'border-line'}`}>
            <Text className={label === l ? 'font-semibold text-white' : 'font-semibold text-ink'}>{l}</Text>
          </Pressable>
        ))}
      </View>
      <Field label="House / flat, street" value={line1} onChangeText={setLine1} />
      <Field label="Landmark (optional)" value={line2} onChangeText={setLine2} />
      <Field label="Pincode" keyboardType="number-pad" maxLength={6} value={pincode} onChangeText={(t) => setPincode(t.replace(/\D/g, ''))} />
      <Button variant="outline" title={loc ? 'Location set ✓' : 'Use my location'} onPress={locate} />
      <ErrorText>{err}</ErrorText>
      <Button title="Save address" busy={busy} disabled={line1.trim().length < 4 || pincode.length !== 6} onPress={save} />
    </ScrollView>
  );
}
