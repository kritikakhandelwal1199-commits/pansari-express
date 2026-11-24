import { beforeAll, describe, expect, it } from 'vitest';
import { b64urlEncode, signToken, verifyEdgeRequest } from '@pansari/shared';
import { handle, type Deps } from '../src/index.js';
import type { Env } from '../src/env.js';
import { FIREBASE_ID_JWKS } from '../src/firebaseAuth.js';
import { _clearJwksCache } from '../src/jwt.js';
import { MOCK_TURNSTILE_PASS } from '../src/guards.js';

const QR_SECRET = 'qr-secret-for-tests-at-least-32-chars-long';
const EDGE_SECRET = 'edge-secret-for-tests-at-least-32-chars-long';
const NOW = 1_800_000_000;
const enc = new TextEncoder();

let signingKey: CryptoKey;
let rogueKey: CryptoKey;
let jwk: JsonWebKey;

async function mintIdToken(claims: Record<string, unknown>, key = signingKey, kid = 'kid-1') {
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const payload = { iss: 'https://securetoken.google.com/demo-pansari', aud: 'demo-pansari', iat: NOW - 10, exp: NOW + 3600, auth_time: NOW - 10, ...claims };
  const input = `${b64urlEncode(enc.encode(JSON.stringify(header)))}.${b64urlEncode(enc.encode(JSON.stringify(payload)))}`;
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(input)));
  return `${input}.${b64urlEncode(sig)}`;
}

const stores: Record<string, Record<string, unknown>> = {
  S1: { storeId: { stringValue: 'S1' }, vendorId: { stringValue: 'V1' }, name: { stringValue: 'Johari Bazaar Store' }, addressLine: { stringValue: 'Johari Bazaar' }, city: { stringValue: 'Jaipur' }, qrKeyVersion: { integerValue: '2' }, isActive: { booleanValue: true }, acceptsWalkInQr: { booleanValue: true } },
  S2: { storeId: { stringValue: 'S2' }, vendorId: { stringValue: 'V1' }, name: { stringValue: 'Malviya Nagar' }, qrKeyVersion: { integerValue: '1' }, isActive: { booleanValue: true } },
};
const carts: Record<string, Record<string, unknown>> = {
  c1: { storeId: { stringValue: 'S1' }, guestUid: { stringValue: 'guest1' }, status: { stringValue: 'OPEN' }, items: { arrayValue: { values: [{ mapValue: { fields: { productId: { stringValue: 'p12' }, qty: { integerValue: '1' } } } }] } } },
};

let functionCalls: { body: string; valid: boolean }[] = [];

function makeDeps(): Deps {
  return {
    now: () => NOW,
    fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === FIREBASE_ID_JWKS) return new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'kid-1', alg: 'RS256' }] }), { headers: { 'Cache-Control': 'max-age=3600' } });
      const m = /documents\/(stores|temp_carts)\/([^/?]+)$/.exec(url);
      if (m) {
        const src = m[1] === 'stores' ? stores : carts;
        const d = src[m[2]!];
        if (m[1] === 'temp_carts' && !(init?.headers as Record<string, string>)?.Authorization) return new Response('{}', { status: 403 });
        return d ? new Response(JSON.stringify({ fields: d })) : new Response('{}', { status: 404 });
      }
      if (url.endsWith('/qrSessionClaim')) {
        const h = init!.headers as Record<string, string>;
        const body = String(init!.body);
        const valid = await verifyEdgeRequest(body, h['X-Edge-Timestamp'], h['X-Edge-Signature'], EDGE_SECRET, NOW);
        functionCalls.push({ body, valid });
        return new Response(JSON.stringify({ scopedStoreId: JSON.parse(body).storeId, qrExp: NOW + 7200 }));
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch,
  };
}

function makeEnv(over: Partial<Env> = {}): Env {
  const kv = new Map<string, string>();
  return {
    APP_VERSION: 'test',
    FIREBASE_PROJECT_ID: 'demo-pansari',
    FIREBASE_PROJECT_NUMBER: '123',
    APP_CHECK_MODE: 'off',
    TURNSTILE_MODE: 'mock',
    PUBLIC_WEB_BASE_URL: 'https://shop.example.in',
    FUNCTIONS_BASE_URL: 'https://fn.example',
    FIRESTORE_REST_BASE: 'https://firestore.example/v1',
    QR_ACTIVE_KID: 'k1',
    ALLOWED_ORIGINS: 'https://shop.example.in',
    AUTH_EMULATOR: 'false',
    QR_HMAC_KEYS: JSON.stringify({ k1: QR_SECRET }),
    EDGE_SHARED_SECRET: EDGE_SECRET,
    EPHEMERAL: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
    } as unknown as KVNamespace,
    ...over,
  };
}

const post = (path: string, body: unknown, token?: string) =>
  new Request(`https://edge.example${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

beforeAll(async () => {
  _clearJwksCache();
  const kp = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  signingKey = kp.privateKey;
  jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey;
  const rogue = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  rogueKey = rogue.privateKey;
});

describe('edge worker', () => {
  it('serves health with security headers', async () => {
    const res = await handle(new Request('https://edge.example/health'), makeEnv(), makeDeps());
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('only echoes CORS for allowed origins', async () => {
    const ok = await handle(new Request('https://edge.example/health', { method: 'OPTIONS', headers: { Origin: 'https://shop.example.in' } }), makeEnv(), makeDeps());
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://shop.example.in');
    const bad = await handle(new Request('https://edge.example/health', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), makeEnv(), makeDeps());
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  describe('Firebase ID token verification', () => {
    it('rejects missing, forged, expired and wrong-project tokens', async () => {
      const env = makeEnv();
      const deps = makeDeps();
      expect((await handle(post('/v1/qr/sign', { storeId: 'S1' }), env, deps)).status).toBe(401);
      const forged = await mintIdToken({ sub: 'u1', role: 'super_admin', firebase: { sign_in_provider: 'phone' } }, rogueKey);
      expect(await (await handle(post('/v1/qr/sign', { storeId: 'S1' }, forged), env, deps)).json()).toMatchObject({ error: 'TOKEN_BAD_SIGNATURE' });
      const expired = await mintIdToken({ sub: 'u1', role: 'super_admin', exp: NOW - 3600, firebase: { sign_in_provider: 'phone' } });
      expect(await (await handle(post('/v1/qr/sign', { storeId: 'S1' }, expired), env, deps)).json()).toMatchObject({ error: 'TOKEN_EXPIRED' });
      const other = await mintIdToken({ sub: 'u1', role: 'super_admin', aud: 'other-project', firebase: { sign_in_provider: 'phone' } });
      expect(await (await handle(post('/v1/qr/sign', { storeId: 'S1' }, other), env, deps)).json()).toMatchObject({ error: 'TOKEN_BAD_AUDIENCE' });
    });
  });

  describe('store QR', () => {
    it('lets the owning seller sign a poster and rejects other vendors and customers', async () => {
      const env = makeEnv();
      const deps = makeDeps();
      const seller = await mintIdToken({ sub: 'seller1', role: 'seller', vendorId: 'V1', storeIds: [], firebase: { sign_in_provider: 'phone' } });
      const res = await handle(post('/v1/qr/sign', { storeId: 'S1' }, seller), env, deps);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { url: string; token: string; keyVersion: number };
      expect(body.url).toMatch(/^https:\/\/shop\.example\.in\/store\?s=S1&token=v1\.k1\./);
      expect(body.keyVersion).toBe(2);

      const otherVendor = await mintIdToken({ sub: 'seller2', role: 'seller', vendorId: 'V2', firebase: { sign_in_provider: 'phone' } });
      expect((await handle(post('/v1/qr/sign', { storeId: 'S1' }, otherVendor), env, deps)).status).toBe(403);
      const customer = await mintIdToken({ sub: 'c1', firebase: { sign_in_provider: 'phone' } });
      expect((await handle(post('/v1/qr/sign', { storeId: 'S1' }, customer), env, deps)).status).toBe(403);
    });

    it('resolves genuine posters and rejects forged, mismatched or revoked ones', async () => {
      const env = makeEnv();
      const deps = makeDeps();
      const good = await signToken({ t: 'store', sid: 'S1', ver: 2, iat: NOW - 100 }, 'k1', QR_SECRET);
      const r = await handle(new Request(`https://edge.example/v1/qr/resolve?storeId=S1&token=${good}`), env, deps);
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ store: { name: 'Johari Bazaar Store' } });

      const revoked = await signToken({ t: 'store', sid: 'S1', ver: 1, iat: NOW - 100 }, 'k1', QR_SECRET);
      expect(await (await handle(new Request(`https://edge.example/v1/qr/resolve?storeId=S1&token=${revoked}`), env, deps)).json()).toMatchObject({ error: 'QR_REVOKED' });
      expect(await (await handle(new Request(`https://edge.example/v1/qr/resolve?storeId=S2&token=${good}`), env, deps)).json()).toMatchObject({ error: 'QR_STORE_MISMATCH' });
      const forged = await signToken({ t: 'store', sid: 'S1', ver: 2, iat: NOW - 100 }, 'k1', 'attacker-secret-that-is-also-32-characters!!');
      expect(await (await handle(new Request(`https://edge.example/v1/qr/resolve?storeId=S1&token=${forged}`), env, deps)).json()).toMatchObject({ error: 'QR_BAD_SIGNATURE' });
    });
  });

  describe('walk-in session + counter checkout', () => {
    it('upgrades an anonymous user to a scoped guest via a signed function call', async () => {
      functionCalls = [];
      const env = makeEnv();
      const deps = makeDeps();
      const token = await signToken({ t: 'store', sid: 'S1', ver: 2, iat: NOW - 100 }, 'k1', QR_SECRET);
      const anon = await mintIdToken({ sub: 'guest1', firebase: { sign_in_provider: 'anonymous' } });
      const phoneUser = await mintIdToken({ sub: 'u9', firebase: { sign_in_provider: 'phone' } });

      expect(await (await handle(post('/v1/qr/session', { storeId: 'S1', token, turnstileToken: MOCK_TURNSTILE_PASS }, phoneUser), env, deps)).json()).toMatchObject({ error: 'ANONYMOUS_SESSION_REQUIRED' });
      expect(await (await handle(post('/v1/qr/session', { storeId: 'S1', token, turnstileToken: 'bot' }, anon), env, deps)).json()).toMatchObject({ error: 'TURNSTILE_FAILED' });

      const res = await handle(post('/v1/qr/session', { storeId: 'S1', token, turnstileToken: MOCK_TURNSTILE_PASS }, anon), env, deps);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ scopedStoreId: 'S1', refreshIdToken: true });
      expect(functionCalls).toHaveLength(1);
      expect(functionCalls[0]!.valid).toBe(true);
    });

    it('issues a checkout token to the cart owner and lets store staff redeem it once', async () => {
      const env = makeEnv();
      const deps = makeDeps();
      const guest = await mintIdToken({ sub: 'guest1', role: 'temp_qr_guest', scopedStoreId: 'S1', qrExp: NOW + 3600, firebase: { sign_in_provider: 'anonymous' } });
      const t = await handle(post('/v1/checkout/token', { cartId: 'c1' }, guest), env, deps);
      expect(t.status).toBe(200);
      const { token } = (await t.json()) as { token: string };

      const otherGuest = await mintIdToken({ sub: 'guest2', role: 'temp_qr_guest', scopedStoreId: 'S1', qrExp: NOW + 3600, firebase: { sign_in_provider: 'anonymous' } });
      expect((await handle(post('/v1/checkout/token', { cartId: 'c1' }, otherGuest), env, deps)).status).toBe(403);

      const wrongStaff = await mintIdToken({ sub: 'st2', role: 'staff', vendorId: 'V1', storeIds: ['S2'], firebase: { sign_in_provider: 'phone' } });
      expect(await (await handle(post('/v1/checkout/redeem', { token }, wrongStaff), env, deps)).json()).toMatchObject({ error: 'NOT_YOUR_STORE' });

      const staff = await mintIdToken({ sub: 'st1', role: 'staff', vendorId: 'V1', storeIds: ['S1'], firebase: { sign_in_provider: 'phone' } });
      const r1 = await handle(post('/v1/checkout/redeem', { token }, staff), env, deps);
      expect(r1.status).toBe(200);
      expect(await r1.json()).toMatchObject({ cartId: 'c1', guestUid: 'guest1', storeId: 'S1' });
      expect(await (await handle(post('/v1/checkout/redeem', { token }, staff), env, deps)).json()).toMatchObject({ error: 'CHECKOUT_ALREADY_REDEEMED' });
    });

    it('rate limits a burst of session attempts from one IP', async () => {
      const env = makeEnv();
      const deps = makeDeps();
      const req = () => new Request('https://edge.example/v1/qr/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' }, body: '{}' });
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) statuses.push((await handle(req(), env, deps)).status);
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
    });
  });
});
