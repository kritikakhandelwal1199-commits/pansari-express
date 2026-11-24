/**
 * RS256 JWT verification against a remote JWKS, using WebCrypto only.
 * Used for Firebase ID tokens and Firebase App Check tokens.
 */
import { b64urlDecode } from '@pansari/shared';
import { HttpError } from './http.js';

export interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

type Fetcher = (url: string) => Promise<Response>;

interface CacheEntry {
  keys: Map<string, CryptoKey>;
  expiresAt: number;
}

const jwksCache = new Map<string, CacheEntry>();
const dec = new TextDecoder();

function maxAge(res: Response): number {
  const m = /max-age=(\d+)/.exec(res.headers.get('Cache-Control') ?? '');
  return Math.min(Number(m?.[1] ?? 3600), 6 * 3600) * 1000;
}

async function loadJwks(url: string, fetcher: Fetcher, forceRefresh = false): Promise<Map<string, CryptoKey>> {
  const hit = jwksCache.get(url);
  if (hit && hit.expiresAt > Date.now() && !forceRefresh) return hit.keys;
  const res = await fetcher(url);
  if (!res.ok) throw new HttpError(503, 'JWKS_UNAVAILABLE');
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = new Map<string, CryptoKey>();
  for (const k of body.keys ?? []) {
    if (k.kty !== 'RSA' || !k.kid) continue;
    keys.set(
      k.kid,
      await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']),
    );
  }
  jwksCache.set(url, { keys, expiresAt: Date.now() + maxAge(res) });
  return keys;
}

export interface JwtParts {
  header: { alg?: string; kid?: string; typ?: string };
  payload: Record<string, unknown>;
  signingInput: Uint8Array<ArrayBuffer>;
  signature: Uint8Array<ArrayBuffer>;
}

export function decodeJwt(token: string): JwtParts {
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'TOKEN_MALFORMED');
  try {
    const header = JSON.parse(dec.decode(b64urlDecode(parts[0]!)));
    const payload = JSON.parse(dec.decode(b64urlDecode(parts[1]!)));
    return { header, payload, signingInput: new TextEncoder().encode(`${parts[0]}.${parts[1]}`) as Uint8Array<ArrayBuffer>, signature: b64urlDecode(parts[2]!) };
  } catch {
    throw new HttpError(401, 'TOKEN_MALFORMED');
  }
}

export async function verifyRs256(token: string, jwksUrl: string, fetcher: Fetcher = fetch): Promise<Record<string, unknown>> {
  if (token.length > 8192) throw new HttpError(401, 'TOKEN_MALFORMED');
  const { header, payload, signingInput, signature } = decodeJwt(token);
  if (header.alg !== 'RS256' || !header.kid) throw new HttpError(401, 'TOKEN_BAD_ALG');
  let keys = await loadJwks(jwksUrl, fetcher);
  if (!keys.has(header.kid)) keys = await loadJwks(jwksUrl, fetcher, true); // key rotation
  const key = keys.get(header.kid);
  if (!key) throw new HttpError(401, 'TOKEN_UNKNOWN_KID');
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signingInput);
  if (!ok) throw new HttpError(401, 'TOKEN_BAD_SIGNATURE');
  return payload;
}

/** Test hook. */
export function _clearJwksCache() {
  jwksCache.clear();
}
