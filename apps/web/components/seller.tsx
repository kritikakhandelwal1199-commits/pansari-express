'use client';
import * as React from 'react';
import type { AppUser, StoreInfo } from '@/lib/data/types';

export interface SellerCtx {
  user: AppUser;
  stores: StoreInfo[];
  storeId: string;
  store: StoreInfo | undefined;
  setStoreId: (id: string) => void;
  isOwner: boolean;
}
export const SellerContext = React.createContext<SellerCtx | null>(null);
export const useSeller = () => {
  const c = React.useContext(SellerContext);
  if (!c) throw new Error('useSeller outside seller layout');
  return c;
};

export function PageHead({ title, sub, actions }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[clamp(26px,3vw,34px)] font-extrabold leading-tight tracking-tight">{title}</h1>
        {sub ? <p className="mt-1 text-muted">{sub}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
