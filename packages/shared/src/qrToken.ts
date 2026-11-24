/**
 * Tamper-proof tokens signed with HMAC-SHA256 (WebCrypto — runs unchanged in
 * Cloudflare Workers, Node 22 Cloud Functions and browsers).
 *
 * Wire format:  v1.<kid>.<base64url(JSON payload)>.<base64url(signature)>
 * The signature covers "v1.<kid>.<payload>". `kid` selects the secret so keys
 * can be rotated without invalidating every printed poster at once.
 *
 * Two token types:
 *  - store:    printed on the counter poster. No expiry; revoked by bumping
 *              stores/{id}.qrKeyVersion (checked server-side against `ver`).
 *  - checkout: shown by a walk-in customer for the cashier to scan. Short-lived.
 */

export interface StoreQrPayload {
  t: 'store';
  sid: string; // storeId
  ver: number; // must equal stores/{sid}.qrKeyVersion
  iat: number; // epoch seconds
}

export interface CheckoutPayload {
  t: 'checkout';
  sid: string; // storeId
  cid: string; // temp cart id
  uid: string; // anonymous guest uid
  iat: number;
  exp: number;
  n: string; // nonce (single-use guard)
}

export type TokenPayload = StoreQrPayload | CheckoutPayload;

export type TokenErrorCode = 'MALFORMED' | 'UNKNOWN_KEY' | 'BAD_SIGNATURE' | 'WRONG_TYPE' | 'EXPIRED' | 'NOT_YET_VALID';

export class TokenError extends Error {
  constructor(readonly code: TokenErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'TokenError';
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new TokenError('MALFORMED', 'Invalid base64url');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error('HMAC secret must be at least 32 characters');
  let k = keyCache.get(secret);
  if (!k) {
    k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    keyCache.set(secret, k);
  }
  return k;
}

const KID_RE = /^[A-Za-z0-9_-]{1,16}$/;

export async function signToken(payload: TokenPayload, kid: string, secret: string): Promise<string> {
  if (!KID_RE.test(kid)) throw new Error('kid must be 1–16 url-safe characters');
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `v1.${kid}.${body}`;
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(signingInput)));
  return `${signingInput}.${b64urlEncode(sig)}`;
}

export interface VerifyOptions<T extends TokenPayload['t']> {
  expectedType: T;
  /** Secret lookup by key id; return undefined for unknown/retired keys. */
  secretFor: (kid: string) => string | undefined;
  nowSeconds?: number;
  clockSkewSeconds?: number;
}

export async function verifyToken<T extends TokenPayload['t']>(token: string, opts: VerifyOptions<T>): Promise<Extract<TokenPayload, { t: T }> & { kid: string }> {
  if (typeof token !== 'string' || token.length > 2048) throw new TokenError('MALFORMED');
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new TokenError('MALFORMED');
  const [, kid, body, sig] = parts as [string, string, string, string];
  if (!KID_RE.test(kid)) throw new TokenError('MALFORMED');
  const secret = opts.secretFor(kid);
  if (!secret) throw new TokenError('UNKNOWN_KEY');

  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecode(sig), enc.encode(`v1.${kid}.${body}`));
  if (!ok) throw new TokenError('BAD_SIGNATURE');

  let payload: TokenPayload;
  try {
    payload = JSON.parse(dec.decode(b64urlDecode(body))) as TokenPayload;
  } catch {
    throw new TokenError('MALFORMED', 'Payload is not JSON');
  }
  if (payload?.t !== opts.expectedType) throw new TokenError('WRONG_TYPE');
  if (typeof payload.sid !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(payload.sid)) throw new TokenError('MALFORMED', 'Bad store id');

  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = opts.clockSkewSeconds ?? 60;
  if (typeof payload.iat !== 'number' || payload.iat > now + skew) throw new TokenError('NOT_YET_VALID');
  if (payload.t === 'checkout') {
    if (typeof payload.exp !== 'number' || payload.exp < now - skew) throw new TokenError('EXPIRED');
    if (typeof payload.cid !== 'string' || typeof payload.uid !== 'string' || typeof payload.n !== 'string') throw new TokenError('MALFORMED');
  } else if (!Number.isSafeInteger(payload.ver) || payload.ver < 1) {
    throw new TokenError('MALFORMED', 'Bad key version');
  }
  return { ...(payload as Extract<TokenPayload, { t: T }>), kid };
}

/** Random url-safe id (nonces, cart ids). */
export function randomId(bytes = 16): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Hex SHA-256 — used for e-invoice IRN and OTP hashes. */
export async function sha256Hex(input: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(input)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Builds the URL printed on a store poster: https://<web>/store?s=<storeId>&token=<token> */
export function storeQrUrl(baseUrl: string, storeId: string, token: string): string {
  const u = new URL('/store', baseUrl);
  u.searchParams.set('s', storeId);
  u.searchParams.set('token', token);
  return u.toString();
}
