import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, ErrorText, Field } from '@/components/ui';
import { errMsg, useData } from '@/lib/data';

export default function Login() {
  const { client } = useData();
  const [phone, setPhone] = React.useState('');
  const [code, setCode] = React.useState('');
  const [vid, setVid] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const e164 = (v: string) => `+91${v.replace(/\D/g, '').slice(-10)}`;

  async function go(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  const done = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Text className="text-2xl font-extrabold text-kum">Pansari Express</Text>
      <Text className="text-muted">Sign in with your mobile number. Demo OTP is 123456.</Text>
      {!vid ? (
        <>
          <Field label="Mobile number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} placeholder="98XXXXXXXX" autoFocus />
          <Button title="Send OTP" busy={busy} disabled={phone.replace(/\D/g, '').length < 10} onPress={() => go(async () => setVid((await client.sendOtp(e164(phone))).verificationId))} />
        </>
      ) : (
        <>
          <Field label={`OTP sent to ${e164(phone)}`} keyboardType="number-pad" maxLength={6} value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ''))} autoFocus />
          <Button title="Verify and continue" busy={busy} disabled={code.length !== 6} onPress={() => go(async () => { await client.verifyOtp(vid, code); done(); })} />
          <Pressable onPress={() => setVid(null)}><Text className="text-center font-semibold text-muted underline">Use a different number</Text></Pressable>
        </>
      )}
      <ErrorText>{err}</ErrorText>
      {client.demoAccounts ? (
        <View className="mt-4 gap-2">
          <Text className="text-sm font-bold text-muted">Demo customer — one tap</Text>
          <Pressable
            onPress={() => go(async () => { const r = await client.sendOtp('+919999999994'); await client.verifyOtp(r.verificationId, '123456'); done(); })}
            className="rounded-2xl border border-line bg-surface p-4"
          >
            <Text className="font-bold text-ink">Customer · Priya</Text>
            <Text className="text-[13px] text-muted">Saved address in Johari Bazaar, ₹200 wallet</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}
