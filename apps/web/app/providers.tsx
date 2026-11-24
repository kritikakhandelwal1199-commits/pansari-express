'use client';
import { DataProvider } from '@/lib/data/provider';
import type { DataClient } from '@/lib/data/types';
import { ToastProvider, DemoRibbon } from '@/components/common';

export function Providers({ children, client }: { children: React.ReactNode; client?: DataClient }) {
  return (
    <DataProvider client={client}>
      <ToastProvider>
        <DemoRibbon />
        {children}
      </ToastProvider>
    </DataProvider>
  );
}
