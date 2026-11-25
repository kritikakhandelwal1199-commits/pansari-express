import { describe, expect, it } from 'vitest';
import { rectangleGeometry } from '@pansari/shared';
import { DemoDataClient } from '@/lib/data/demo';

const fresh = () => new DemoDataClient({ storage: null, sessionStorage: null });
const login = async (c: DemoDataClient, phone: string) => c.verifyOtp((await c.sendOtp(phone)).verificationId, '123456');
const ADMIN = '+919999999990';
const OWNER = '+919999999991';
const SALES_BOY = '+919999999992';
const PRIYA = '+919999999994';
const VIKRAM = '+919999999995';
const ARJUN = '+919999999996';
const MEERA = '+919999999997';
const SUNITA = '+919999999998';

async function placeCod(c: DemoDataClient, items = [{ productId: 'kapur-50', qty: 2 }]) {
  await login(c, PRIYA);
  const prof = await c.myProfile();
  const o = await c.placeOrder({ addressId: prof.addresses[0]!.id, storeId: 'S1', items, paymentMethod: 'COD' });
  const otp = (await c.getOrder(o.orderId))!.deliveryOtp!;
  await c.signOut();
  return { ...o, otp };
}

describe('phase 4 — super admin', () => {
  it('assigns roles by phone, keeps one super admin, and audits every change', async () => {
    const c = fresh();
    await login(c, OWNER);
    await expect(c.listUsers()).rejects.toThrow(/access/);
    await c.signOut();
    await login(c, ADMIN);
    const users = await c.listUsers();
    expect(users.find((u) => u.phone === VIKRAM)?.role).toBe('rider');

    const staff = await c.setUserRole({ phone: '+919812345678', displayName: 'Mohan', role: 'staff', storeIds: ['S2'] });
    expect(staff).toMatchObject({ role: 'staff', vendorId: 'V1', storeIds: ['S2'] });
    await expect(c.setUserRole({ uid: staff.uid, role: 'staff', storeIds: [] })).rejects.toThrow(/at least one store/);
    await expect(c.setUserRole({ uid: staff.uid, role: 'rider', homeStoreId: 'G1' })).rejects.toThrow(/delivers/);
    const me = users.find((u) => u.phone === ADMIN)!;
    await expect(c.setUserRole({ uid: me.uid, role: 'customer' })).rejects.toThrow(/your own/);

    await c.signOut();
    await login(c, '+919812345678');
    expect((await c.listStores()).map((s) => s.storeId)).toEqual(['S2']);
    await c.signOut();
    await login(c, ADMIN);
    const audit = await c.listAudit({ actionPrefix: 'role.' });
    expect(audit[0]!.target.id).toBe(staff.uid);
    expect(JSON.parse(audit[0]!.after!).storeIds).toEqual(['S2']);
  });

  it('edits a zone: a pincode outside every zone becomes serviceable, fee from the zone', async () => {
    const c = fresh();
    expect((await c.checkDelivery({ pincode: '302021' })).reason).toBe('OUTSIDE_ZONES');
    await login(c, ADMIN);
    const z = await c.saveZone({ name: 'Vaishali Nagar', geometryJson: rectangleGeometry(26.88, 75.70, 26.94, 75.78), storeIds: ['S1'], baseDeliveryFee: 3500, freeDeliveryAbove: 0, surgeMultiplierBps: 10_000, isActive: true });
    await expect(c.saveZone({ name: 'Godown', geometryJson: rectangleGeometry(26.8, 75.7, 26.9, 75.8), storeIds: ['G1'], baseDeliveryFee: 0, freeDeliveryAbove: 0, surgeMultiplierBps: 10_000, isActive: true })).rejects.toThrow(/Unknown/);
    const chk = await c.checkDelivery({ pincode: '000000', location: { lat: 26.91, lng: 75.745 } });
    expect(chk.reason === 'OK' || chk.reason === 'TOO_FAR').toBe(true);
    expect(chk.baseDeliveryFee).toBe(3500);
    await c.saveZone({ ...(await c.listZones()).find((x) => x.zoneId === z.zoneId)!, isActive: false });
    expect((await c.checkDelivery({ pincode: '000000', location: { lat: 26.91, lng: 75.745 } })).reason).toBe('OUTSIDE_ZONES');
  });

  it('changing an HSN rate re-rates the products under it', async () => {
    const c = fresh();
    await login(c, ADMIN);
    const before = (await c.listProducts()).filter((p) => p.hsnCode.startsWith('0802'));
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((p) => p.gstSlab === 12)).toBe(true);
    const r = await c.upsertHsn({ hsnCode: '0802', description: 'Other nuts (almonds, walnuts)', gstSlab: 5 });
    expect(r.productsUpdated).toBe(before.length);
    expect((await c.listProducts()).filter((p) => p.hsnCode.startsWith('0802')).every((p) => p.gstSlab === 5)).toBe(true);
    await expect(c.upsertHsn({ hsnCode: '12', description: 'x', gstSlab: 5 })).rejects.toThrow(/HSN/);
    expect((await c.listAudit({ actionPrefix: 'hsn_master' }))[0]!.target.id).toBe('0802');
  });
});

describe('phase 4 — picker, rider and cash on delivery', () => {
  it('picker packs in bin order; rider picks up, delivers with code, hands cash to the counter', async () => {
    const c = fresh();
    const o = await placeCod(c, [{ productId: 'kapur-50', qty: 2 }, { productId: 'gond-250', qty: 1 }]);

    // picker accepts and gets a bin-sorted list with FEFO batch numbers
    await login(c, SUNITA);
    await c.advanceOrder(o.orderId, 'ACCEPTED');
    const task = await c.pickTask(o.orderId);
    const bins = task.lines.map((l) => l.aisleBinCode);
    expect([...bins].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))).toEqual(bins);
    expect(task.lines.every((l) => l.batches.length > 0 && l.batches[0]!.batchNumber)).toBe(true);

    // rider is off shift → cannot be assigned
    const riders = await c.listStoreRiders('S1');
    expect(riders.map((r) => r.name)).toEqual(expect.arrayContaining(['Vikram Singh', 'Arjun Meena']));
    await expect(c.assignRider(o.orderId, 'u-9995')).rejects.toThrow(/not on shift/);
    await expect(c.assignRider(o.orderId, 'u-9996')).rejects.toThrow(/not verified/);
    await c.signOut();

    await login(c, ARJUN);
    await expect(c.setRiderShift(true)).rejects.toThrow(/verified/);
    await c.signOut();
    await login(c, VIKRAM);
    await c.setRiderShift(true);
    expect((await c.myRider()).isOnline).toBe(true);
    await c.signOut();

    await login(c, SUNITA);
    await c.assignRider(o.orderId, 'u-9995');
    await c.advanceOrder(o.orderId, 'PICKING');
    await c.advanceOrder(o.orderId, 'PACKED');
    await expect(c.advanceOrder(o.orderId, 'OUT_FOR_DELIVERY')).rejects.toThrow(/hand the bag/);
    await c.signOut();

    await login(c, VIKRAM);
    await expect(c.setRiderShift(false)).rejects.toThrow(/Finish/);
    const mine = await c.riderOrders();
    expect(mine.map((x) => x.orderId)).toEqual([o.orderId]);
    expect(mine[0]!.deliveryOtp).toBeNull(); // rider never sees the code
    await expect(c.advanceOrder(o.orderId, 'DELIVERED', { otp: o.otp })).rejects.toThrow(/Cannot move/);
    const picked = await c.advanceOrder(o.orderId, 'HANDED_TO_RIDER');
    expect(picked.invoiceNo).toMatch(/^PX\/\d\d-\d\d\/000001$/); // GST bill at dispatch
    await c.advanceOrder(o.orderId, 'OUT_FOR_DELIVERY');
    await expect(c.advanceOrder(o.orderId, 'DELIVERED', { otp: o.otp === '0000' ? '1111' : '0000' })).rejects.toThrow(/delivery code/);
    await c.advanceOrder(o.orderId, 'DELIVERED', { otp: o.otp });
    const me = await c.myRider();
    expect(me.codCashInHand).toBe(o.grandTotal);
    expect(me.activeOrderIds).toEqual([]);
    expect(me.earningsBalance).toBe(3_000);
    expect((await c.riderCash())[0]).toMatchObject({ kind: 'COLLECT', amount: o.grandTotal, orderId: o.orderId });
    await c.signOut();

    // the counter receives the cash
    await login(c, SALES_BOY);
    await expect(c.receiveCodCash('S1', 'u-9995', o.grandTotal + 100)).rejects.toThrow(/holds only/);
    const left = await c.receiveCodCash('S1', 'u-9995', o.grandTotal - 1000);
    expect(left.codCashInHand).toBe(1000);
    const ledger = await c.riderCash('u-9995');
    expect(ledger.map((x) => x.kind)).toEqual(['DEPOSIT', 'COLLECT']);
    expect((await c.getOrder(o.orderId))!.payment.status).toBe('PAID');
  });

  it('cancelling an assigned order frees the rider; cycle count posts only differences', async () => {
    const c = fresh();
    await login(c, VIKRAM);
    await c.setRiderShift(true);
    await c.signOut();
    const o = await placeCod(c);
    await login(c, OWNER);
    await c.advanceOrder(o.orderId, 'ACCEPTED');
    await c.assignRider(o.orderId, 'u-9995');
    await c.advanceOrder(o.orderId, 'CANCELLED', { reason: 'Customer asked' });
    await c.signOut();
    await login(c, VIKRAM);
    expect((await c.myRider()).activeOrderIds).toEqual([]);
    await c.setRiderShift(false);
    await c.signOut();

    await login(c, SUNITA);
    const batches = (await c.listBatches('S1', 'kapur-50')).filter((b) => b.qty > 0);
    const b = batches[0]!;
    const r = await c.adjustStock({ storeId: 'S1', productId: 'kapur-50', batchId: b.batchId, movement: 'CYCLE_COUNT_ADJUSTMENT', countedQty: b.qty - 1, reason: 'Shelf count' });
    expect(r.onHand).toBe(batches.reduce((a, x) => a + x.qty, 0) - 1);
    expect((await c.listLedger('S1'))[0]!.movement).toBe('CYCLE_COUNT_ADJUSTMENT');
  });
});

describe('phase 4 — compliance', () => {
  it('rider KYC: upload, reject with reason, re-upload, verify → can go on shift', async () => {
    const c = fresh();
    const file = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: 'image/jpeg' });
    await login(c, ARJUN);
    await expect(c.uploadKyc({ docType: 'AADHAAR_MASKED', file, fileName: 'a.jpg' })).rejects.toThrow(/masked/);
    await expect(c.uploadKyc({ docType: 'GSTIN_CERT', file, fileName: 'g.jpg' })).rejects.toThrow(/not needed/);
    await expect(c.uploadKyc({ docType: 'PAN', file: new Blob(['x'], { type: 'text/plain' }), fileName: 'p.txt' })).rejects.toThrow(/not needed/);
    await c.saveRiderProfile({ name: 'Arjun Meena', vehicleType: 'SCOOTER', vehicleNumber: 'rj14 ab 1234' });
    await expect(c.saveRiderProfile({ name: 'Arjun Meena', vehicleType: 'SCOOTER', vehicleNumber: 'banana' })).rejects.toThrow(/vehicle number/);
    await c.uploadKyc({ docType: 'DRIVING_LICENSE', file, fileName: 'dl.jpg' });
    await c.uploadKyc({ docType: 'VEHICLE_RC', file, fileName: 'rc.jpg' });
    await c.uploadKyc({ docType: 'AADHAAR_MASKED', file, fileName: 'aadhaar.jpg', maskedConfirmed: true });
    expect((await c.myRider()).kycStatus).toBe('UNDER_REVIEW');
    await c.signOut();

    await login(c, MEERA);
    const queue = (await c.listKycDocs()).filter((k) => k.ownerUid === 'u-9996');
    expect(queue).toHaveLength(3);
    expect(await c.kycFileUrl(queue[0]!.id)).toMatch(/^data:image\/jpeg;base64,/);
    const aadhaar = queue.find((k) => k.docType === 'AADHAAR_MASKED')!;
    await expect(c.reviewKyc(aadhaar.id, 'REJECTED')).rejects.toThrow(/why/);
    expect((await c.reviewKyc(aadhaar.id, 'REJECTED', 'Full number visible — mask it')).ownerStatus).toBe('REJECTED');
    for (const k of queue.filter((x) => x.id !== aadhaar.id)) await c.reviewKyc(k.id, 'VERIFIED');
    await c.signOut();

    await login(c, ARJUN);
    expect((await c.myKycDocs()).find((k) => k.docType === 'AADHAAR_MASKED')!.reviewNote).toMatch(/mask/);
    await c.uploadKyc({ docType: 'AADHAAR_MASKED', file, fileName: 'aadhaar2.jpg', maskedConfirmed: true });
    await c.signOut();
    await login(c, MEERA);
    const again = (await c.listKycDocs()).find((k) => k.ownerUid === 'u-9996')!;
    expect((await c.reviewKyc(again.id, 'VERIFIED')).ownerStatus).toBe('VERIFIED');
    expect((await c.listAudit({ actionPrefix: 'kyc.' })).length).toBe(4);
    await c.signOut();
    await login(c, ARJUN);
    await c.setRiderShift(true);
  });

  it('recall pulls batches off every shelf, blocks dispatch of orders holding them, and reports units sold', async () => {
    const c = fresh();
    const o = await placeCod(c, [{ productId: 'kapur-50', qty: 2 }]);
    await login(c, OWNER);
    const allocated = (await c.pickTask(o.orderId)).lines[0]!.batches[0]!.batchNumber;
    const sale = await c.commitSale({ storeId: 'S1', channel: 'POS_WALKIN', items: [{ productId: 'kapur-50', qty: 1 }], payment: { method: 'CASH' } });
    expect(sale.invoiceNo).toBeTruthy();
    await c.advanceOrder(o.orderId, 'ACCEPTED');
    await c.advanceOrder(o.orderId, 'PICKING');
    await c.advanceOrder(o.orderId, 'PACKED');
    await expect(c.createRecall({ productId: 'kapur-50', batchNumbers: [allocated], reason: 'Supplier recall notice' })).rejects.toThrow(/access/);
    await c.signOut();

    await login(c, MEERA);
    const beforeS1 = (await c.listInventory('S1')).find((r) => r.productId === 'kapur-50')!.onHand;
    const res = await c.createRecall({ productId: 'kapur-50', batchNumbers: [allocated.toLowerCase()], reason: 'Supplier recall notice KP-2026-11' });
    expect(res.unitsRemoved).toBeGreaterThan(0);
    expect(res.openOrderIds).toEqual([o.orderId]);
    expect(res.unitsSold).toBeGreaterThanOrEqual(1);
    const afterS1 = (await c.listInventory('S1')).find((r) => r.productId === 'kapur-50')!;
    expect(afterS1.onHand).toBe(beforeS1 - (res.stores.find((s) => s.storeId === 'S1')?.unitsRemoved ?? 0));
    expect(afterS1.nextBatchNumber).not.toBe(allocated);
    expect((await c.listLedger('S1'))[0]!.movement).toBe('RECALL_REMOVAL');
    await expect(c.createRecall({ productId: 'kapur-50', batchNumbers: ['NOPE-1'], reason: 'Supplier recall notice' })).rejects.toThrow(/None of these/);
    await c.signOut();

    await login(c, OWNER);
    await expect(c.advanceOrder(o.orderId, 'OUT_FOR_DELIVERY')).rejects.toThrow(/Recalled stock/);
    await c.advanceOrder(o.orderId, 'CANCELLED', { reason: 'Item recalled by supplier' });
    expect((await c.listRecalls())[0]!.status).toBe('ACTIVE');
    await c.signOut();

    await login(c, MEERA);
    await c.completeRecall(res.recallId);
    expect((await c.listRecalls())[0]!.status).toBe('COMPLETED');
  });

  it('whole-product recall unpublishes the listing; compliance reviews listings', async () => {
    const c = fresh();
    await login(c, MEERA);
    const pending = (await c.listAllProducts()).filter((p) => p.complianceStatus === 'PENDING_REVIEW');
    expect(pending.length).toBeGreaterThan(0);
    await expect(c.reviewProduct!(pending[0]!.productId, 'REJECTED')).rejects.toThrow(/what to fix/);
    await c.reviewProduct!(pending[0]!.productId, 'APPROVED');
    await c.createRecall({ productId: 'kapur-50', batchNumbers: [], reason: 'Brand withdrew the product' });
    const p = (await c.listAllProducts()).find((x) => x.productId === 'kapur-50')!;
    expect(p).toMatchObject({ complianceStatus: 'RECALLED', isPublished: false });
    await expect(c.reviewProduct!('kapur-50', 'APPROVED')).rejects.toThrow(/recall/);
    expect((await c.shopCatalog('S1')).some((r) => r.productId === 'kapur-50')).toBe(false);
  });
});

describe('phase 4 — saved demo data from Phase 3', () => {
  it('upgrades an older saved demo without losing orders', async () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 } as Storage;
    const a = new DemoDataClient({ storage, sessionStorage: null });
    const o = await placeCod(a);
    const raw = JSON.parse(mem.get('pansari-demo-v3')!);
    for (const k of ['zones', 'audit', 'riders', 'kyc', 'vendorKyc', 'riderCash', 'recalls']) delete raw[k];
    for (const p of ['+919999999995', '+919999999996', '+919999999997', '+919999999998']) delete raw.users[p];
    mem.set('pansari-demo-v3', JSON.stringify(raw));
    const b = new DemoDataClient({ storage, sessionStorage: null });
    expect((await b.checkDelivery({ pincode: '302003' })).storeId).toBe('S1');
    await login(b, VIKRAM);
    expect((await b.myRider()).kycStatus).toBe('VERIFIED');
    await b.signOut();
    await login(b, OWNER);
    expect((await b.listOnlineOrders('S1')).map((x) => x.orderId)).toContain(o.orderId);
  });
});
