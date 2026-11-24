/**
 * Pure logic for turning an anonymous walk-in user into a store-scoped
 * temp_qr_guest. Called only by the edge worker (HMAC-signed request).
 */
import { QR_GUEST_SESSION_SECONDS, TokenError, verifyEdgeRequest, verifyToken, type PansariClaims } from '@pansari/shared';

export interface QrSessionDeps {
  qrSecrets: Record<string, string>;
  edgeSecret: string;
  now: () => number; // epoch seconds
  getStore(storeId: string): Promise<{ vendorId: string; qrKeyVersion: number; isActive: boolean; acceptsWalkInQr: boolean } | null>;
  getUser(uid: string): Promise<{ disabled: boolean; isAnonymous: boolean; claims: PansariClaims } | null>;
  setClaims(uid: string, claims: PansariClaims): Promise<void>;
  audit(uid: string, storeId: string, ip: string | null): Promise<void>;
}

export interface QrSessionResult {
  status: number;
  body: { scopedStoreId: string; qrExp: number } | { error: string };
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;

export async function handleQrSession(rawBody: string, tsHeader: string | undefined, sigHeader: string | undefined, deps: QrSessionDeps): Promise<QrSessionResult> {
  const fail = (status: number, error: string): QrSessionResult => ({ status, body: { error } });

  if (!(await verifyEdgeRequest(rawBody, tsHeader, sigHeader, deps.edgeSecret, deps.now()))) return fail(401, 'BAD_EDGE_SIGNATURE');

  let body: { uid?: unknown; storeId?: unknown; qrToken?: unknown; ip?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return fail(400, 'INVALID_JSON');
  }
  const uid = typeof body.uid === 'string' && ID.test(body.uid) ? body.uid : null;
  const storeId = typeof body.storeId === 'string' && ID.test(body.storeId) ? body.storeId : null;
  if (!uid || !storeId || typeof body.qrToken !== 'string') return fail(400, 'INVALID_INPUT');

  // Re-verify the QR token here too (defence in depth: never trust the edge blindly).
  let ver: number;
  try {
    const p = await verifyToken(body.qrToken, { expectedType: 'store', secretFor: (k) => deps.qrSecrets[k], nowSeconds: deps.now() });
    if (p.sid !== storeId) return fail(403, 'QR_STORE_MISMATCH');
    ver = p.ver;
  } catch (e) {
    return fail(403, e instanceof TokenError ? `QR_${e.code}` : 'QR_INVALID');
  }

  const store = await deps.getStore(storeId);
  if (!store) return fail(404, 'STORE_NOT_FOUND');
  if (!store.isActive || !store.acceptsWalkInQr) return fail(403, 'STORE_NOT_ACCEPTING_QR');
  if (store.qrKeyVersion !== ver) return fail(403, 'QR_REVOKED');

  const user = await deps.getUser(uid);
  if (!user) return fail(404, 'USER_NOT_FOUND');
  if (user.disabled) return fail(403, 'USER_DISABLED');
  if (!user.isAnonymous) return fail(403, 'ANONYMOUS_SESSION_REQUIRED');
  // Never overwrite a privileged role with a guest role.
  if (user.claims.role && user.claims.role !== 'temp_qr_guest') return fail(403, 'ROLE_CONFLICT');

  const qrExp = deps.now() + QR_GUEST_SESSION_SECONDS;
  await deps.setClaims(uid, { role: 'temp_qr_guest', scopedStoreId: storeId, qrExp });
  await deps.audit(uid, storeId, typeof body.ip === 'string' ? body.ip.slice(0, 64) : null);
  return { status: 200, body: { scopedStoreId: storeId, qrExp } };
}
