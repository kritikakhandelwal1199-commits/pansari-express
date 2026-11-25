'use client';
import * as React from 'react';
import { Camera } from 'lucide-react';
import { CameraScanner } from '@/components/CameraScanner';
import { Button, Input } from '@/components/ui';
import type { AppUser, ProductInfo, StoreInfo } from '@/lib/data/types';

export interface StaffCtx {
  user: AppUser;
  stores: StoreInfo[];
  storeId: string;
  store: StoreInfo | undefined;
}
export const StaffContext = React.createContext<StaffCtx | null>(null);
export const useStaffApp = () => {
  const c = React.useContext(StaffContext);
  if (!c) throw new Error('useStaffApp outside staff layout');
  return c;
};

/* ------------------------------------------------------------------ product finder (search or scan) */

export function ProductFinder({ products, onPick, placeholder = 'Scan barcode or type a name' }: { products: ProductInfo[]; onPick: (p: ProductInfo) => void; placeholder?: string }) {
  const [q, setQ] = React.useState('');
  const [scan, setScan] = React.useState(false);
  const t = q.trim().toLowerCase();
  const hits = t ? products.filter((p) => p.barcode === q.trim() || p.name.toLowerCase().includes(t) || (p.nameHi ?? '').includes(q.trim())).slice(0, 8) : [];
  const choose = (p: ProductInfo) => {
    onPick(p);
    setQ('');
  };
  const byCode = (code: string) => {
    const p = products.find((x) => x.barcode === code.trim());
    if (p) choose(p);
    else setQ(code);
  };
  return (
    <div className="grid gap-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const exact = products.find((x) => x.barcode === q.trim());
          if (exact) choose(exact);
          else if (hits.length === 1) choose(hits[0]!);
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
        <Button type="button" variant="outline" size="icon" aria-label="Scan with camera" onClick={() => setScan((s) => !s)}>
          <Camera className="size-5" />
        </Button>
      </form>
      {scan ? (
        <CameraScanner
          onResult={(v) => {
            setScan(false);
            byCode(v);
          }}
        />
      ) : null}
      {hits.length ? (
        <ul className="grid gap-1 rounded-xl border border-line bg-surface p-1">
          {hits.map((p) => (
            <li key={p.productId}>
              <button type="button" className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left hover:bg-surface-2" onClick={() => choose(p)}>
                <span className="font-semibold">{p.name}</span>
                <span className="num text-[12px] text-muted">{p.barcode ?? ''}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
