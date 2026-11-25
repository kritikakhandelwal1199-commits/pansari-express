/**
 * The demo backend expects the synchronous Web Storage API. On the phone we keep
 * a Map in memory, load it from AsyncStorage once at start-up, and write through.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'pansari:';

export async function hydratedStorage(): Promise<Storage> {
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
  const pairs = await AsyncStorage.multiGet(keys);
  const map = new Map<string, string>(pairs.filter((p): p is [string, string] => p[1] !== null).map(([k, v]) => [k.slice(PREFIX.length), v]));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
      void AsyncStorage.setItem(PREFIX + k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
      void AsyncStorage.removeItem(PREFIX + k);
    },
    clear: () => {
      map.clear();
      void AsyncStorage.multiRemove(keys);
    },
  };
}
