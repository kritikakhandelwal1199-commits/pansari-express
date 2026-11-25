/**
 * Sample business used to seed the Firebase emulator and to power the web app's
 * demo mode. All names, GSTINs, licence numbers, HSN codes and rates here are
 * illustrative — replace with your own (and have a CA confirm HSN/rates).
 */
import { gstinCheckChar } from '../gst/validators.js';
import type { GstSlab, StoreType, TaxType, Uqc } from '../schema.js';

const DAY = 86_400_000;
const withCheck = (first14: string) => first14 + gstinCheckChar(first14);

export const DEMO_VENDOR = {
  vendorId: 'V1',
  legalName: 'Pansari Express Retail LLP',
  tradeName: 'Pansari Express',
  gstin: withCheck('08AAKFP1234Q1Z'),
  pan: 'AAKFP1234Q',
  fssaiLicenseNo: '12226999000123',
  stateCode: '08',
  registeredAddress: 'Shop 12, Johari Bazaar, Jaipur 302003',
  invoicePrefix: 'PX',
};

export interface DemoStore {
  storeId: string;
  name: string;
  type: StoreType;
  addressLine: string;
  city: string;
  pincode: string;
  stateCode: string;
  location: { lat: number; lng: number };
  upiVpa: string | null;
  acceptsOnline: boolean;
  acceptsWalkInQr: boolean;
}

export const DEMO_STORES: DemoStore[] = [
  { storeId: 'S1', name: 'Johari Bazaar Store', type: 'RETAIL_STORE', addressLine: 'Shop 12, Johari Bazaar', city: 'Jaipur', pincode: '302003', stateCode: '08', location: { lat: 26.9196, lng: 75.8267 }, upiVpa: 'pansari.johari@okaxis', acceptsOnline: true, acceptsWalkInQr: true },
  { storeId: 'S2', name: 'Malviya Nagar Store', type: 'RETAIL_STORE', addressLine: 'C-41, Sector 6, Malviya Nagar', city: 'Jaipur', pincode: '302017', stateCode: '08', location: { lat: 26.8549, lng: 75.8243 }, upiVpa: 'pansari.malviya@okaxis', acceptsOnline: true, acceptsWalkInQr: true },
  { storeId: 'G1', name: 'Sanganer Godown', type: 'WAREHOUSE', addressLine: 'Plot 88, Sitapura Road', city: 'Jaipur', pincode: '302029', stateCode: '08', location: { lat: 26.82, lng: 75.788 }, upiVpa: null, acceptsOnline: false, acceptsWalkInQr: false },
];

export const DEMO_HSN: { hsnCode: string; description: string; gstSlab: GstSlab }[] = [
  { hsnCode: '1301', description: 'Natural gums and resins', gstSlab: 5 },
  { hsnCode: '1211', description: 'Herbs and plant parts used in medicine', gstSlab: 5 },
  { hsnCode: '2106', description: 'Food preparations n.e.c.', gstSlab: 18 },
  { hsnCode: '2914', description: 'Ketones (camphor)', gstSlab: 18 },
  { hsnCode: '3307', description: 'Agarbatti / dhoop and other odoriferous preparations', gstSlab: 5 },
  { hsnCode: '7418', description: 'Copper household articles', gstSlab: 12 },
  { hsnCode: '1404', description: 'Vegetable products n.e.c. (mehndi)', gstSlab: 5 },
  { hsnCode: '0910', description: 'Turmeric and spices', gstSlab: 5 },
  { hsnCode: '0801', description: 'Cashew nuts', gstSlab: 5 },
  { hsnCode: '0802', description: 'Other nuts (almonds, walnuts)', gstSlab: 12 },
  { hsnCode: '0806', description: 'Dried grapes (raisins)', gstSlab: 5 },
  { hsnCode: '1101', description: 'Wheat flour', gstSlab: 5 },
  { hsnCode: '1514', description: 'Mustard oil', gstSlab: 5 },
  { hsnCode: '0902', description: 'Tea', gstSlab: 5 },
  { hsnCode: '2501', description: 'Salt', gstSlab: 0 },
];

export interface DemoProduct {
  productId: string;
  name: string;
  nameHi: string;
  category: 'preg' | 'pooja' | 'shaadi' | 'dry' | 'home';
  brand: string | null;
  barcode: string;
  unit: Uqc;
  netQuantity: string;
  hsnCode: string;
  taxType: TaxType;
  mrp: number;
  approved: boolean;
  /** Per-store price + stock. Batches: [batchNo, mfgDaysAgo, expiryInDays|null, qty, purchasePricePaise] */
  stock: Record<string, { price: number; reorder: number; bin: string; batches: [string, number, number | null, number, number][] }>;
}

const P = (p: DemoProduct) => p;

export const DEMO_PRODUCTS: DemoProduct[] = [
  P({ productId: 'gond-250', name: 'Gond (edible gum) 250 g', nameHi: 'गोंद', category: 'preg', brand: 'Pansari', barcode: '8901234500017', unit: 'PAC', netQuantity: '250 g', hsnCode: '1301', taxType: 'INCLUSIVE', mrp: 21000, approved: true,
    stock: { S1: { price: 18000, reorder: 5, bin: 'A1-R1-B01', batches: [['GD-2608', 90, 300, 6, 13000], ['GD-2611', 10, 360, 12, 13500]] }, S2: { price: 18500, reorder: 4, bin: 'A2-R1-B02', batches: [['GD-2611', 10, 360, 8, 13500]] }, G1: { price: 18000, reorder: 20, bin: 'G-R3', batches: [['GD-2611', 10, 360, 60, 13500]] } } }),
  P({ productId: 'kamarkas-100', name: 'Kamarkas 100 g', nameHi: 'कमरकस', category: 'preg', brand: null, barcode: '8901234500024', unit: 'PAC', netQuantity: '100 g', hsnCode: '1211', taxType: 'INCLUSIVE', mrp: 18000, approved: true,
    stock: { S1: { price: 16000, reorder: 4, bin: 'A1-R1-B02', batches: [['KK-2607', 120, 12, 3, 11000]] }, S2: { price: 16000, reorder: 4, bin: 'A2-R1-B03', batches: [['KK-2610', 40, 250, 9, 11500]] } } }),
  P({ productId: 'panjiri-500', name: 'Panjiri ready mix 500 g', nameHi: 'पंजीरी', category: 'preg', brand: 'Pansari', barcode: '8901234500031', unit: 'PAC', netQuantity: '500 g', hsnCode: '2106', taxType: 'INCLUSIVE', mrp: 36000, approved: true,
    stock: { S1: { price: 32000, reorder: 3, bin: 'A1-R2-B01', batches: [['PJ-2611', 8, 75, 7, 22000]] }, S2: { price: 32000, reorder: 3, bin: 'A2-R2-B01', batches: [['PJ-2611', 8, 75, 2, 22000]] } } }),
  P({ productId: 'kapur-50', name: 'Kapur (camphor) 50 g', nameHi: 'कपूर', category: 'pooja', brand: 'Shuddh', barcode: '8901234500048', unit: 'PAC', netQuantity: '50 g', hsnCode: '29142100', taxType: 'INCLUSIVE', mrp: 9500, approved: true,
    stock: { S1: { price: 8500, reorder: 10, bin: 'B1-R1-B01', batches: [['KP-2605', 200, 500, 24, 6000]] }, S2: { price: 8500, reorder: 10, bin: 'B1-R1-B01', batches: [['KP-2605', 200, 500, 6, 6000]] } } }),
  P({ productId: 'dhoop-20', name: 'Dhoop sticks 20 pcs', nameHi: 'धूप', category: 'pooja', brand: 'Shuddh', barcode: '8901234500055', unit: 'PAC', netQuantity: '20 N', hsnCode: '33074100', taxType: 'INCLUSIVE', mrp: 6000, approved: true,
    stock: { S1: { price: 5000, reorder: 10, bin: 'B1-R1-B02', batches: [['DH-2609', 60, null, 30, 3200]] }, S2: { price: 5000, reorder: 10, bin: 'B1-R1-B02', batches: [['DH-2609', 60, null, 18, 3200]] } } }),
  P({ productId: 'thali-set', name: 'Pooja thali set (copper)', nameHi: 'पूजा थाली', category: 'pooja', brand: null, barcode: '8901234500062', unit: 'SET', netQuantity: '1 set', hsnCode: '7418', taxType: 'INCLUSIVE', mrp: 29900, approved: true,
    stock: { S1: { price: 24900, reorder: 2, bin: 'B2-R1-B01', batches: [['TH-01', 30, null, 5, 17000]] } } }),
  P({ productId: 'haldi-kit', name: 'Haldi rasam kit', nameHi: 'हल्दी रस्म किट', category: 'shaadi', brand: 'Pansari', barcode: '8901234500079', unit: 'SET', netQuantity: '1 kit', hsnCode: '0910', taxType: 'INCLUSIVE', mrp: 34900, approved: true,
    stock: { S1: { price: 29900, reorder: 3, bin: 'C1-R1-B01', batches: [['HK-2610', 30, 180, 8, 19000]] }, S2: { price: 29900, reorder: 3, bin: 'C1-R1-B01', batches: [['HK-2610', 30, 180, 2, 19000]] } } }),
  P({ productId: 'mehndi-12', name: 'Mehndi cones 12 pcs', nameHi: 'मेहंदी कोन', category: 'shaadi', brand: 'Rachna', barcode: '8901234500086', unit: 'PAC', netQuantity: '12 N', hsnCode: '1404', taxType: 'INCLUSIVE', mrp: 14400, approved: true,
    stock: { S1: { price: 12000, reorder: 5, bin: 'C1-R2-B01', batches: [['MH-2611', 5, 8, 6, 7500], ['MH-2610', 40, -2, 3, 7500]] } } }),
  P({ productId: 'kaju-500', name: 'Kaju W320 500 g', nameHi: 'काजू', category: 'dry', brand: 'Pansari', barcode: '8901234500093', unit: 'PAC', netQuantity: '500 g', hsnCode: '08013220', taxType: 'INCLUSIVE', mrp: 60000, approved: true,
    stock: { S1: { price: 52000, reorder: 5, bin: 'D1-R1-B01', batches: [['KJ-2610', 35, 210, 14, 43000]] }, S2: { price: 52000, reorder: 5, bin: 'D1-R1-B01', batches: [['KJ-2610', 35, 210, 4, 43000]] }, G1: { price: 52000, reorder: 30, bin: 'G-R1', batches: [['KJ-2611', 6, 240, 80, 42500]] } } }),
  P({ productId: 'badam-500', name: 'Badam California 500 g', nameHi: 'बादाम', category: 'dry', brand: 'Pansari', barcode: '8901234500109', unit: 'PAC', netQuantity: '500 g', hsnCode: '0802', taxType: 'INCLUSIVE', mrp: 49000, approved: true,
    stock: { S1: { price: 43000, reorder: 5, bin: 'D1-R1-B02', batches: [['BD-2610', 30, 220, 11, 35000]] } } }),
  P({ productId: 'kishmish-250', name: 'Kishmish 250 g', nameHi: 'किशमिश', category: 'dry', brand: null, barcode: '8901234500116', unit: 'PAC', netQuantity: '250 g', hsnCode: '0806', taxType: 'INCLUSIVE', mrp: 12500, approved: true,
    stock: { S1: { price: 11000, reorder: 6, bin: 'D1-R2-B01', batches: [['KS-2609', 50, 140, 16, 8000]] } } }),
  P({ productId: 'atta-5kg', name: 'Chakki atta 5 kg', nameHi: 'चक्की आटा', category: 'home', brand: 'Annapurna Mills', barcode: '8901234500123', unit: 'PAC', netQuantity: '5 kg', hsnCode: '1101', taxType: 'EXCLUSIVE', mrp: 27000, approved: true,
    stock: { S1: { price: 24500, reorder: 8, bin: 'E1-R1-B01', batches: [['AT-2611', 12, 60, 20, 21000]] }, S2: { price: 24500, reorder: 8, bin: 'E1-R1-B01', batches: [['AT-2611', 12, 60, 7, 21000]] } } }),
  P({ productId: 'sarson-1l', name: 'Kachi ghani sarson tel 1 L', nameHi: 'सरसों तेल', category: 'home', brand: 'Annapurna Mills', barcode: '8901234500130', unit: 'BTL', netQuantity: '1 L', hsnCode: '1514', taxType: 'INCLUSIVE', mrp: 18500, approved: true,
    stock: { S1: { price: 16500, reorder: 6, bin: 'E1-R2-B01', batches: [['SR-2610', 40, 280, 12, 14000]] } } }),
  P({ productId: 'chai-250', name: 'Chai patti 250 g', nameHi: 'चाय पत्ती', category: 'home', brand: 'Pahadi', barcode: '8901234500147', unit: 'PAC', netQuantity: '250 g', hsnCode: '0902', taxType: 'INCLUSIVE', mrp: 14500, approved: true,
    stock: { S1: { price: 13000, reorder: 5, bin: 'E2-R1-B01', batches: [['CH-2609', 70, 300, 9, 10000]] } } }),
  P({ productId: 'namak-1kg', name: 'Namak 1 kg', nameHi: 'नमक', category: 'home', brand: 'Saindhav', barcode: '8901234500154', unit: 'PAC', netQuantity: '1 kg', hsnCode: '2501', taxType: 'INCLUSIVE', mrp: 3000, approved: true,
    stock: { S1: { price: 2800, reorder: 10, bin: 'E2-R2-B01', batches: [['NM-2611', 15, null, 40, 2000]] }, S2: { price: 2800, reorder: 10, bin: 'E2-R2-B01', batches: [['NM-2611', 15, null, 25, 2000]] } } }),
  P({ productId: 'shatavari-100', name: 'Shatavari churna 100 g', nameHi: 'शतावरी चूर्ण', category: 'preg', brand: 'Vaidya Ji', barcode: '8901234500161', unit: 'PAC', netQuantity: '100 g', hsnCode: '1211', taxType: 'INCLUSIVE', mrp: 17500, approved: false,
    stock: { S1: { price: 15000, reorder: 3, bin: 'A1-R3-B01', batches: [['SH-2611', 5, 400, 10, 9500]] } } }),
];

export const CATEGORY_LABELS: Record<DemoProduct['category'], string> = {
  preg: 'Garbh & prasav care',
  pooja: 'Pooja samagri',
  shaadi: 'Shaadi samagri',
  dry: 'Dry fruits',
  home: 'Ghar ka saman',
};

/** Expands relative batch dates into absolute epoch ms for a given "now". */
export function expandBatches(p: DemoProduct, storeId: string, nowMs: number) {
  const s = p.stock[storeId];
  if (!s) return [];
  return s.batches.map(([batchNumber, mfgAgo, expIn, qty, purchasePrice], i) => ({
    batchId: `${p.productId}-${storeId}-${i + 1}`,
    batchNumber,
    mfgMs: nowMs - mfgAgo * DAY,
    expiryMs: expIn === null ? null : nowMs + expIn * DAY,
    receivedMs: nowMs - Math.max(1, mfgAgo - 2) * DAY,
    qty,
    recalled: false,
    purchasePrice,
    mrp: p.mrp,
  }));
}

const box = (s: number, w: number, n: number, e: number) => JSON.stringify({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });

/** Delivery zones (GeoJSON [lng, lat]). Vaishali Nagar is deliberately outside, to show the "not serviceable" path. */
export const DEMO_ZONES = [
  { zoneId: 'Z1', name: 'Walled city & Raja Park', geometryJson: box(26.875, 75.78, 26.96, 75.86), storeIds: ['S1'], baseDeliveryFee: 2500, freeDeliveryAbove: 49_900, surgeMultiplierBps: 10_000, isActive: true },
  { zoneId: 'Z2', name: 'Malviya Nagar & Sanganer', geometryJson: box(26.8, 75.75, 26.875, 75.86), storeIds: ['S2'], baseDeliveryFee: 2500, freeDeliveryAbove: 49_900, surgeMultiplierBps: 10_000, isActive: true },
];
