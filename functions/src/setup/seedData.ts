/**
 * Writes the sample business (vendor, stores, HSN master, products, stock) with
 * the Admin SDK. Used by the emulator seed script and by bootstrapBusiness.
 */
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { COL, deriveInventory, DEMO_HSN, DEMO_PRODUCTS, DEMO_STORES, DEMO_VENDOR, expandBatches, inventoryDocId } from '@pansari/shared';

export async function seedBusiness(db: Firestore, nowMs = Date.now()): Promise<{ stores: number; products: number }> {
  const ts = (ms: number | null) => (ms === null ? null : Timestamp.fromMillis(ms));
  const w = db.bulkWriter();
  w.set(db.collection(COL.vendors).doc(DEMO_VENDOR.vendorId), { ...DEMO_VENDOR, kycStatus: 'VERIFIED', commissionBps: 0, isActive: true, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
  for (const s of DEMO_STORES) {
    w.set(db.collection(COL.stores).doc(s.storeId), { ...s, vendorId: DEMO_VENDOR.vendorId, gstin: null, fssaiLicenseNo: null, zoneId: null, openingHours: { open: '08:00', close: '22:00' }, qrKeyVersion: 1, isActive: true, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
  }
  for (const h of DEMO_HSN) w.set(db.collection(COL.hsnMaster).doc(h.hsnCode), { ...h, cessRate: 0, updatedBy: 'seed', updatedAt: Timestamp.now() });
  const slabOf = (hsn: string) => DEMO_HSN.find((h) => hsn.startsWith(h.hsnCode))!.gstSlab;
  for (const p of DEMO_PRODUCTS) {
    w.set(db.collection(COL.products).doc(p.productId), {
      productId: p.productId,
      vendorId: DEMO_VENDOR.vendorId,
      name: p.name,
      nameHi: p.nameHi,
      category: p.category,
      brand: p.brand,
      barcode: p.barcode,
      images: [],
      unit: p.unit,
      netQuantity: p.netQuantity,
      hsnCode: p.hsnCode,
      gstSlab: slabOf(p.hsnCode),
      cessRate: 0,
      taxType: p.taxType,
      mrp: p.mrp,
      manufacturerName: p.brand,
      manufacturerAddress: 'Jaipur, Rajasthan',
      countryOfOrigin: 'India',
      customerCareDetails: null,
      fssaiRequired: p.category !== 'pooja',
      isVeg: true,
      complianceStatus: p.approved ? 'APPROVED' : 'PENDING_REVIEW',
      complianceNote: null,
      isPublished: p.approved,
      searchTokens: p.name.toLowerCase().split(/\W+/).filter((x) => x.length > 1),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    for (const [storeId, s] of Object.entries(p.stock)) {
      const bs = expandBatches(p, storeId, nowMs);
      const d = deriveInventory(bs, s.reorder, nowMs);
      const inv = db.collection(COL.storeInventory).doc(inventoryDocId(storeId, p.productId));
      w.set(inv, { storeId, vendorId: DEMO_VENDOR.vendorId, productId: p.productId, productName: p.name, sellingPrice: s.price, mrp: p.mrp, onHand: d.onHand, reorderThreshold: s.reorder, aisleBinCode: s.bin, isListed: true, lowStock: d.lowStock, nearestExpiry: ts(d.nearestExpiryMs), nextBatchNumber: d.nextBatchNumber, updatedAt: Timestamp.now() });
      for (const b of bs) {
        w.set(inv.collection(COL.batches).doc(b.batchId), { batchId: b.batchId, storeId, vendorId: DEMO_VENDOR.vendorId, productId: p.productId, batchNumber: b.batchNumber, mfgDate: ts(b.mfgMs), expiryDate: ts(b.expiryMs), purchasePrice: b.purchasePrice, mrp: b.mrp, qty: b.qty, receivedAt: ts(b.receivedMs), receivedBy: 'seed', recalled: false });
      }
    }
  }
  await w.close();
  return { stores: DEMO_STORES.length, products: DEMO_PRODUCTS.length };
}
