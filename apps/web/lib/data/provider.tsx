'use client';
import * as React from 'react';
import type { AppUser, DataClient } from './types';
import { DemoDataClient, type DemoOptions } from './demo';
import { FirebaseDataClient } from './firebase';

let singleton: DataClient | null = null;

export function createClient(demoOptions?: DemoOptions): DataClient {
  if (singleton) return singleton;
  const mode = process.env.NEXT_PUBLIC_DATA_MODE ?? 'demo';
  singleton =
    mode === 'firebase'
      ? new FirebaseDataClient({
          firebase: {
            apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
            authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
            projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
            storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
            appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
          },
          functionsRegion: process.env.NEXT_PUBLIC_FUNCTIONS_REGION ?? 'asia-south1',
          edgeUrl: process.env.NEXT_PUBLIC_EDGE_URL ?? 'http://127.0.0.1:8787',
          useEmulators: process.env.NEXT_PUBLIC_USE_EMULATORS === 'true',
        })
      : new DemoDataClient(demoOptions);
  return singleton;
}

const Ctx = React.createContext<DataClient | null>(null);

export function DataProvider({ children, client }: { children: React.ReactNode; client?: DataClient }) {
  const [c] = React.useState(() => client ?? createClient());
  return <Ctx.Provider value={c}>{children}</Ctx.Provider>;
}

export function useData(): DataClient {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('useData must be used inside <DataProvider>');
  return c;
}

function useSession(kind: 'staff' | 'guest') {
  const data = useData();
  const [state, setState] = React.useState<{ user: AppUser | null; ready: boolean }>({ user: null, ready: false });
  React.useEffect(() => (kind === 'staff' ? data.onAuthChange : data.onGuestChange).call(data, (user) => setState({ user, ready: true })), [data, kind]);
  return state;
}

export const useStaff = () => useSession('staff');
export const useGuest = () => useSession('guest');

/** Small async-resource hook with reload. */
export function useResource<T>(load: () => Promise<T>, deps: React.DependencyList) {
  const [state, setState] = React.useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    load()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((e: unknown) => alive && setState({ data: null, error: e instanceof Error ? e.message : 'Failed to load', loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
