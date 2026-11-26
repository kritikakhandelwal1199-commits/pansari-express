#!/usr/bin/env node
/**
 * Pitch demo data for the LIVE project, run from Google Cloud Shell (signed in as the project owner):
 *   cd ~/pansari-express && GOOGLE_CLOUD_QUOTA_PROJECT=pansari-express node scripts/seed-live-demo.mjs
 *
 * 1. Registers Firebase "test phone numbers" (fixed code, no SMS) for a demo team.
 * 2. Loads the sample shop (stores, zones, GST master, products, FEFO stock) if it is not there yet.
 * 3. Makes OWNER_PHONE the super admin (same as First-time setup) and gives the demo team their roles.
 * 4. Drives the REAL Cloud Functions as those users: counter bills (B2C + B2B), online orders through
 *    every stage (rider + store delivery, COD cash hand-in, rider payout, wallet refund), a support
 *    ticket, stock inward, hygiene checks and rider KYC uploads — so every number is genuine.
 *
 *   --remove-demo      remove ALL demo test numbers and demo roles (run before going live with real users)
 * Safe to re-run: the business flows run once (platform_config/demo_seed marks them done).
 */
import { readFileSync } from 'node:fs';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { COL, DEMO_HSN, DEMO_PRODUCTS, DEMO_STORES, DEMO_VENDOR, DEMO_ZONES, deriveInventory, expandBatches, inventoryDocId, gstinCheckChar, HYGIENE_QUESTIONS } from '@pansari/shared';

const PROJECT = 'pansari-express';
const REGION = 'asia-south1';
const BUCKET = 'pansari-express.firebasestorage.app';
const OWNER_PHONE = '+918696131859';
const CODE = '123456';
const env = Object.fromEntries(readFileSync('apps/web/.env.production', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const API_KEY = env.NEXT_PUBLIC_FIREBASE_API_KEY;
if (!API_KEY) throw new Error('apps/web/.env.production is missing — run scripts/deploy-cloudshell.sh first');

const TEAM = [
  { key: 'owner', phone: '+919999900001', name: 'Ramesh Agarwal (shop owner)', role: 'seller', vendorId: 'V1', storeIds: [] },
  { key: 'picker', phone: '+919999900002', name: 'Sunita (picker, Johari Bazaar)', role: 'staff', vendorId: 'V1', storeIds: ['S1'] },
  { key: 'rider', phone: '+919999900003', name: 'Vikram Singh', role: 'rider', homeStoreId: 'S1', kyc: 'VERIFIED' },
  { key: 'compliance', phone: '+919999900004', name: 'Meera Joshi (compliance)', role: 'compliance' },
  { key: 'priya', phone: '+919999900005', name: 'Priya Sharma', role: 'customer' },
  { key: 'neha', phone: '+919999900006', name: 'Neha Gupta', role: 'customer' },
  { key: 'arjun', phone: '+919999900007', name: 'Arjun Meena', role: 'rider', homeStoreId: 'S1', kyc: 'PENDING' },
  { key: 'staff2', phone: '+919999900008', name: 'Amit (counter, Malviya Nagar)', role: 'staff', vendorId: 'V1', storeIds: ['S2'] },
];

initializeApp({ credential: applicationDefault(), projectId: PROJECT, storageBucket: BUCKET });
const auth = getAuth();
const db = getFirestore();
const args = new Set(process.argv.slice(2));
const log = (...a) => console.log('•', ...a);

/* ---------------- test phone numbers (Identity Toolkit admin config) ---------------- */
async function token() {
  const t = await applicationDefault().getAccessToken();
  return t.access_token;
}
async function setTestNumbers(mutate) {
  const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`;
  const h = { Authorization: `Bearer ${await token()}`, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' };
  const cur = await (await fetch(url, { headers: h })).json();
  const nums = { ...(cur.signIn?.phoneNumber?.testPhoneNumbers ?? {}) };
  mutate(nums);
  const r = await fetch(`${url}?updateMask=signIn.phoneNumber.testPhoneNumbers,signIn.phoneNumber.enabled`, { method: 'PATCH', headers: h, body: JSON.stringify({ signIn: { phoneNumber: { enabled: true, testPhoneNumbers: nums } } }) });
  if (!r.ok) throw new Error(`test numbers: ${r.status} ${await r.text()}`);
  return Object.keys(nums).length;
}

if (args.has('--remove-demo')) {
  const drop = TEAM;
  await setTestNumbers((n) => drop.forEach((t) => delete n[t.phone]));
  for (const t of drop) {
    const u = await auth.getUserByPhoneNumber(t.phone).catch(() => null);
    if (u) { await auth.setCustomUserClaims(u.uid, {}); await auth.revokeRefreshTokens(u.uid); }
  }
  log(`removed ${drop.length} demo login(s)`);
  process.exit(0);
}

/* ---------------- 1. test numbers ---------------- */
log('test numbers:', await setTestNumbers((n) => TEAM.forEach((t) => (n[t.phone] = CODE))));

/* ---------------- 2. sample business ---------------- */
async function seedBusiness(nowMs = Date.now()) {
  const ts = (ms) => (ms === null ? null : Timestamp.fromMillis(ms));
  const w = db.bulkWriter();
  w.set(db.collection(COL.vendors).doc(DEMO_VENDOR.vendorId), { ...DEMO_VENDOR, kycStatus: 'VERIFIED', commissionBps: 0, isActive: true, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
  for (const s of DEMO_STORES) w.set(db.collection(COL.stores).doc(s.storeId), { ...s, vendorId: DEMO_VENDOR.vendorId, gstin: null, fssaiLicenseNo: null, zoneId: DEMO_ZONES.find((z) => z.storeIds.includes(s.storeId))?.zoneId ?? null, openingHours: { open: '08:00', close: '22:00' }, qrKeyVersion: 1, isActive: true, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
  for (const z of DEMO_ZONES) w.set(db.collection(COL.zones).doc(z.zoneId), { ...z, updatedAt: Timestamp.now() });
  for (const h of DEMO_HSN) w.set(db.collection(COL.hsnMaster).doc(h.hsnCode), { ...h, cessRate: 0, updatedBy: 'seed', updatedAt: Timestamp.now() });
  const slabOf = (hsn) => DEMO_HSN.find((h) => hsn.startsWith(h.hsnCode)).gstSlab;
  for (const p of DEMO_PRODUCTS) {
    w.set(db.collection(COL.products).doc(p.productId), { productId: p.productId, vendorId: DEMO_VENDOR.vendorId, name: p.name, nameHi: p.nameHi, category: p.category, brand: p.brand, barcode: p.barcode, images: [], unit: p.unit, netQuantity: p.netQuantity, hsnCode: p.hsnCode, gstSlab: slabOf(p.hsnCode), cessRate: 0, taxType: p.taxType, mrp: p.mrp, manufacturerName: p.brand, manufacturerAddress: 'Jaipur, Rajasthan', countryOfOrigin: 'India', customerCareDetails: null, fssaiRequired: p.category !== 'pooja', isVeg: true, complianceStatus: p.approved ? 'APPROVED' : 'PENDING_REVIEW', complianceNote: null, isPublished: p.approved, searchTokens: p.name.toLowerCase().split(/\W+/).filter((x) => x.length > 1), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    for (const [storeId, s] of Object.entries(p.stock)) {
      const bs = expandBatches(p, storeId, nowMs);
      const d = deriveInventory(bs, s.reorder, nowMs);
      const inv = db.collection(COL.storeInventory).doc(inventoryDocId(storeId, p.productId));
      w.set(inv, { storeId, vendorId: DEMO_VENDOR.vendorId, productId: p.productId, productName: p.name, sellingPrice: s.price, mrp: p.mrp, onHand: d.onHand, reorderThreshold: s.reorder, aisleBinCode: s.bin, isListed: true, lowStock: d.lowStock, nearestExpiry: ts(d.nearestExpiryMs), nextBatchNumber: d.nextBatchNumber, updatedAt: Timestamp.now() });
      for (const b of bs) w.set(inv.collection(COL.batches).doc(b.batchId), { batchId: b.batchId, storeId, vendorId: DEMO_VENDOR.vendorId, productId: p.productId, batchNumber: b.batchNumber, mfgDate: ts(b.mfgMs), expiryDate: ts(b.expiryMs), purchasePrice: b.purchasePrice, mrp: b.mrp, qty: b.qty, receivedAt: ts(b.receivedMs), receivedBy: 'seed', recalled: false });
    }
  }
  await w.close();
}
if (!(await db.collection(COL.stores).doc('S1').get()).exists) {
  await seedBusiness();
  log(`sample shop loaded: ${DEMO_STORES.length} stores, ${DEMO_PRODUCTS.length} products`);
} else log('sample shop already present');

/* ---------------- 3. people & roles ---------------- */
async function userByPhone(phone, displayName) {
  const u = await auth.getUserByPhoneNumber(phone).catch(() => null);
  if (u) { if (displayName && u.displayName !== displayName) await auth.updateUser(u.uid, { displayName }); return u.uid; }
  return (await auth.createUser({ phoneNumber: phone, displayName })).uid;
}
const ownerUid = await userByPhone(OWNER_PHONE, 'Rahul');
await auth.setCustomUserClaims(ownerUid, { role: 'super_admin' });
await db.collection(COL.platformConfig).doc('bootstrap').set({ by: ownerUid, phone: OWNER_PHONE, at: FieldValue.serverTimestamp(), via: 'seed-live-demo' }, { merge: true });
log('super admin:', OWNER_PHONE);

const uid = {};
for (const t of TEAM) {
  uid[t.key] = await userByPhone(t.phone, t.name);
  const claims = t.role === 'customer' ? {} : t.role === 'seller' || t.role === 'staff' ? { role: t.role, vendorId: t.vendorId, storeIds: t.storeIds } : { role: t.role };
  await auth.setCustomUserClaims(uid[t.key], claims);
  if (t.role === 'rider') {
    const ref = db.collection(COL.riders).doc(uid[t.key]);
    const snap = await ref.get();
    const base = { uid: uid[t.key], name: t.name, phone: t.phone, vehicleType: 'SCOOTER', vehicleNumber: t.key === 'rider' ? 'RJ14 SX 4821' : null, homeStoreId: t.homeStoreId, vendorId: 'V1' };
    if (snap.exists) await ref.update({ ...base, kycStatus: t.kyc });
    else await ref.set({ ...base, kycStatus: t.kyc, isOnline: false, lastLocation: null, lastSeenAt: null, codCashInHand: 0, earningsBalance: 0, activeOrderIds: [] });
  }
}
const ADDR = {
  priya: { id: 'a-home', label: 'Home', line1: '14, Raja Park, near Gol Market', city: 'Jaipur', pincode: '302004', stateCode: '08', location: { lat: 26.8936, lng: 75.8268 } },
  neha: { id: 'a-home', label: 'Home', line1: 'B-22, Malviya Nagar, Sector 3', city: 'Jaipur', pincode: '302017', stateCode: '08', location: { lat: 26.8545, lng: 75.8139 } },
};
for (const k of ['priya', 'neha']) {
  const ref = db.collection(COL.users).doc(uid[k]);
  const s = await ref.get();
  if (!s.exists) await ref.set({ uid: uid[k], displayName: TEAM.find((t) => t.key === k).name, phone: TEAM.find((t) => t.key === k).phone, email: null, roleMirror: 'customer', addresses: [ADDR[k]], loyaltyPoints: 0, walletBalance: 0, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  else await ref.update({ addresses: [ADDR[k]], updatedAt: FieldValue.serverTimestamp() });
}
log('demo team ready:', TEAM.length, 'logins');

/* ---------------- 4. business flows through the real functions ---------------- */
const flag = db.collection(COL.platformConfig).doc('demo_seed');
if ((await flag.get()).exists && !args.has('--force')) {
  log('demo flows already ran (use --force to add another round)');
  process.exit(0);
}

const ID_URL = 'https://identitytoolkit.googleapis.com/v1/accounts';
async function signIn(phone) {
  const a = await (await fetch(`${ID_URL}:sendVerificationCode?key=${API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phoneNumber: phone, recaptchaToken: 'NO_RECAPTCHA' }) })).json();
  if (!a.sessionInfo) throw new Error(`sendVerificationCode ${phone}: ${JSON.stringify(a)}`);
  const b = await (await fetch(`${ID_URL}:signInWithPhoneNumber?key=${API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionInfo: a.sessionInfo, code: CODE }) })).json();
  if (!b.idToken) throw new Error(`signIn ${phone}: ${JSON.stringify(b)}`);
  return b.idToken;
}
const tok = {};
for (const t of TEAM) tok[t.key] = await signIn(t.phone);
async function call(who, name, data) {
  const r = await fetch(`https://${REGION}-${PROJECT}.cloudfunctions.net/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok[who]}` }, body: JSON.stringify({ data }) });
  const j = await r.json().catch(() => ({}));
  if (j.error) throw new Error(`${name} as ${who}: ${j.error.message}`);
  return j.result;
}
const otpOf = async (orderId) => (await db.collection(COL.orderSecrets).doc(orderId).get()).get('deliveryOtp');
const step = async (who, orderId, to, extra = {}) => call(who, 'advanceOrder', { orderId, to, ...extra });

// Stock inward (ledger + new FEFO batch)
const d = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
await call('owner', 'inwardStock', { storeId: 'S1', productId: 'badam-500', batchNumber: 'BD-2611', mfgDate: d(-20), expiryDate: d(240), qty: 24, purchasePrice: 35500, mrp: 49000, reference: 'Bill 4471 — Shree Dry Fruits' });
await call('owner', 'inwardStock', { storeId: 'S1', productId: 'shatavari-100', batchNumber: 'SH-2612', mfgDate: d(-10), expiryDate: d(500), qty: 20, purchasePrice: 9500, mrp: 17500, reference: 'Bill 4472 — Vaidya Ji Pharmacy' });
log('stock received (2 inward bills)');

// Counter bills
const bills = [];
bills.push(await call('picker', 'commitSale', { storeId: 'S1', channel: 'POS_WALKIN', items: [{ productId: 'kapur-50', qty: 2 }, { productId: 'dhoop-20', qty: 3 }], payment: { method: 'CASH' } }));
bills.push(await call('picker', 'commitSale', { storeId: 'S1', channel: 'POS_WALKIN', items: [{ productId: 'gond-250', qty: 1 }, { productId: 'kamarkas-100', qty: 1 }, { productId: 'panjiri-500', qty: 1 }], payment: { method: 'UPI_QR', providerRef: 'UPI-DEMO-1182' } }));
bills.push(await call('picker', 'commitSale', { storeId: 'S1', channel: 'POS_WALKIN', items: [{ productId: 'atta-5kg', qty: 2 }, { productId: 'namak-1kg', qty: 2 }, { productId: 'sarson-1l', qty: 1 }], payment: { method: 'CASH' } }));
const buyerGstin = (f) => f + gstinCheckChar(f);
bills.push(await call('picker', 'commitSale', { storeId: 'S1', channel: 'POS_WALKIN', items: [{ productId: 'kaju-500', qty: 2 }, { productId: 'kishmish-250', qty: 4 }, { productId: 'thali-set', qty: 1 }], payment: { method: 'UPI_QR', providerRef: 'UPI-DEMO-1190' }, buyer: { name: 'Hotel Raj Vilas Caterers', gstin: buyerGstin('08AABCR5521K1Z'), address: 'MI Road, Jaipur 302001' } }));
bills.push(await call('staff2', 'commitSale', { storeId: 'S2', channel: 'POS_WALKIN', items: [{ productId: 'haldi-kit', qty: 1 }, { productId: 'kapur-50', qty: 1 }], payment: { method: 'CARD', providerRef: 'CARD-DEMO-77' } }));
log('counter bills:', bills.map((b) => `${b.invoiceNo} ${b.kind} ₹${(b.grandTotal / 100).toFixed(2)}`).join(', '));

// Wallets
await call('priya', 'topUpWallet', { amount: 100000, simulateOutcome: 'success' });
await call('neha', 'topUpWallet', { amount: 50000, simulateOutcome: 'success' });
log('wallets topped up (Priya ₹1,000, Neha ₹500)');

// Rider Vikram goes on shift near Johari Bazaar
await call('rider', 'setRiderShift', { online: true, location: { lat: 26.9205, lng: 75.8251 } });

// O1: Priya, COD, full rider journey → delivered, cash handed in, rider paid
const o1 = await call('priya', 'placeOrder', { addressId: 'a-home', storeId: 'S1', items: [{ productId: 'gond-250', qty: 2 }, { productId: 'shatavari-100', qty: 1 }], paymentMethod: 'COD' });
await step('picker', o1.orderId, 'ACCEPTED');
await call('picker', 'assignRider', { orderId: o1.orderId, riderUid: uid.rider });
await step('picker', o1.orderId, 'PICKING');
await step('picker', o1.orderId, 'PACKED');
await step('rider', o1.orderId, 'HANDED_TO_RIDER');
await step('rider', o1.orderId, 'OUT_FOR_DELIVERY');
await step('rider', o1.orderId, 'DELIVERED', { otp: await otpOf(o1.orderId) });
await call('owner', 'receiveCodCash', { storeId: 'S1', riderUid: uid.rider, amount: o1.grandTotal });
await call('owner', 'payRider', { riderUid: uid.rider, amount: 3000, method: 'UPI', reference: 'UPI-PAYOUT-0001' });
log('O1 COD delivered by rider, cash received, rider paid:', o1.orderId);

// O2: Neha, UPI (test mode), store delivery from Malviya Nagar → delivered
const o2 = await call('neha', 'placeOrder', { addressId: 'a-home', storeId: 'S2', items: [{ productId: 'atta-5kg', qty: 1 }, { productId: 'kaju-500', qty: 1 }], paymentMethod: 'UPI_INTENT', simulateOutcome: 'success' });
for (const s of ['ACCEPTED', 'PICKING', 'PACKED', 'OUT_FOR_DELIVERY']) await step('staff2', o2.orderId, s);
await step('staff2', o2.orderId, 'DELIVERED', { otp: await otpOf(o2.orderId) });
log('O2 UPI delivered by store:', o2.orderId);

// O3: Priya, wallet, cancelled by customer → instant wallet refund
const o3 = await call('priya', 'placeOrder', { addressId: 'a-home', storeId: 'S1', items: [{ productId: 'mehndi-12', qty: 1 }, { productId: 'haldi-kit', qty: 1 }], paymentMethod: 'WALLET' });
await call('priya', 'cancelOrder', { orderId: o3.orderId, reason: 'Ordered by mistake' });
log('O3 wallet order cancelled + refunded:', o3.orderId);

// O4: Priya, COD, packed and waiting at the store (rider can collect live)
const o4 = await call('priya', 'placeOrder', { addressId: 'a-home', storeId: 'S1', items: [{ productId: 'badam-500', qty: 1 }, { productId: 'chai-250', qty: 1 }], paymentMethod: 'COD' });
await step('picker', o4.orderId, 'ACCEPTED');
await call('picker', 'assignRider', { orderId: o4.orderId, riderUid: uid.rider });
await step('picker', o4.orderId, 'PICKING');
await step('picker', o4.orderId, 'PACKED');
log('O4 packed, assigned to Vikram (collect live):', o4.orderId);

// O5: Priya, UPI, just placed — accept it live in the pitch
const o5 = await call('priya', 'placeOrder', { addressId: 'a-home', storeId: 'S1', items: [{ productId: 'kaju-500', qty: 1 }, { productId: 'kishmish-250', qty: 2 }, { productId: 'dhoop-20', qty: 2 }], paymentMethod: 'UPI_INTENT', simulateOutcome: 'success' });
log('O5 new order waiting for the store:', o5.orderId);

// Support ticket from Priya about her delivered order
await call('priya', 'createSupportTicket', { category: 'DAMAGED_ITEM', subject: 'One gond packet seal was loose', orderId: o1.orderId, storeId: 'S1', transcript: [{ from: 'user', text: 'Gond ka ek packet ki seal khuli thi', at: Date.now() - 60_000 }, { from: 'bot', text: 'Sorry! Main isko store team ko bhej raha hoon.', at: Date.now() - 55_000 }] });
log('support ticket raised');

// Hygiene checks (direct Firestore writes, as the staff app does)
const hy = (kind, storeId, by, byName, fails = {}, temperatureC = null) => ({
  storeId, vendorId: 'V1', kind, temperatureC, flagged: Object.keys(fails).length > 0 || (temperatureC !== null && (temperatureC < 2 || temperatureC > 8)),
  answers: HYGIENE_QUESTIONS[kind].map((q, i) => (fails[i] ? { question: q, ok: false, note: fails[i] } : { question: q, ok: true })),
  submittedBy: by, submittedByName: byName, submittedAt: Timestamp.fromMillis(Date.now() - 3 * 3_600_000), reviewStatus: 'PENDING', reviewerUid: null, reviewNote: null,
});
await db.collection(COL.complianceChecks).add(hy('HYGIENE_DAILY', 'S1', uid.picker, 'Sunita'));
await db.collection(COL.complianceChecks).add(hy('COLD_CHAIN', 'S1', uid.picker, 'Sunita', {}, 5.5));
await db.collection(COL.complianceChecks).add(hy('PEST_CONTROL', 'S2', uid.staff2, 'Amit', { 1: 'Service due on 30 Nov, vendor called' }));
log('hygiene checks: 3 (1 flagged)');

// Rider KYC uploads for Arjun (pending review in Compliance)
const bucket = getStorage().bucket();
const svg = (title) => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" rx="24" fill="#f4efe6"/><rect x="24" y="24" width="592" height="352" rx="16" fill="#fff" stroke="#c9b99a"/><text x="48" y="90" font-family="Arial" font-size="30" font-weight="700" fill="#5b4a2f">${title}</text><text x="48" y="140" font-family="Arial" font-size="22" fill="#333">Name: Arjun Meena</text><text x="48" y="180" font-family="Arial" font-size="22" fill="#333">Jaipur, Rajasthan</text><text x="48" y="330" font-family="Arial" font-size="20" fill="#b00">SAMPLE DOCUMENT — DEMO ONLY</text></svg>`;
for (const [docType, title] of [['DRIVING_LICENSE', 'Driving licence'], ['VEHICLE_RC', 'Vehicle RC'], ['AADHAAR_MASKED', 'Aadhaar (masked) XXXX XXXX 4417']]) {
  const path = `kyc/${uid.arjun}/${docType.toLowerCase()}-${Date.now()}.svg`;
  await bucket.file(path).save(svg(title), { contentType: 'image/svg+xml' });
  await db.collection(COL.kycDocuments).add({ ownerUid: uid.arjun, ownerType: 'RIDER', vendorId: null, docType, storagePath: path, fileName: `${docType.toLowerCase()}.svg`, status: 'PENDING', reviewerUid: null, reviewNote: null, createdAt: FieldValue.serverTimestamp(), reviewedAt: null, ...(docType === 'AADHAAR_MASKED' ? { maskedConfirmed: true } : {}) });
}
log('Arjun uploaded 3 KYC documents (pending review)');

await flag.set({ at: FieldValue.serverTimestamp(), orders: [o1.orderId, o2.orderId, o3.orderId, o4.orderId, o5.orderId], bills: bills.map((b) => b.invoiceNo) });
console.log('\nDEMO READY — log in at https://pansari-express.web.app/login with code', CODE);
for (const t of TEAM) console.log(`  ${t.phone}  ${t.name}`);
