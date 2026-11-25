'use client';
import * as React from 'react';
import { RIDER_KYC_DOCS, RIDER_VEHICLES, type RiderVehicle } from '@pansari/shared';
import { ErrorNote, useToast } from '@/components/common';
import { KYC_STATUS, KycUploader } from '@/components/phase4';
import { Badge, Button, Card, CardTitle, Field, Input, Select, Skeleton } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import { errMsg } from '@/lib/utils';

const VEHICLE: Record<RiderVehicle, string> = { BICYCLE: 'Bicycle', SCOOTER: 'Scooter', MOTORCYCLE: 'Motorcycle', EV: 'Electric scooter / bike' };

export default function RiderKyc() {
  const data = useData();
  const toast = useToast();
  const me = useResource(() => data.myRider(), [data]);
  const [f, setF] = React.useState<{ name: string; vehicleType: RiderVehicle; vehicleNumber: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (me.data && !f) setF({ name: me.data.name, vehicleType: me.data.vehicleType, vehicleNumber: me.data.vehicleNumber ?? '' });
  }, [me.data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      await data.saveRiderProfile({ name: f.name, vehicleType: f.vehicleType, vehicleNumber: f.vehicleType === 'BICYCLE' ? null : f.vehicleNumber });
      toast({ tone: 'good', text: 'Saved' });
      me.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (me.error) return <ErrorNote>{me.error}</ErrorNote>;
  if (!me.data || !f) return <Skeleton className="h-40 rounded-2xl" />;
  const kyc = KYC_STATUS[me.data.kycStatus];
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">My documents</h1>
        <Badge tone={kyc.tone}>{kyc.label}</Badge>
      </div>
      <Card className="grid gap-3">
        <CardTitle>About you</CardTitle>
        <Field label="Name (as on driving licence)">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Vehicle">
            <Select value={f.vehicleType} onChange={(e) => setF({ ...f, vehicleType: e.target.value as RiderVehicle })}>
              {RIDER_VEHICLES.map((v) => (
                <option key={v} value={v}>
                  {VEHICLE[v]}
                </option>
              ))}
            </Select>
          </Field>
          {f.vehicleType !== 'BICYCLE' ? (
            <Field label="Vehicle number">
              <Input value={f.vehicleNumber} onChange={(e) => setF({ ...f, vehicleNumber: e.target.value.toUpperCase() })} placeholder="RJ14 CK 4821" maxLength={14} />
            </Field>
          ) : null}
        </div>
        {err ? <ErrorNote>{err}</ErrorNote> : null}
        <Button disabled={busy} onClick={save} className="w-fit">
          Save
        </Button>
      </Card>
      <KycUploader required={RIDER_KYC_DOCS} title="Documents" sub="Clear photos or PDFs, under 10 MB. The compliance team checks them; you can go on shift once all three are verified. Only upload a masked Aadhaar." onChanged={me.reload} />
    </div>
  );
}
