/**
 * Minimal Firestore REST reads from the edge. The worker holds no service-account
 * credentials: public docs (stores) are read anonymously, private docs are read
 * WITH THE CALLER'S OWN ID TOKEN so Firestore security rules still apply.
 */
import type { Env } from './env.js';
import { HttpError } from './http.js';

type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { mapValue: { fields?: Record<string, FsValue> } }
  | { arrayValue: { values?: FsValue[] } };

function decodeValue(v: FsValue): unknown {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return decodeFields(v.mapValue.fields ?? {});
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(decodeValue);
  return undefined;
}

function decodeFields(fields: Record<string, FsValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v);
  return out;
}

const publicCache = new Map<string, { at: number; data: Record<string, unknown> | null }>();
const PUBLIC_TTL_MS = 30_000;

export async function getDocument(env: Env, path: string, opts: { idToken?: string; cache?: boolean; fetcher?: typeof fetch } = {}): Promise<Record<string, unknown> | null> {
  if (!/^[A-Za-z0-9_]+\/[A-Za-z0-9_-]{1,128}$/.test(path)) throw new HttpError(400, 'INVALID_PATH');
  const cacheKey = `${env.FIREBASE_PROJECT_ID}/${path}`;
  if (opts.cache && !opts.idToken) {
    const hit = publicCache.get(cacheKey);
    if (hit && Date.now() - hit.at < PUBLIC_TTL_MS) return hit.data;
  }
  const url = `${env.FIRESTORE_REST_BASE}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
  const headers: Record<string, string> = {};
  if (opts.idToken) headers.Authorization = `Bearer ${opts.idToken}`;
  const res = await (opts.fetcher ?? fetch)(url, { headers });
  let data: Record<string, unknown> | null;
  if (res.status === 404) data = null;
  else if (res.status === 403) throw new HttpError(403, 'FORBIDDEN_DOCUMENT');
  else if (!res.ok) throw new HttpError(503, 'FIRESTORE_UNAVAILABLE');
  else data = decodeFields(((await res.json()) as { fields?: Record<string, FsValue> }).fields ?? {});
  if (opts.cache && !opts.idToken) publicCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

export interface PublicStore {
  storeId: string;
  vendorId: string;
  name: string;
  addressLine: string;
  city: string;
  openingHours: unknown;
  qrKeyVersion: number;
  isActive: boolean;
  acceptsWalkInQr: boolean;
}

export async function getPublicStore(env: Env, storeId: string, fetcher?: typeof fetch): Promise<PublicStore | null> {
  const d = await getDocument(env, `stores/${storeId}`, { cache: true, fetcher });
  if (!d) return null;
  return {
    storeId,
    vendorId: String(d.vendorId ?? ''),
    name: String(d.name ?? ''),
    addressLine: String(d.addressLine ?? ''),
    city: String(d.city ?? ''),
    openingHours: d.openingHours ?? null,
    qrKeyVersion: Number(d.qrKeyVersion ?? 0),
    isActive: d.isActive === true,
    acceptsWalkInQr: d.acceptsWalkInQr !== false,
  };
}
