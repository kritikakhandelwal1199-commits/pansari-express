import { describe, expect, it } from 'vitest';
import { signEdgeRequest, signToken, type PansariClaims } from '@pansari/shared';
import { buildClaims, isPrivilegeReduction, type RoleDeps } from '../src/auth/roleLogic.js';
import { handleQrSession, type QrSessionDeps } from '../src/qr/qrSessionLogic.js';

const NOW = 1_800_000_000;
const QR = 'qr-secret-for-tests-at-least-32-chars-long';
const EDGE = 'edge-secret-for-tests-at-least-32-chars-long';

const roleDeps = (over: Partial<RoleDeps> = {}): RoleDeps => ({
  vendorExists: async (v) => v === 'V1',
  storeVendor: async (s) => ({ S1: 'V1', S2: 'V1', X9: 'V2' })[s] ?? null,
  countSuperAdmins: async () => 2,
  currentClaims: async () => ({}),
  ...over,
});

describe('setUserRole logic', () => {
  it('builds staff claims scoped to stores of the same vendor', async () => {
    expect(await buildClaims({ uid: 'u1', role: 'staff', vendorId: 'V1', storeIds: ['S1', 'S1', 'S2'] }, 'admin', roleDeps())).toEqual({ role: 'staff', vendorId: 'V1', storeIds: ['S1', 'S2'] });
  });
  it('rejects cross-vendor stores, unknown vendors and guest role grants', async () => {
    await expect(buildClaims({ uid: 'u1', role: 'staff', vendorId: 'V1', storeIds: ['X9'] }, 'admin', roleDeps())).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(buildClaims({ uid: 'u1', role: 'seller', vendorId: 'V7' }, 'admin', roleDeps())).rejects.toMatchObject({ code: 'not-found' });
    await expect(buildClaims({ uid: 'u1', role: 'temp_qr_guest' as never }, 'admin', roleDeps())).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(buildClaims({ uid: 'u1', role: 'rider', vendorId: 'V1' }, 'admin', roleDeps())).rejects.toMatchObject({ code: 'invalid-argument' });
  });
  it('prevents locking the platform out of super admins', async () => {
    const deps = roleDeps({ currentClaims: async () => ({ role: 'super_admin' }), countSuperAdmins: async () => 1 });
    await expect(buildClaims({ uid: 'admin', role: 'customer' }, 'admin', deps)).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(buildClaims({ uid: 'other', role: 'customer' }, 'admin', deps)).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('detects privilege reductions that need token revocation', () => {
    const before: PansariClaims = { role: 'staff', vendorId: 'V1', storeIds: ['S1', 'S2'] };
    expect(isPrivilegeReduction(before, { role: 'staff', vendorId: 'V1', storeIds: ['S1'] })).toBe(true);
    expect(isPrivilegeReduction(before, { role: 'staff', vendorId: 'V1', storeIds: ['S1', 'S2', 'S3'] })).toBe(false);
    expect(isPrivilegeReduction({ role: 'seller', vendorId: 'V1' }, { role: 'customer' })).toBe(true);
  });
});

describe('qrSessionClaim logic', () => {
  const claims: Record<string, PansariClaims> = {};
  const deps = (over: Partial<QrSessionDeps> = {}): QrSessionDeps => ({
    qrSecrets: { k1: QR },
    edgeSecret: EDGE,
    now: () => NOW,
    getStore: async (id) => (id === 'S1' ? { vendorId: 'V1', qrKeyVersion: 3, isActive: true, acceptsWalkInQr: true } : null),
    getUser: async (uid) => (uid === 'anon1' ? { disabled: false, isAnonymous: true, claims: {} } : uid === 'staff1' ? { disabled: false, isAnonymous: true, claims: { role: 'staff' } } : { disabled: false, isAnonymous: false, claims: {} }),
    setClaims: async (uid, c) => void (claims[uid] = c),
    audit: async () => undefined,
    ...over,
  });
  const call = async (body: object, d = deps()) => {
    const raw = JSON.stringify(body);
    const h = await signEdgeRequest(raw, EDGE, NOW);
    return handleQrSession(raw, h['X-Edge-Timestamp'], h['X-Edge-Signature'], d);
  };

  it('scopes a genuine anonymous walk-in to the store for 2 hours', async () => {
    const qrToken = await signToken({ t: 'store', sid: 'S1', ver: 3, iat: NOW - 50 }, 'k1', QR);
    const r = await call({ uid: 'anon1', storeId: 'S1', qrToken });
    expect(r).toEqual({ status: 200, body: { scopedStoreId: 'S1', qrExp: NOW + 7200 } });
    expect(claims.anon1).toEqual({ role: 'temp_qr_guest', scopedStoreId: 'S1', qrExp: NOW + 7200 });
  });

  it('rejects unsigned calls, revoked posters, non-anonymous users and role escalation', async () => {
    const good = await signToken({ t: 'store', sid: 'S1', ver: 3, iat: NOW - 50 }, 'k1', QR);
    const raw = JSON.stringify({ uid: 'anon1', storeId: 'S1', qrToken: good });
    expect((await handleQrSession(raw, String(NOW), 'ab'.repeat(32), deps())).body).toEqual({ error: 'BAD_EDGE_SIGNATURE' });
    const old = await signToken({ t: 'store', sid: 'S1', ver: 2, iat: NOW - 50 }, 'k1', QR);
    expect((await call({ uid: 'anon1', storeId: 'S1', qrToken: old })).body).toEqual({ error: 'QR_REVOKED' });
    expect((await call({ uid: 'phoneUser', storeId: 'S1', qrToken: good })).body).toEqual({ error: 'ANONYMOUS_SESSION_REQUIRED' });
    expect((await call({ uid: 'staff1', storeId: 'S1', qrToken: good })).body).toEqual({ error: 'ROLE_CONFLICT' });
    expect((await call({ uid: 'anon1', storeId: 'S2', qrToken: good })).body).toEqual({ error: 'QR_STORE_MISMATCH' });
  });

  it('rejects replayed edge requests older than two minutes', async () => {
    const qrToken = await signToken({ t: 'store', sid: 'S1', ver: 3, iat: NOW - 50 }, 'k1', QR);
    const raw = JSON.stringify({ uid: 'anon1', storeId: 'S1', qrToken });
    const h = await signEdgeRequest(raw, EDGE, NOW - 600);
    expect((await handleQrSession(raw, h['X-Edge-Timestamp'], h['X-Edge-Signature'], deps())).status).toBe(401);
  });
});
