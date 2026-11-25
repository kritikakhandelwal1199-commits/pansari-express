/**
 * Data layer for the phone app. In API-hold / demo mode the app runs the same
 * DemoDataClient as the web demo (shared planners, GST engine, FEFO), with its
 * state saved on the phone. Builds with EXPO_PUBLIC_DATA_MODE=firebase use the
 * website's FirebaseDataClient (see lib/live.tsx).
 */
import * as React from 'react';
import { DemoDataClient, type AppUser, type DataClient } from '@pansari/client';
import { hydratedStorage } from './storage';
import { createLiveClient, DATA_MODE } from './live';

interface Ctx {
  client: DataClient;
  user: AppUser | null;
  ready: boolean;
  storage: Storage;
}
const C = React.createContext<Ctx | null>(null);

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear() };
}

export function DataProvider({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const [state, setState] = React.useState<{ client: DataClient; storage: Storage } | null>(null);
  const [user, setUser] = React.useState<{ u: AppUser | null; ready: boolean }>({ u: null, ready: false });
  React.useEffect(() => {
    let alive = true;
    void hydratedStorage().then((storage) => {
      if (!alive) return;
      const client: DataClient = DATA_MODE === 'firebase' ? createLiveClient() : new DemoDataClient({ storage, sessionStorage: memoryStorage(), noWindowSync: true });
      setState({ client, storage });
    });
    return () => {
      alive = false;
    };
  }, []);
  React.useEffect(() => (state ? state.client.onAuthChange((u) => setUser({ u, ready: true })) : undefined), [state]);
  if (!state) return <>{fallback}</>;
  return <C.Provider value={{ client: state.client, storage: state.storage, user: user.u, ready: user.ready }}>{children}</C.Provider>;
}

export function useData() {
  const c = React.useContext(C);
  if (!c) throw new Error('useData outside DataProvider');
  return c;
}

export function useResource<T>(load: () => Promise<T>, deps: React.DependencyList) {
  const [s, set] = React.useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    set((x) => ({ ...x, loading: true, error: null }));
    load()
      .then((data) => alive && set({ data, error: null, loading: false }))
      .catch((e: unknown) => alive && set({ data: null, error: e instanceof Error ? e.message : 'Failed to load', loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...s, reload: () => setTick((t) => t + 1) };
}

export const errMsg = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'Something went wrong');
