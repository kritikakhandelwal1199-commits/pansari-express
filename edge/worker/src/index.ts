/**
 * Pansari Express edge API (Cloudflare Worker).
 *
 *   GET  /health
 *   GET  /v1/qr/resolve?storeId=&token=     public: is this printed store QR genuine?
 *   POST /v1/qr/sign        {storeId}       super_admin / owning seller: mint poster URL
 *   POST /v1/qr/session     {storeId, token, turnstileToken}
 *                                           anonymous user → scoped temp_qr_guest claims
 *   POST /v1/checkout/token {cartId}        temp_qr_guest: counter checkout QR token
 *   POST /v1/checkout/redeem {token}        seller/staff POS: validate scanned checkout QR
 */
import {
  CHECKOUT_TOKEN_TTL_SECONDS,
  randomId,
  signEdgeRequest,
  signToken,
  storeQrUrl,
  TokenError,
  verifyToken,
  type CheckoutPayload,
} from '@pansari/shared';
import { qrSecrets, type Env } from './env.js';
import { requireRole, verifyAppCheck, verifyFirebaseIdToken, type VerifiedUser } from './firebaseAuth.js';
import { getDocument, getPublicStore, type PublicStore } from './firestoreRest.js';
import { rateLimit, verifyTurnstile } from './guards.js';
import { clientIp, corsHeaders, errorResponse, HttpError, json, readJson, requireId } from './http.js';

export interface Deps {
  fetcher: typeof fetch;
  now: () => number; // epoch seconds
}

const defaultDeps: Deps = { fetcher: (...a) => fetch(...a), now: () => Math.floor(Date.now() / 1000) };

function tokenErrorToHttp(e: unknown): never {
  if (e instanceof TokenError) {
    const status = e.code === 'EXPIRED' ? 410 : 403;
    throw new HttpError(status, `QR_${e.code}`);
  }
  throw e;
}

function assertStoreUsable(store: PublicStore | null, ver?: number): asserts store is PublicStore {
  if (!store) throw new HttpError(404, 'STORE_NOT_FOUND');
  if (!store.isActive || !store.acceptsWalkInQr) throw new HttpError(403, 'STORE_NOT_ACCEPTING_QR');
  if (ver !== undefined && store.qrKeyVersion !== ver) throw new HttpError(403, 'QR_REVOKED');
}

/** Seller of the store's vendor (any of its stores unless storeIds narrows it), or staff attached to the store. */
function operatesStore(user: VerifiedUser, store: PublicStore): boolean {
  const c = user.claims;
  if (!c.vendorId || c.vendorId !== store.vendorId) return false;
  if (user.role === 'seller') return !c.storeIds || c.storeIds.length === 0 || c.storeIds.includes(store.storeId);
  if (user.role === 'staff') return !!c.storeIds?.includes(store.storeId);
  return false;
}

async function route(req: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const ip = clientIp(req);
  const secrets = qrSecrets(env);
  const secretFor = (kid: string) => secrets[kid];

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(req, env, 200, { ok: true, service: 'pansari-edge', version: env.APP_VERSION });
  }

  // ---------------------------------------------------------------- resolve
  if (req.method === 'GET' && url.pathname === '/v1/qr/resolve') {
    await rateLimit(env, 'standard', [`ip:${ip}:qr-resolve`]);
    const storeId = requireId(url.searchParams.get('storeId'), 'storeId');
    const token = url.searchParams.get('token') ?? '';
    const p = await verifyToken(token, { expectedType: 'store', secretFor, nowSeconds: deps.now() }).catch(tokenErrorToHttp);
    if (p.sid !== storeId) throw new HttpError(403, 'QR_STORE_MISMATCH');
    const store = await getPublicStore(env, storeId, deps.fetcher);
    assertStoreUsable(store, p.ver);
    return json(req, env, 200, { ok: true, store: { storeId, name: store.name, addressLine: store.addressLine, city: store.city, openingHours: store.openingHours } });
  }

  if (req.method !== 'POST') throw new HttpError(404, 'NOT_FOUND');

  // ---------------------------------------------------------------- sign
  if (url.pathname === '/v1/qr/sign') {
    const user = await verifyFirebaseIdToken(req, env, deps.fetcher, deps.now());
    await rateLimit(env, 'strict', [`uid:${user.uid}:qr-sign`]);
    requireRole(user, 'super_admin', 'seller');
    const { storeId: rawId } = await readJson<{ storeId?: unknown }>(req);
    const storeId = requireId(rawId, 'storeId');
    const store = await getPublicStore(env, storeId, deps.fetcher);
    if (!store) throw new HttpError(404, 'STORE_NOT_FOUND');
    if (user.role === 'seller' && !operatesStore(user, store)) throw new HttpError(403, 'NOT_YOUR_STORE');
    const kid = env.QR_ACTIVE_KID;
    const secret = secrets[kid];
    if (!secret) throw new HttpError(500, 'QR_KEY_MISCONFIGURED');
    const token = await signToken({ t: 'store', sid: storeId, ver: store.qrKeyVersion, iat: deps.now() }, kid, secret);
    return json(req, env, 200, { ok: true, url: storeQrUrl(env.PUBLIC_WEB_BASE_URL, storeId, token), token, kid, keyVersion: store.qrKeyVersion });
  }

  // ---------------------------------------------------------------- session
  if (url.pathname === '/v1/qr/session') {
    await rateLimit(env, 'strict', [`ip:${ip}:qr-session`]);
    await verifyAppCheck(req, env, deps.fetcher, deps.now());
    const user = await verifyFirebaseIdToken(req, env, deps.fetcher, deps.now());
    if (!user.isAnonymous) throw new HttpError(403, 'ANONYMOUS_SESSION_REQUIRED');
    await rateLimit(env, 'strict', [`uid:${user.uid}:qr-session`]);
    const body = await readJson<{ storeId?: unknown; token?: unknown; turnstileToken?: unknown }>(req);
    const storeId = requireId(body.storeId, 'storeId');
    await verifyTurnstile(env, body.turnstileToken ?? req.headers.get('CF-Turnstile-Response'), ip, deps.fetcher);
    const p = await verifyToken(String(body.token ?? ''), { expectedType: 'store', secretFor, nowSeconds: deps.now() }).catch(tokenErrorToHttp);
    if (p.sid !== storeId) throw new HttpError(403, 'QR_STORE_MISMATCH');
    assertStoreUsable(await getPublicStore(env, storeId, deps.fetcher), p.ver);

    // Hand off to the claims function (Admin SDK) with an edge signature.
    const payload = JSON.stringify({ uid: user.uid, storeId, qrToken: body.token, ip });
    const res = await deps.fetcher(`${env.FUNCTIONS_BASE_URL}/qrSessionClaim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await signEdgeRequest(payload, env.EDGE_SHARED_SECRET, deps.now())) },
      body: payload,
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new HttpError(res.status === 403 ? 403 : 502, err.error ?? 'CLAIMS_FUNCTION_FAILED');
    }
    const out = (await res.json()) as { scopedStoreId: string; qrExp: number };
    return json(req, env, 200, { ok: true, scopedStoreId: out.scopedStoreId, expiresAt: out.qrExp, refreshIdToken: true });
  }

  // ---------------------------------------------------------------- checkout token
  if (url.pathname === '/v1/checkout/token') {
    const user = await verifyFirebaseIdToken(req, env, deps.fetcher, deps.now());
    await rateLimit(env, 'standard', [`uid:${user.uid}:checkout-token`, `ip:${ip}:checkout-token`]);
    requireRole(user, 'temp_qr_guest');
    const now = deps.now();
    const sid = user.claims.scopedStoreId;
    if (!sid || !user.claims.qrExp || user.claims.qrExp < now) throw new HttpError(401, 'GUEST_SESSION_EXPIRED');
    const { cartId: rawCart } = await readJson<{ cartId?: unknown }>(req);
    const cartId = requireId(rawCart, 'cartId');
    // Read the cart as the guest — security rules guarantee it is theirs.
    const cart = await getDocument(env, `temp_carts/${cartId}`, { idToken: user.rawToken, fetcher: deps.fetcher });
    if (!cart) throw new HttpError(404, 'CART_NOT_FOUND');
    if (cart.storeId !== sid || cart.guestUid !== user.uid) throw new HttpError(403, 'CART_NOT_YOURS');
    if (cart.status !== 'OPEN' && cart.status !== 'CHECKOUT_PENDING') throw new HttpError(409, 'CART_CLOSED');
    if (!Array.isArray(cart.items) || cart.items.length === 0) throw new HttpError(409, 'CART_EMPTY');
    const kid = env.QR_ACTIVE_KID;
    const secret = secrets[kid];
    if (!secret) throw new HttpError(500, 'QR_KEY_MISCONFIGURED');
    const payload: CheckoutPayload = { t: 'checkout', sid, cid: cartId, uid: user.uid, iat: now, exp: now + CHECKOUT_TOKEN_TTL_SECONDS, n: randomId(12) };
    return json(req, env, 200, { ok: true, token: await signToken(payload, kid, secret), expiresAt: payload.exp });
  }

  // ---------------------------------------------------------------- checkout redeem (POS)
  if (url.pathname === '/v1/checkout/redeem') {
    const user = await verifyFirebaseIdToken(req, env, deps.fetcher, deps.now());
    await rateLimit(env, 'standard', [`uid:${user.uid}:checkout-redeem`]);
    requireRole(user, 'seller', 'staff');
    const { token } = await readJson<{ token?: unknown }>(req);
    const p = await verifyToken(String(token ?? ''), { expectedType: 'checkout', secretFor, nowSeconds: deps.now() }).catch(tokenErrorToHttp);
    const store = await getPublicStore(env, p.sid, deps.fetcher);
    if (!store) throw new HttpError(404, 'STORE_NOT_FOUND');
    if (!operatesStore(user, store)) throw new HttpError(403, 'NOT_YOUR_STORE');
    // Fast replay guard. The authoritative single-use check is the Firestore
    // transaction that marks the cart CONSUMED when the sale is committed.
    const replayKey = `ct:${p.n}`;
    if (await env.EPHEMERAL.get(replayKey)) throw new HttpError(409, 'CHECKOUT_ALREADY_REDEEMED');
    await env.EPHEMERAL.put(replayKey, user.uid, { expirationTtl: CHECKOUT_TOKEN_TTL_SECONDS + 300 });
    return json(req, env, 200, { ok: true, storeId: p.sid, cartId: p.cid, guestUid: p.uid, expiresAt: p.exp });
  }

  throw new HttpError(404, 'NOT_FOUND');
}

export async function handle(req: Request, env: Env, deps: Deps = defaultDeps): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req, env) });
  }
  try {
    return await route(req, env, deps);
  } catch (e) {
    return errorResponse(req, env, e);
  }
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env);
  },
} satisfies ExportedHandler<Env>;
