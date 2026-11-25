import { describe, expect, it } from 'vitest';
import { HYGIENE_QUESTIONS } from '@pansari/shared';
import { DemoDataClient } from '@/lib/data/demo';

const fresh = () => new DemoDataClient({ storage: null, sessionStorage: null });
const login = async (c: DemoDataClient, phone: string) => c.verifyOtp((await c.sendOtp(phone)).verificationId, '123456');
const OWNER = '+919999999991';
const PRIYA = '+919999999994';
const VIKRAM = '+919999999995';
const MEERA = '+919999999997';
const SUNITA = '+919999999998';
const jpg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 9, 9])], { type: 'image/jpeg' });

async function deliveredByVikram(c: DemoDataClient, stopAt?: 'OUT_FOR_DELIVERY') {
  await login(c, VIKRAM);
  await c.setRiderShift(true);
  await c.signOut();
  await login(c, PRIYA);
  const prof = await c.myProfile();
  const o = await c.placeOrder({ addressId: prof.addresses[0]!.id, storeId: 'S1', items: [{ productId: 'kapur-50', qty: 2 }], paymentMethod: 'COD' });
  const otp = (await c.getOrder(o.orderId))!.deliveryOtp!;
  await c.signOut();
  await login(c, SUNITA);
  await c.advanceOrder(o.orderId, 'ACCEPTED');
  await c.assignRider(o.orderId, 'u-9995');
  await c.advanceOrder(o.orderId, 'PICKING');
  await c.advanceOrder(o.orderId, 'PACKED');
  await c.signOut();
  await login(c, VIKRAM);
  await c.advanceOrder(o.orderId, 'HANDED_TO_RIDER');
  await c.advanceOrder(o.orderId, 'OUT_FOR_DELIVERY');
  if (stopAt !== 'OUT_FOR_DELIVERY') await c.advanceOrder(o.orderId, 'DELIVERED', { otp });
  return o;
}

describe('extras — tracking, proof of delivery, payouts', () => {
  it('customer tracks the rider while out for delivery (real ping or estimate)', async () => {
    const c = fresh();
    const o = await deliveredByVikram(c, 'OUT_FOR_DELIVERY');
    await c.signOut();
    await login(c, PRIYA);
    const est = await c.trackRider(o.orderId);
    expect(est).toMatchObject({ simulated: true, live: true });
    expect(est!.etaMinutes).toBeGreaterThanOrEqual(1);
    await c.signOut();
    await login(c, VIKRAM);
    await expect(c.pingRiderLocation({ lat: 0, lng: 0 })).rejects.toThrow(/Location/);
    await c.pingRiderLocation({ lat: 26.9215, lng: 75.8245 });
    await c.signOut();
    await login(c, PRIYA);
    const live = await c.trackRider(o.orderId);
    expect(live).toMatchObject({ lat: 26.9215, lng: 75.8245, live: true });
    expect(live!.simulated).toBeUndefined();
    expect(live!.distanceKm).toBeLessThan(0.5);
    await c.signOut();
    await login(c, '+919999999992'); // sales boy at S1 may track too
    expect(await c.trackRider(o.orderId)).not.toBeNull();
  });

  it('rider adds a delivery photo; customer and store can see it; others cannot add one', async () => {
    const c = fresh();
    const o = await deliveredByVikram(c);
    await expect(c.attachPod(o.orderId, { file: new Blob(['x'], { type: 'text/plain' }), fileName: 'a.txt' })).rejects.toThrow(/JPG/);
    await c.attachPod(o.orderId, { file: jpg(), fileName: 'door.jpg' });
    expect(await c.podUrl(o.orderId)).toMatch(/^data:image\/jpeg/);
    await c.signOut();
    await login(c, PRIYA);
    expect((await c.getOrder(o.orderId))!.hasPod).toBe(true);
    expect(await c.trackRider(o.orderId)).toBeNull(); // delivered: no tracking
    expect(await c.podUrl(o.orderId)).toMatch(/^data:image/);
    await c.signOut();
    await login(c, OWNER);
    await expect(c.attachPod(o.orderId, { file: jpg(), fileName: 'x.jpg' })).rejects.toThrow(/access/);
  });

  it('owner pays the rider’s earnings; rider sees the payout', async () => {
    const c = fresh();
    await deliveredByVikram(c);
    expect((await c.myRider()).earningsBalance).toBe(3_000);
    await expect(c.payRider('u-9995', 1000, 'UPI', 'x')).rejects.toThrow(/owner or admin/);
    await c.signOut();
    await login(c, OWNER);
    await expect(c.payRider('u-9995', 5_000, 'CASH', '')).rejects.toThrow(/only/);
    await expect(c.payRider('u-9995', 1_000, 'UPI', '')).rejects.toThrow(/reference/);
    expect((await c.payRider('u-9995', 2_000, 'UPI', 'UTR88112233')).earningsBalance).toBe(1_000);
    expect((await c.listPayouts('u-9995'))[0]).toMatchObject({ amount: 2_000, method: 'UPI', reference: 'UTR88112233' });
    await c.signOut();
    await login(c, VIKRAM);
    expect((await c.listPayouts()).map((p) => p.amount)).toEqual([2_000]);
    expect((await c.myRider()).earningsBalance).toBe(1_000);
  });
});

describe('extras — hygiene checklists', () => {
  it('staff submit; a "no" flags it; compliance reviews; other stores cannot submit', async () => {
    const c = fresh();
    await login(c, SUNITA);
    const answers = HYGIENE_QUESTIONS.HYGIENE_DAILY.map((question) => ({ question, ok: true }));
    const ok = await c.submitHygieneCheck({ storeId: 'S1', kind: 'HYGIENE_DAILY', answers, temperatureC: null });
    expect(ok).toMatchObject({ flagged: false, reviewStatus: 'PENDING', storeName: expect.any(String), submittedByName: 'Sunita' });
    await expect(c.submitHygieneCheck({ storeId: 'S2', kind: 'HYGIENE_DAILY', answers, temperatureC: null })).rejects.toThrow(/operate/);
    const cold = HYGIENE_QUESTIONS.COLD_CHAIN.map((question) => ({ question, ok: true }));
    const hot = await c.submitHygieneCheck({ storeId: 'S1', kind: 'COLD_CHAIN', answers: cold, temperatureC: 29 });
    expect(hot.flagged).toBe(true);
    await c.signOut();
    await login(c, MEERA);
    const flagged = await c.listHygieneChecks({ flaggedOnly: true });
    expect(flagged.map((h) => h.id)).toEqual([hot.id]);
    await expect(c.reviewHygieneCheck(hot.id, 'ACTION_REQUIRED')).rejects.toThrow(/what to fix/);
    await c.reviewHygieneCheck(hot.id, 'ACTION_REQUIRED', 'Move kesar to the cool shelf; check the fridge');
    await c.reviewHygieneCheck(ok.id, 'OK');
    await c.signOut();
    await login(c, OWNER);
    const mine = await c.listHygieneChecks({ storeId: 'S1' });
    expect(mine.find((h) => h.id === hot.id)).toMatchObject({ reviewStatus: 'ACTION_REQUIRED', reviewNote: expect.stringMatching(/cool shelf/) });
  });
});
