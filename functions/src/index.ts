/**
 * Cloud Functions (v2).
 * Phase 1: identity, walk-in QR sessions, admin audit.
 * Phase 2: catalogue, pricing, stock movements, counter / QR billing, invoice PDFs.
 */
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onDocumentWrittenWithAuthContext } from 'firebase-functions/v2/firestore';
import { defineSecret, defineBoolean } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { COL, isRole, type PansariClaims } from '@pansari/shared';
import { adminAuth, db, writeAudit } from './lib/admin.js';
import { buildClaims, isPrivilegeReduction, RoleError, type RoleChangeInput } from './auth/roleLogic.js';
import { handleQrSession } from './qr/qrSessionLogic.js';

setGlobalOptions({ region: 'asia-south1', maxInstances: 10 });

const QR_HMAC_KEYS = defineSecret('QR_HMAC_KEYS');
const EDGE_SHARED_SECRET = defineSecret('EDGE_SHARED_SECRET');
/** Turn on once App Check is registered for every app (web + Android + iOS). */
const ENFORCE_APP_CHECK = defineBoolean('ENFORCE_APP_CHECK', { default: false });

function claimsOf(token: Record<string, unknown> | undefined): PansariClaims {
  const t = token ?? {};
  return {
    role: isRole(t.role) ? t.role : undefined,
    vendorId: typeof t.vendorId === 'string' ? t.vendorId : undefined,
    storeIds: Array.isArray(t.storeIds) ? (t.storeIds as string[]) : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* setUserRole — super admin assigns roles through custom claims        */
/* ------------------------------------------------------------------ */
export const setUserRole = onCall({ enforceAppCheck: ENFORCE_APP_CHECK, consumeAppCheckToken: false }, async (req) => {
  const caller = req.auth;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first');
  if (caller.token.role !== 'super_admin') throw new HttpsError('permission-denied', 'Only a super admin can assign roles');

  const input = req.data as RoleChangeInput;
  let before: PansariClaims = {};
  try {
    const claims = await buildClaims(input, caller.uid, {
      vendorExists: async (id) => (await db.collection(COL.vendors).doc(id).get()).exists,
      storeVendor: async (id) => {
        const s = await db.collection(COL.stores).doc(id).get();
        return s.exists ? String(s.get('vendorId') ?? '') : null;
      },
      countSuperAdmins: async () => {
        // Super admins are few; listUsers pages of 1000 are enough for a single business.
        let n = 0;
        let pageToken: string | undefined;
        do {
          const page = await adminAuth.listUsers(1000, pageToken);
          n += page.users.filter((u) => u.customClaims?.role === 'super_admin').length;
          pageToken = page.pageToken;
        } while (pageToken);
        return n;
      },
      currentClaims: async (uid) => {
        const u = await adminAuth.getUser(uid).catch(() => null);
        if (!u) throw new RoleError('not-found', `User ${uid} not found`);
        before = claimsOf(u.customClaims);
        return before;
      },
    });

    await adminAuth.setCustomUserClaims(input.uid, claims);
    if (isPrivilegeReduction(before, claims)) await adminAuth.revokeRefreshTokens(input.uid);
    const userRef = db.collection(COL.users).doc(input.uid);
    if ((await userRef.get()).exists) await userRef.update({ roleMirror: claims.role, updatedAt: new Date() });
    await writeAudit({ actorUid: caller.uid, actorRole: 'super_admin', action: 'role.set', target: { collection: 'auth_users', id: input.uid }, before, after: claims, ip: req.rawRequest.ip ?? null });
    logger.info('role.set', { target: input.uid, role: claims.role, by: caller.uid });
    return { ok: true, claims, note: 'The user must refresh their ID token (sign in again or getIdToken(true)) to receive the new role.' };
  } catch (e) {
    if (e instanceof RoleError) throw new HttpsError(e.code, e.message);
    throw e;
  }
});

/* ------------------------------------------------------------------ */
/* completeGuestUpgrade — walk-in guest linked a phone number           */
/* ------------------------------------------------------------------ */
export const completeGuestUpgrade = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (req) => {
  const a = req.auth;
  if (!a) throw new HttpsError('unauthenticated', 'Sign in first');
  const provider = (a.token.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
  if (provider === 'anonymous') throw new HttpsError('failed-precondition', 'Link a phone number before upgrading');
  if (a.token.role !== 'temp_qr_guest') return { ok: true, changed: false };
  await adminAuth.setCustomUserClaims(a.uid, {}); // becomes a regular customer
  await writeAudit({ actorUid: a.uid, actorRole: 'customer', action: 'guest.upgrade', target: { collection: 'auth_users', id: a.uid }, before: { role: 'temp_qr_guest', scopedStoreId: a.token.scopedStoreId }, after: {} });
  return { ok: true, changed: true };
});

/* ------------------------------------------------------------------ */
/* qrSessionClaim — called ONLY by the Cloudflare edge worker           */
/* ------------------------------------------------------------------ */
export const qrSessionClaim = onRequest({ secrets: [QR_HMAC_KEYS, EDGE_SHARED_SECRET], invoker: 'public', cors: false, maxInstances: 20 }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return;
  }
  let qrSecrets: Record<string, string>;
  try {
    qrSecrets = JSON.parse(QR_HMAC_KEYS.value()) as Record<string, string>;
  } catch {
    logger.error('QR_HMAC_KEYS secret is not valid JSON');
    res.status(500).json({ error: 'MISCONFIGURED' });
    return;
  }
  const result = await handleQrSession(req.rawBody?.toString('utf8') ?? '', req.get('X-Edge-Timestamp'), req.get('X-Edge-Signature'), {
    qrSecrets,
    edgeSecret: EDGE_SHARED_SECRET.value(),
    now: () => Math.floor(Date.now() / 1000),
    getStore: async (id) => {
      const s = await db.collection(COL.stores).doc(id).get();
      if (!s.exists) return null;
      return { vendorId: String(s.get('vendorId')), qrKeyVersion: Number(s.get('qrKeyVersion') ?? 0), isActive: s.get('isActive') === true, acceptsWalkInQr: s.get('acceptsWalkInQr') !== false };
    },
    getUser: async (uid) => {
      const u = await adminAuth.getUser(uid).catch(() => null);
      if (!u) return null;
      return { disabled: u.disabled, isAnonymous: u.providerData.length === 0, claims: claimsOf(u.customClaims) };
    },
    setClaims: (uid, claims) => adminAuth.setCustomUserClaims(uid, claims),
    audit: (uid, storeId, ip) => writeAudit({ actorUid: uid, actorRole: 'system', action: 'qr.session', target: { collection: COL.stores, id: storeId }, ip }),
  });
  if (result.status !== 200) logger.warn('qr.session.rejected', result.body);
  res.status(result.status).json(result.body);
});

/* ------------------------------------------------------------------ */
/* Audit every direct super-admin write to master data                  */
/* ------------------------------------------------------------------ */
function auditTrigger(collection: string) {
  return onDocumentWrittenWithAuthContext(`${collection}/{docId}`, async (event) => {
    const before = event.data?.before.exists ? event.data.before.data() : null;
    const after = event.data?.after.exists ? event.data.after.data() : null;
    const action = !before ? 'create' : !after ? 'delete' : 'update';
    await writeAudit({
      actorUid: event.authId ?? 'unknown',
      actorRole: event.authType === 'system' ? 'system' : 'super_admin',
      action: `${collection}.${action}`,
      target: { collection, id: event.params.docId },
      before,
      after,
    });
  });
}

export const auditStores = auditTrigger(COL.stores);
export const auditZones = auditTrigger(COL.zones);
export const auditHsnMaster = auditTrigger(COL.hsnMaster);
export const auditPlatformConfig = auditTrigger(COL.platformConfig);

/* ------------------------------------------------------------------ */
/* Phase 2                                                              */
/* ------------------------------------------------------------------ */
export { upsertProduct, reviewProduct, setStorePrice, inwardStock, adjustStock } from './stock/stockFns.js';
export { commitSale, getInvoicePdf } from './sales/commitSale.js';
export { bootstrapBusiness } from './setup/bootstrap.js';
