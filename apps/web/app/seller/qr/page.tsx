'use client';
import * as React from 'react';
import Link from 'next/link';
import { Copy, ExternalLink, Printer, ShieldCheck } from 'lucide-react';
import { ErrorNote, Qr, useToast } from '@/components/common';
import { PageHead, useSeller } from '@/components/seller';
import { Button, Card, Skeleton } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { StoreInfo } from '@/lib/data/types';
import { errMsg, toAppPath } from '@/lib/utils';

export default function QrPage() {
  const { stores } = useSeller();
  const walkIn = stores.filter((s) => s.acceptsWalkInQr);
  const [printing, setPrinting] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => {
      window.print();
      setPrinting(null);
    }, 50);
    return () => clearTimeout(t);
  }, [printing]);

  return (
    <>
      <div className="no-print">
        <PageHead title="Store QR posters" sub="Print and stick one at each counter. Customers scan it with their phone camera to shop that store's shelf — no app or sign-up." />
        <Card className="mb-6 flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-leaf" />
          <p className="text-[14px] text-muted">
            Each code is signed with a secret key (HMAC-SHA256), so an edited or home-made QR is rejected. If a poster is misused, the admin replaces all posters of that store in one step and the old codes stop working.
          </p>
        </Card>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {walkIn.map((s) => (
          <Poster key={s.storeId} store={s} hidden={!!printing && printing !== s.storeId} onPrint={() => setPrinting(s.storeId)} />
        ))}
      </div>
    </>
  );
}

function Poster({ store, onPrint, hidden }: { store: StoreInfo; onPrint: () => void; hidden: boolean }) {
  const data = useData();
  const toast = useToast();
  const qr = useResource(() => data.signStoreQr(store.storeId), [data, store.storeId, store.qrKeyVersion]);
  const internal = qr.data ? toAppPath(qr.data.url) : null;

  return (
    <div className={hidden ? 'print:hidden' : ''}>
      <article className="grid justify-items-center gap-4 rounded-[28px] bg-kum p-6 text-center text-kum-ink print:min-h-[95vh] print:content-center print:rounded-none sm:p-8">
        <div className="font-brand text-[34px] leading-none text-haldi">Pansari Express</div>
        <div className="text-lg font-bold">{store.name}</div>
        <div className="rounded-2xl bg-white p-3">{qr.loading ? <Skeleton className="size-[240px]" /> : qr.data ? <Qr value={qr.data.url} size={240} label={`QR to shop ${store.name}`} /> : null}</div>
        <div className="text-[22px] font-extrabold leading-tight">Scan to shop this store</div>
        <ul className="grid gap-1 text-[15px] text-white/90">
          <li>See live stock, aisle and expiry date</li>
          <li>Pay on your phone or show the bill QR at the counter</li>
          <li>No app, no sign-up · GST bill on your phone</li>
        </ul>
      </article>
      {qr.error ? <ErrorNote>{qr.error}</ErrorNote> : null}
      <div className="no-print mt-3 flex flex-wrap gap-2">
        <Button variant="outline" onClick={onPrint} disabled={!qr.data}>
          <Printer className="size-4" /> Print poster
        </Button>
        <Button
          variant="outline"
          disabled={!qr.data}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(qr.data!.url);
              toast({ tone: 'good', text: 'Poster link copied' });
            } catch (e) {
              toast({ tone: 'bad', text: errMsg(e) });
            }
          }}
        >
          <Copy className="size-4" /> Copy link
        </Button>
        {internal ? (
          <Button variant="haldi" asChild>
            <Link href={internal}>
              <ExternalLink className="size-4" /> Open as a customer
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
