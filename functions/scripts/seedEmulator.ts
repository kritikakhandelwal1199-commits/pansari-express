/**
 * Seeds the Firebase emulators with the demo business, stores, tax master,
 * products, stock and test users.
 *
 *   npm run emulators                          (in another terminal)
 *   npm run build -w @pansari/shared
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *   GCLOUD_PROJECT=demo-pansari npm run seed -w functions
 *
 * Test logins (OTP 123456 in the emulator):
 *   +91 9999999990  super admin      +91 9999999991  shop owner (seller)
 *   +91 9999999992  staff @ Johari   +91 9999999993  staff @ Godown
 *   +91 9999999999  customer
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { seedBusiness } from '../src/setup/seedData.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Refusing to seed: FIRESTORE_EMULATOR_HOST is not set (this script is for the emulator only).');
  process.exit(1);
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-pansari' });
const db = getFirestore();
const auth = getAuth();
const now = Date.now();

const counts = await seedBusiness(db, now);

const users: [string, string, Record<string, unknown>][] = [
  ['+919999999990', 'Admin', { role: 'super_admin' }],
  ['+919999999991', 'Shop owner', { role: 'seller', vendorId: 'V1', storeIds: [] }],
  ['+919999999992', 'Ramesh (Johari staff)', { role: 'staff', vendorId: 'V1', storeIds: ['S1'] }],
  ['+919999999993', 'Kalu (Godown staff)', { role: 'staff', vendorId: 'V1', storeIds: ['G1'] }],
  ['+919999999999', 'Neha (customer)', {}],
];
for (const [phoneNumber, displayName, claims] of users) {
  const u = await auth.getUserByPhoneNumber(phoneNumber).catch(() => auth.createUser({ phoneNumber, displayName }));
  await auth.setCustomUserClaims(u.uid, claims);
}
console.log(`Seeded ${counts.stores} stores, ${counts.products} products and ${users.length} users.`);
