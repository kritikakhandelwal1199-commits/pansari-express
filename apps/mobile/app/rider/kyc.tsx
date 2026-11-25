import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { RIDER_KYC_DOCS, RIDER_VEHICLES, type RiderVehicle } from '@pansari/shared';
import { KYC_STATUS, KycUploader, Picker } from '@/components/role';
import { Badge, Button, Card, ErrorText, Field } from '@/components/ui';
import { errMsg, useData, useResource } from '@/lib/data';

const VEHICLE: Record<RiderVehicle, string> = { BICYCLE: 'Bicycle', SCOOTER: 'Scooter', MOTORCYCLE: 'Motorcycle', EV: 'Electric scooter / bike' };

export default function RiderKyc() {
  const { client } = useData();
  const me = useResource(() => client.myRider(), [client]);
  const [f, setF] = React.useState<{ name: string; vehicleType: RiderVehicle; vehicleNumber: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => {
    if (me.data && !f) setF({ name: me.data.name, vehicleType: me.data.vehicleType, vehicleNumber: me.data.vehicleNumber ?? '' });
  }, [me.data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!f) return;
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await client.saveRiderProfile({ name: f.name, vehicleType: f.vehicleType, vehicleNumber: f.vehicleType === 'BICYCLE' ? null : f.vehicleNumber });
      setSaved(true);
      me.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  if (me.error) return <View className="p-6"><ErrorText>{me.error}</ErrorText></View>;
  if (!me.data || !f) return null;
  const k = KYC_STATUS[me.data.kycStatus];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View className="flex-row items-center justify-between">
        <Text className="text-xl font-extrabold text-ink">My documents</Text>
        <Badge label={k.label} tone={k.tone} />
      </View>
      <Card className="gap-3">
        <Text className="text-[16px] font-bold text-ink">About you</Text>
        <Field label="Name (as on driving licence)" value={f.name} onChangeText={(t) => setF({ ...f, name: t })} maxLength={60} />
        <Picker label="Vehicle" value={f.vehicleType} options={RIDER_VEHICLES.map((v) => ({ value: v, label: VEHICLE[v] }))} onChange={(v) => setF({ ...f, vehicleType: v as RiderVehicle })} />
        {f.vehicleType !== 'BICYCLE' ? <Field label="Vehicle number" autoCapitalize="characters" placeholder="RJ14 CK 4821" maxLength={14} value={f.vehicleNumber} onChangeText={(t) => setF({ ...f, vehicleNumber: t.toUpperCase() })} /> : null}
        <ErrorText>{err}</ErrorText>
        {saved ? <Text className="text-sm font-semibold text-leaf">Saved</Text> : null}
        <Button title="Save" busy={busy} onPress={save} />
      </Card>
      <Text className="text-sm text-muted">Clear photos, under 10 MB. The compliance team checks them; you can go on shift once all three are verified. Only upload a masked Aadhaar.</Text>
      <KycUploader required={RIDER_KYC_DOCS} onChanged={me.reload} />
    </ScrollView>
  );
}
