'use client';
import * as React from 'react';
import { MapPin as MapPinIcon, Pencil, Plus, Search } from 'lucide-react';
import { LiveMap, type MapPin, type MapZone } from '@/components/map';
import { parseZoneGeometry, rectangleGeometry } from '@pansari/shared';
import { ErrorNote, useToast } from '@/components/common';
import { PageHead } from '@/components/seller';
import { Badge, Button, Card, CardTitle, Dialog, DialogContent, Field, Input, Segmented, Skeleton, Textarea } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { DeliveryCheck, StoreInfo, ZoneRow } from '@/lib/data/types';
import { errMsg, rs, toPaise } from '@/lib/utils';

/** Real map: zones (hovered one highlighted), stores, and the last checked point. Click to check a spot. */
function ZoneMap({ zones, stores, highlight, check, onPick }: { zones: ZoneRow[]; stores: StoreInfo[]; highlight?: string | null; check: { lat: number; lng: number } | null; onPick: (p: { lat: number; lng: number }) => void }) {
  const mz: MapZone[] = zones.map((z) => ({ id: z.zoneId, name: z.name, geometryJson: z.geometryJson, active: z.isActive, highlight: highlight === z.zoneId }));
  const pins: MapPin[] = stores.filter((s) => s.location).map((s) => ({ id: s.storeId, lat: s.location!.lat, lng: s.location!.lng, kind: 'store', label: s.name }));
  if (check) pins.push({ id: 'check', lat: check.lat, lng: check.lng, kind: 'check', label: 'Checked address' });
  return (
    <div className="grid gap-1">
      <LiveMap zones={mz} pins={pins} height={420} onPick={onPick} label="Map of delivery zones and stores. Click anywhere to check delivery there." />
      <p className="text-[13px] text-muted">Tip: click anywhere on the map to check if we deliver there.</p>
    </div>
  );
}

interface Form {
  zoneId?: string;
  name: string;
  storeIds: string[];
  fee: string;
  freeAbove: string;
  surge: string;
  isActive: boolean;
  mode: 'box' | 'geojson';
  box: { south: string; west: string; north: string; east: string };
  geojson: string;
}

function rectOf(json: string): Form['box'] | null {
  try {
    const g = parseZoneGeometry(json);
    if (g.type !== 'Polygon' || g.coordinates.length !== 1 || g.coordinates[0]!.length !== 5) return null;
    const r = g.coordinates[0]!;
    const lats = [...new Set(r.map((p) => p[1]))];
    const lngs = [...new Set(r.map((p) => p[0]))];
    if (lats.length !== 2 || lngs.length !== 2) return null;
    return { south: String(Math.min(...lats)), north: String(Math.max(...lats)), west: String(Math.min(...lngs)), east: String(Math.max(...lngs)) };
  } catch {
    return null;
  }
}

export default function ZonesPage() {
  const data = useData();
  const toast = useToast();
  const zones = useResource(() => data.listZones(), [data]);
  const stores = useResource(() => data.listStores(), [data]);
  const [form, setForm] = React.useState<Form | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [hover, setHover] = React.useState<string | null>(null);
  const [probe, setProbe] = React.useState('');
  const [probeOut, setProbeOut] = React.useState<DeliveryCheck | null>(null);
  const delivering = (stores.data ?? []).filter((s) => s.type !== 'WAREHOUSE');
  const name = (id: string) => stores.data?.find((s) => s.storeId === id)?.name ?? id;

  function open(z?: ZoneRow) {
    setErr(null);
    if (!z) {
      setForm({ name: '', storeIds: [], fee: '25', freeAbove: '499', surge: '1.0', isActive: true, mode: 'box', box: { south: '', west: '', north: '', east: '' }, geojson: '' });
      return;
    }
    const box = rectOf(z.geometryJson);
    setForm({ zoneId: z.zoneId, name: z.name, storeIds: [...z.storeIds], fee: String(z.baseDeliveryFee / 100), freeAbove: String(z.freeDeliveryAbove / 100), surge: (z.surgeMultiplierBps / 10_000).toFixed(2), isActive: z.isActive, mode: box ? 'box' : 'geojson', box: box ?? { south: '', west: '', north: '', east: '' }, geojson: JSON.stringify(JSON.parse(z.geometryJson), null, 1) });
  }
  async function save() {
    if (!form) return;
    setBusy(true);
    setErr(null);
    try {
      const geometryJson = form.mode === 'box' ? rectangleGeometry(Number(form.box.south), Number(form.box.west), Number(form.box.north), Number(form.box.east)) : form.geojson.trim();
      await data.saveZone({ zoneId: form.zoneId, name: form.name, storeIds: form.storeIds, geometryJson, baseDeliveryFee: toPaise(form.fee) ?? -1, freeDeliveryAbove: toPaise(form.freeAbove) ?? -1, surgeMultiplierBps: Math.round(Number(form.surge) * 10_000), isActive: form.isActive });
      toast({ tone: 'good', text: `Zone “${form.name}” saved` });
      setForm(null);
      zones.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  const [checkPt, setCheckPt] = React.useState<{ lat: number; lng: number } | null>(null);
  async function test(text = probe) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
    setCheckPt(m ? { lat: Number(m[1]), lng: Number(m[2]) } : null);
    setProbeOut(await data.checkDelivery(m ? { pincode: '000000', location: { lat: Number(m[1]), lng: Number(m[2]) } } : { pincode: text.trim() }).catch(() => null));
  }
  function pick(p: { lat: number; lng: number }) {
    const t = `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
    setProbe(t);
    void test(t);
  }

  return (
    <>
      <PageHead
        title="Delivery zones"
        sub="Customers inside an active zone can order from its stores. The fee and surge here are what the shop charges at checkout."
        actions={
          <Button size="sm" variant="haldi" onClick={() => open()}>
            <Plus className="size-4" /> New zone
          </Button>
        }
      />
      {zones.loading && !zones.data ? <Skeleton className="h-64 rounded-2xl" /> : null}
      {zones.error ? <ErrorNote>{zones.error}</ErrorNote> : null}
      {zones.data ? (
        <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
          <div className="grid content-start gap-3">
            <ZoneMap zones={zones.data} stores={delivering} highlight={hover} check={checkPt} onPick={pick} />
            <Card className="grid gap-2">
              <CardTitle>Check an address</CardTitle>
              <div className="flex gap-2">
                <Input value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="Pincode, or lat, lng (26.91, 75.74)" onKeyDown={(e) => e.key === 'Enter' && test()} />
                <Button variant="outline" onClick={() => test()} aria-label="Check">
                  <Search className="size-4" />
                </Button>
              </div>
              {probeOut ? (
                <p className="text-sm">
                  {probeOut.serviceable ? (
                    <>
                      <b className="text-leaf">Delivers</b> from {probeOut.storeName} · about {probeOut.etaMinutes} min · fee {rs(probeOut.baseDeliveryFee)} (free above {rs(probeOut.freeDeliveryAbove)})
                    </>
                  ) : (
                    <b className="text-danger">{{ OUTSIDE_ZONES: 'Outside every active zone', NO_STORE_IN_ZONE: 'Zone has no open store', TOO_FAR: `Inside a zone, but ${probeOut.storeName ?? 'the store'} is too far`, UNKNOWN_PINCODE: 'Pincode not known — try lat, lng', OK: '' }[probeOut.reason]}</b>
                  )}
                </p>
              ) : null}
            </Card>
          </div>
          <div className="grid content-start gap-3">
            {zones.data.map((z) => (
              <Card key={z.zoneId} className="grid gap-2" onMouseEnter={() => setHover(z.zoneId)} onMouseLeave={() => setHover(null)}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle>{z.name}</CardTitle>
                    <div className="mt-1 flex items-center gap-1 text-sm text-muted">
                      <MapPinIcon className="size-4" /> {z.storeIds.map(name).join(', ')}
                    </div>
                  </div>
                  <Badge tone={z.isActive ? 'good' : 'neutral'}>{z.isActive ? 'Active' : 'Paused'}</Badge>
                </div>
                <div className="num text-sm">
                  Fee {rs(z.baseDeliveryFee)} · free above {z.freeDeliveryAbove ? rs(z.freeDeliveryAbove) : '—'} · surge {(z.surgeMultiplierBps / 10_000).toFixed(2)}×
                </div>
                <Button size="sm" variant="outline" className="w-fit" onClick={() => open(z)}>
                  <Pencil className="size-4" /> Edit
                </Button>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent wide title={form?.zoneId ? `Edit ${form.name}` : 'New delivery zone'}>
          {form ? (
            <div className="grid gap-3">
              <Field label="Zone name">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} placeholder="Vaishali Nagar" />
              </Field>
              <fieldset className="grid gap-1.5">
                <legend className="text-sm font-semibold text-muted">Stores that deliver here (nearest one is used)</legend>
                {delivering.map((s) => (
                  <label key={s.storeId} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4" checked={form.storeIds.includes(s.storeId)} onChange={() => setForm({ ...form, storeIds: form.storeIds.includes(s.storeId) ? form.storeIds.filter((x) => x !== s.storeId) : [...form.storeIds, s.storeId] })} />
                    {s.name}
                  </label>
                ))}
              </fieldset>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Delivery fee ₹">
                  <Input inputMode="decimal" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} />
                </Field>
                <Field label="Free above ₹" hint="0 = never free">
                  <Input inputMode="decimal" value={form.freeAbove} onChange={(e) => setForm({ ...form, freeAbove: e.target.value })} />
                </Field>
                <Field label="Surge ×" hint="1.0 to 3.0">
                  <Input inputMode="decimal" value={form.surge} onChange={(e) => setForm({ ...form, surge: e.target.value })} />
                </Field>
              </div>
              <div className="grid gap-2">
                <span className="text-sm font-semibold text-muted">Area</span>
                <Segmented value={form.mode} onChange={(m) => setForm({ ...form, mode: m })} options={[{ value: 'box', label: 'Rectangle' }, { value: 'geojson', label: 'GeoJSON outline' }]} />
                {form.mode === 'box' ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(['south', 'north', 'west', 'east'] as const).map((k) => (
                      <Field key={k} label={`${k[0]!.toUpperCase()}${k.slice(1)} (${k === 'south' || k === 'north' ? 'lat' : 'lng'})`}>
                        <Input inputMode="decimal" value={form.box[k]} onChange={(e) => setForm({ ...form, box: { ...form.box, [k]: e.target.value } })} placeholder={k === 'south' || k === 'north' ? '26.88' : '75.70'} />
                      </Field>
                    ))}
                  </div>
                ) : (
                  <Field label="Polygon or MultiPolygon, [lng, lat] order" hint="Draw it on geojson.io and paste the geometry here.">
                    <Textarea rows={6} className="num text-[13px]" value={form.geojson} onChange={(e) => setForm({ ...form, geojson: e.target.value })} />
                  </Field>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" className="size-4" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Taking orders in this zone
              </label>
              {err ? <ErrorNote>{err}</ErrorNote> : null}
              <Button size="lg" disabled={busy} onClick={save}>
                Save zone
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
