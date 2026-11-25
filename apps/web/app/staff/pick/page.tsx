'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Camera, Check, PackageCheck, TriangleAlert } from 'lucide-react';
import { matchScan, type PickLine } from '@pansari/shared';
import { CameraScanner } from '@/components/CameraScanner';
import { ErrorNote, useToast } from '@/components/common';
import { RiderPicker } from '@/components/phase4';
import { useStaffApp } from '@/components/staff';
import { Badge, Button, Card, Dialog, DialogContent, Field, Input, Skeleton } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import { ORDER_STATUS } from '@/lib/labels';
import { cn, errMsg, fmtDate } from '@/lib/utils';

function PickInner() {
  const id = useSearchParams().get('id') ?? '';
  const { storeId } = useStaffApp();
  const data = useData();
  const toast = useToast();
  const router = useRouter();
  const task = useResource(() => data.pickTask(id), [data, id]);
  const [done, setDone] = React.useState<Record<string, boolean>>({});
  const [code, setCode] = React.useState('');
  const [scan, setScan] = React.useState(false);
  const [missing, setMissing] = React.useState<PickLine | null>(null);
  const [missReason, setMissReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const started = React.useRef(false);
  const key = `pansari-pick-${id}`;

  // remember ticks if the picker's phone sleeps
  React.useEffect(() => {
    try {
      setDone(JSON.parse(sessionStorage.getItem(key) ?? '{}'));
    } catch {}
  }, [key]);
  React.useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(done));
    } catch {}
  }, [key, done]);

  // opening an accepted order starts picking
  React.useEffect(() => {
    const o = task.data?.order;
    if (!o || started.current || o.status !== 'ACCEPTED') return;
    started.current = true;
    data.advanceOrder(o.orderId, 'PICKING').then(task.reload, (e) => toast({ tone: 'bad', text: errMsg(e) }));
  }, [task.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = task.data?.lines ?? [];
  const order = task.data?.order;
  const ticked = lines.filter((l) => done[l.productId]).length;
  const all = lines.length > 0 && ticked === lines.length;

  function onCode(v: string) {
    const hit = matchScan(lines, v);
    if (!hit) {
      toast({ tone: 'bad', text: `Not in this order: ${v}` });
      return;
    }
    setDone((d) => ({ ...d, [hit.productId]: true }));
    toast({ tone: 'good', text: `${hit.name} × ${hit.qty}` });
  }
  async function packed() {
    if (!order) return;
    setBusy(true);
    try {
      await data.advanceOrder(order.orderId, 'PACKED');
      try {
        sessionStorage.removeItem(key);
      } catch {}
      toast({ tone: 'good', text: order.riderUid ? 'Packed — the rider can collect it now' : 'Packed' });
      router.push('/staff');
    } catch (e) {
      toast({ tone: 'bad', text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }
  async function cancel(reason: string) {
    if (!order) return;
    setBusy(true);
    setErr(null);
    try {
      await data.advanceOrder(order.orderId, 'CANCELLED', { reason });
      toast({ tone: 'good', text: 'Order cancelled · stock returned and any payment refunded to the wallet' });
      router.push('/staff');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (task.error) return <ErrorNote>{task.error}</ErrorNote>;
  if (!order) return <Skeleton className="h-64 rounded-2xl" />;
  const st = ORDER_STATUS[order.status];

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <Link href="/staff" className="inline-flex items-center gap-1 text-sm font-semibold text-muted">
          <ArrowLeft className="size-4" /> Queue
        </Link>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">
          Picked {ticked} of {lines.length}
        </h1>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-leaf transition-all" style={{ width: `${lines.length ? (ticked / lines.length) * 100 : 0}%` }} />
        </div>
        <p className="num mt-1 text-[13px] text-muted">#{order.orderId} · walk the shelves in this order</p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) onCode(code.trim());
          setCode('');
        }}
      >
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Scan or type barcode" inputMode="numeric" autoFocus />
        <Button type="button" variant="outline" size="icon" aria-label="Scan with camera" onClick={() => setScan((s) => !s)}>
          <Camera className="size-5" />
        </Button>
      </form>
      {scan ? (
        <CameraScanner
          onResult={(v) => {
            setScan(false);
            onCode(v);
          }}
        />
      ) : null}

      <ul className="grid gap-2">
        {lines.map((l) => {
          const ok = !!done[l.productId];
          return (
            <li key={l.productId}>
              <Card className={cn('grid gap-2 p-3 sm:p-4', ok && 'border-leaf/50 bg-leaf/5')}>
                <button type="button" className="flex items-start gap-3 text-left" onClick={() => setDone((d) => ({ ...d, [l.productId]: !d[l.productId] }))} aria-pressed={ok}>
                  <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border-2', ok ? 'border-leaf bg-leaf text-white' : 'border-line')}>{ok ? <Check className="size-4" /> : null}</span>
                  <span className="grid flex-1 gap-0.5">
                    <span className="num text-[13px] font-bold text-kum">{l.aisleBinCode || 'No bin set'}</span>
                    <span className="font-bold leading-tight">{l.name}</span>
                    <span className="num text-[13px] text-muted">
                      {l.batches.map((b) => `Batch ${b.batchNumber} × ${b.qty}${b.expiryMs ? ` (exp ${fmtDate(b.expiryMs, { month: 'short', year: '2-digit' })})` : ''}`).join(' · ')}
                    </span>
                  </span>
                  <span className="num text-2xl font-extrabold">×{l.qty}</span>
                </button>
                {!ok ? (
                  <button type="button" className="w-fit text-[13px] font-semibold text-danger underline" onClick={() => (setErr(null), setMissReason(`${l.name} is out of stock`), setMissing(l))}>
                    Not on the shelf?
                  </button>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>

      <RiderPicker order={order} storeId={storeId} onDone={task.reload} />
      <Button size="lg" variant="leaf" disabled={!all || busy || order.status !== 'PICKING'} onClick={packed}>
        <PackageCheck className="size-5" /> {all ? 'Bag sealed — mark packed' : `Tick all ${lines.length} items to finish`}
      </Button>

      <Dialog open={!!missing} onOpenChange={(v) => !v && setMissing(null)}>
        <DialogContent title="Item not on the shelf" description="If you cannot find it, cancel the order so the customer is told and refunded. Stock goes back to the batches and a stock count is worth doing for this item.">
          <p className="flex items-start gap-2 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" /> {missing?.name} × {missing?.qty} at {missing?.aisleBinCode || 'no bin'}
          </p>
          <Field label="Reason shown to the customer">
            <Input value={missReason} onChange={(e) => setMissReason(e.target.value)} maxLength={140} />
          </Field>
          {err ? <ErrorNote>{err}</ErrorNote> : null}
          <Button variant="destructive" disabled={busy || missReason.trim().length < 3} onClick={() => cancel(missReason.trim())}>
            Cancel order
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PickPage() {
  return (
    <React.Suspense fallback={null}>
      <PickInner />
    </React.Suspense>
  );
}
