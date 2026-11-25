/**
 * bootstrapBusiness — one-time setup on a fresh project, with no service-account
 * key needed on anyone's laptop.
 *
 * Only the phone number in the BOOTSTRAP_PHONE parameter can run it, and only
 * once (platform_config/bootstrap is created in the same transaction). It loads
 * the sample shop and makes the caller the super admin (Rahul). The super admin
 * then adds the shop owner, staff, riders and compliance in Admin → People & roles.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { COL, DEMO_VENDOR } from '@pansari/shared';
import { adminAuth, db, writeAudit } from '../lib/admin.js';
import { seedBusiness } from './seedData.js';

const BOOTSTRAP_PHONE = defineString('BOOTSTRAP_PHONE', { description: 'Phone number (E.164) allowed to run first-time setup' });

export const bootstrapBusiness = onCall(async (req) => {
  const a = req.auth;
  if (!a) throw new HttpsError('unauthenticated', 'Sign in first');
  const phone = (a.token as { phone_number?: string }).phone_number;
  if (!phone || phone !== BOOTSTRAP_PHONE.value()) throw new HttpsError('permission-denied', 'This number is not allowed to run first-time setup');
  const flag = db.collection(COL.platformConfig).doc('bootstrap');
  try {
    await flag.create({ by: a.uid, phone, at: FieldValue.serverTimestamp() });
  } catch {
    throw new HttpsError('already-exists', 'Setup has already been done');
  }
  const loadSample = req.data?.loadSample !== false;
  const counts = loadSample ? await seedBusiness(db) : { stores: 0, products: 0 };
  await adminAuth.setCustomUserClaims(a.uid, { role: 'super_admin' });
  void DEMO_VENDOR; // sample data uses vendor V1; owners are added from the admin portal
  await writeAudit({ actorUid: a.uid, actorRole: 'system', action: 'platform.bootstrap', target: { collection: COL.platformConfig, id: 'bootstrap' }, after: counts });
  return { ok: true, ...counts, note: 'Sign out and in again, or refresh, to receive the super admin role.' };
});
