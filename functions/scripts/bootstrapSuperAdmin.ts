/**
 * One-time bootstrap: make the first super admin (there is no one yet to call
 * setUserRole). Run locally with a service-account key — never ship this key.
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.json
 *   npm run bootstrap:admin -w functions -- +919XXXXXXXXX
 *
 * Against the emulator instead:
 *   export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GCLOUD_PROJECT=demo-pansari
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: bootstrapSuperAdmin <+91 phone number | uid>');
  process.exit(1);
}

initializeApp();
const auth = getAuth();
const user = arg.startsWith('+') ? await auth.getUserByPhoneNumber(arg.replace(/\s+/g, '')) : await auth.getUser(arg);
await auth.setCustomUserClaims(user.uid, { role: 'super_admin' });
await auth.revokeRefreshTokens(user.uid);
console.log(`super_admin granted to ${user.uid} (${user.phoneNumber ?? 'no phone'}). Sign in again to pick up the role.`);
