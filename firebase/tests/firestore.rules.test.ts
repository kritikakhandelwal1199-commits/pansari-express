/**
 * Security rules tests — run against the Firestore emulator:
 *   npm run test:rules
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, Timestamp, collection, query, where, getDocs } from 'firebase/firestore';

let env: RulesTestEnvironment;
const now = () => Math.floor(Date.now() / 1000);

const ctx = {
  public: () => env.unauthenticatedContext().firestore(),
  anon: (uid = 'anon1') => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore(),
  guest: (uid = 'guest1', storeId = 'S1', exp = now() + 3600) =>
    env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' }, role: 'temp_qr_guest', scopedStoreId: storeId, qrExp: exp }).firestore(),
  upgradedGuest: (uid = 'guest1') =>
    env.authenticatedContext(uid, { firebase: { sign_in_provider: 'phone' }, phone_number: '+919999999999', role: 'temp_qr_guest', scopedStoreId: 'S1', qrExp: now() + 3600 }).firestore(),
  customer: (uid = 'cust1') => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'phone' }, phone_number: '+919999999999' }).firestore(),
  seller: (vendorId = 'V1', uid = 'seller1') => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'phone' }, role: 'seller', vendorId, storeIds: [] }).firestore(),
  staff: (storeIds = ['S1'], uid = 'staff1') => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'phone' }, role: 'staff', vendorId: 'V1', storeIds }).firestore(),
  rider: (uid = 'rider1') => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'phone' }, phone_number: '+918888888888', role: 'rider' }).firestore(),
  superAdmin: () => env.authenticatedContext('admin1', { firebase: { sign_in_provider: 'phone' }, role: 'super_admin' }).firestore(),
};

const inv = (storeId: string, productId: string, vendorId = 'V1') => ({
  storeId, vendorId, productId, productName: 'Kapur', sellingPrice: 8500, mrp: 9500, onHand: 12, reorderThreshold: 5,
  aisleBinCode: 'A1-R1', isListed: true, lowStock: false, nearestExpiry: null, nextBatchNumber: 'B-01', updatedAt: Timestamp.now(),
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-pansari',
    firestore: { rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'stores/S1'), { storeId: 'S1', vendorId: 'V1', name: 'Johari Bazaar', stateCode: '08', qrKeyVersion: 1, isActive: true });
    await setDoc(doc(db, 'stores/S2'), { storeId: 'S2', vendorId: 'V1', name: 'Malviya Nagar', stateCode: '08', qrKeyVersion: 1, isActive: true });
    await setDoc(doc(db, 'store_inventory/S1_p12'), inv('S1', 'p12'));
    await setDoc(doc(db, 'store_inventory/S2_p12'), inv('S2', 'p12'));
    await setDoc(doc(db, 'store_inventory/S1_p12/batches/b1'), { batchId: 'b1', storeId: 'S1', vendorId: 'V1', productId: 'p12', purchasePrice: 6000, qty: 12 });
    await setDoc(doc(db, 'orders/o1'), { orderId: 'o1', storeId: 'S1', vendorId: 'V1', customerUid: 'cust1', guestUid: null, riderUid: null });
    await setDoc(doc(db, 'riders/rider1'), { uid: 'rider1', kycStatus: 'PENDING', isOnline: false, lastLocation: null, lastSeenAt: null, codCashInHand: 0 });
  });
});

describe('public + anonymous', () => {
  it('anyone can read the public store card', async () => {
    await assertSucceeds(getDoc(doc(ctx.public(), 'stores/S1')));
  });
  it('unauthenticated and plain-anonymous users cannot read stock or prices', async () => {
    await assertFails(getDoc(doc(ctx.public(), 'store_inventory/S1_p12')));
    await assertFails(getDoc(doc(ctx.anon(), 'store_inventory/S1_p12')));
  });
  it('nobody can write audit logs or counters from a client', async () => {
    await assertFails(setDoc(doc(ctx.superAdmin(), 'audit_logs/x'), { a: 1 }));
    await assertFails(getDoc(doc(ctx.superAdmin(), 'counters/V1_2026-27')));
  });
});

describe('temp_qr_guest scoping', () => {
  it('reads listed stock of its scanned store only', async () => {
    await assertSucceeds(getDoc(doc(ctx.guest(), 'store_inventory/S1_p12')));
    await assertFails(getDoc(doc(ctx.guest(), 'store_inventory/S2_p12')));
    await assertSucceeds(getDocs(query(collection(ctx.guest(), 'store_inventory'), where('storeId', '==', 'S1'), where('isListed', '==', true))));
    await assertFails(getDocs(query(collection(ctx.guest(), 'store_inventory'), where('isListed', '==', true))));
  });
  it('cannot see batches (purchase price)', async () => {
    await assertFails(getDoc(doc(ctx.guest(), 'store_inventory/S1_p12/batches/b1')));
  });
  it('loses access once the session expires', async () => {
    await assertFails(getDoc(doc(ctx.guest('guest1', 'S1', now() - 10), 'store_inventory/S1_p12')));
  });
  it('cannot change price or stock', async () => {
    await assertFails(updateDoc(doc(ctx.guest(), 'store_inventory/S1_p12'), { sellingPrice: 1 }));
  });
  it('creates a 10-minute cart only for its own store', async () => {
    const ok = { cartId: 'c1', storeId: 'S1', vendorId: 'V1', guestUid: 'guest1', items: [{ productId: 'p12', qty: 1 }], status: 'OPEN', createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 9 * 60 * 1000) };
    await assertSucceeds(setDoc(doc(ctx.guest(), 'temp_carts/c1'), ok));
    await assertFails(setDoc(doc(ctx.guest(), 'temp_carts/c2'), { ...ok, cartId: 'c2', storeId: 'S2' }));
    await assertFails(setDoc(doc(ctx.guest(), 'temp_carts/c3'), { ...ok, cartId: 'c3', expiresAt: Timestamp.fromMillis(Date.now() + 30 * 60 * 1000) }));
    await assertFails(setDoc(doc(ctx.guest(), 'temp_carts/c4'), { ...ok, cartId: 'c4', unitPrice: 1 }));
    await assertFails(setDoc(doc(ctx.guest('guest2'), 'temp_carts/c5'), { ...ok, cartId: 'c5' }));
    await assertFails(updateDoc(doc(ctx.guest(), 'temp_carts/c1'), { status: 'CONSUMED' }));
    await assertSucceeds(updateDoc(doc(ctx.guest(), 'temp_carts/c1'), { status: 'CHECKOUT_PENDING' }));
  });
  it('an upgraded guest becomes a customer, not a scoped guest', async () => {
    await assertSucceeds(getDoc(doc(ctx.upgradedGuest(), 'store_inventory/S2_p12')));
    await assertFails(getDoc(doc(ctx.upgradedGuest(), 'store_inventory/S1_p12/batches/b1')));
  });
});

describe('sellers and staff', () => {
  it('seller edits shelf metadata but never price or stock', async () => {
    await assertSucceeds(updateDoc(doc(ctx.seller(), 'store_inventory/S1_p12'), { aisleBinCode: 'B2-R4', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(ctx.seller(), 'store_inventory/S1_p12'), { sellingPrice: 100, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(ctx.seller(), 'store_inventory/S1_p12'), { onHand: 999, updatedAt: serverTimestamp() }));
  });
  it('another vendor is locked out', async () => {
    await assertFails(getDoc(doc(ctx.seller('V2'), 'store_inventory/S1_p12')));
    await assertFails(getDoc(doc(ctx.seller('V2'), 'store_inventory/S1_p12/batches/b1')));
  });
  it('staff only operate their own stores', async () => {
    await assertSucceeds(getDoc(doc(ctx.staff(['S1']), 'store_inventory/S1_p12/batches/b1')));
    await assertSucceeds(updateDoc(doc(ctx.staff(['S1']), 'store_inventory/S1_p12'), { isListed: false, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(ctx.staff(['S1']), 'store_inventory/S2_p12'), { isListed: false, updatedAt: serverTimestamp() }));
  });
  it('no client can write orders or invoices', async () => {
    await assertFails(setDoc(doc(ctx.seller(), 'orders/o2'), { storeId: 'S1', vendorId: 'V1' }));
    await assertFails(setDoc(doc(ctx.seller(), 'invoices/i1'), { storeId: 'S1', vendorId: 'V1' }));
  });
});

describe('customers', () => {
  it('read their own order only', async () => {
    await assertSucceeds(getDoc(doc(ctx.customer('cust1'), 'orders/o1')));
    await assertFails(getDoc(doc(ctx.customer('cust2'), 'orders/o1')));
  });
  it('cannot give themselves wallet money or a role', async () => {
    const base = { uid: 'cust1', displayName: 'Neha', phone: '+919999999999', email: null, roleMirror: 'customer', addresses: [], loyaltyPoints: 0, walletBalance: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await assertFails(setDoc(doc(ctx.customer('cust1'), 'users/cust1'), { ...base, walletBalance: 100000 }));
    await assertFails(setDoc(doc(ctx.customer('cust1'), 'users/cust1'), { ...base, roleMirror: 'super_admin' }));
    await assertSucceeds(setDoc(doc(ctx.customer('cust1'), 'users/cust1'), base));
    await assertFails(updateDoc(doc(ctx.customer('cust1'), 'users/cust1'), { loyaltyPoints: 500 }));
  });
});

describe('riders', () => {
  it('cannot go online before KYC is verified, and cannot touch COD balance', async () => {
    await assertFails(updateDoc(doc(ctx.rider(), 'riders/rider1'), { isOnline: true, lastSeenAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(ctx.rider(), 'riders/rider1'), { codCashInHand: -5000, lastSeenAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(ctx.rider(), 'riders/rider1'), { lastLocation: { lat: 26.9, lng: 75.8 }, lastSeenAt: serverTimestamp() }));
  });
});

describe('super admin tax master', () => {
  it('accepts only legal GST slabs and valid HSN ids', async () => {
    const row = { hsnCode: '2914', description: 'Camphor', gstSlab: 18, cessRate: 0, updatedBy: 'admin1', updatedAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(ctx.superAdmin(), 'hsn_master/2914'), row));
    await assertFails(setDoc(doc(ctx.superAdmin(), 'hsn_master/2914'), { ...row, gstSlab: 7 }));
    await assertFails(setDoc(doc(ctx.superAdmin(), 'hsn_master/123'), { ...row, hsnCode: '123' }));
    await assertFails(setDoc(doc(ctx.seller(), 'hsn_master/2914'), row));
  });
});
