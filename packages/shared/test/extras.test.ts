import { describe, expect, it } from 'vitest';
import { checkPod, ExtrasError, HYGIENE_QUESTIONS, LIVE_LOCATION_MAX_AGE_MS, missingDailyChecks, planPayout, POD_WINDOW_MS, simulateRiderPosition, trackEstimate, validateHygiene, validPing } from '../src/index.js';

const NOW = Date.UTC(2026, 10, 25, 8, 0, 0);

describe('payouts', () => {
  it('pays part or all of the earnings; UPI and bank need a reference', () => {
    expect(planPayout(9_000, 6_000, 'UPI', ' UTR4471 ')).toEqual({ earningsBalance: 3_000, method: 'UPI', reference: 'UTR4471' });
    expect(planPayout(9_000, 9_000, 'CASH', '').earningsBalance).toBe(0);
    expect(() => planPayout(9_000, 9_001, 'CASH', '')).toThrow(/only/);
    expect(() => planPayout(9_000, 0, 'CASH', '')).toThrow(ExtrasError);
    expect(() => planPayout(9_000, 100, 'UPI', '')).toThrow(/reference/);
    expect(() => planPayout(9_000, 100, 'CHEQUE', 'x1234')).toThrow(/how you paid/);
  });
});

describe('proof of delivery', () => {
  it('only the assigned rider, from trip start until 2 hours after delivery', () => {
    expect(() => checkPod('r1', { riderUid: 'r1', status: 'OUT_FOR_DELIVERY', deliveredMs: null }, NOW)).not.toThrow();
    expect(() => checkPod('r1', { riderUid: 'r1', status: 'DELIVERED', deliveredMs: NOW - POD_WINDOW_MS + 1 }, NOW)).not.toThrow();
    expect(() => checkPod('r1', { riderUid: 'r1', status: 'DELIVERED', deliveredMs: NOW - POD_WINDOW_MS - 1 }, NOW)).toThrow(/Too late/);
    expect(() => checkPod('r2', { riderUid: 'r1', status: 'DELIVERED', deliveredMs: NOW }, NOW)).toThrow(/not assigned/);
    expect(() => checkPod('r1', { riderUid: 'r1', status: 'PACKED', deliveredMs: null }, NOW)).toThrow(/hand over/);
  });
});

describe('live tracking', () => {
  const store = { lat: 26.9196, lng: 75.8235 };
  const home = { lat: 26.9001, lng: 75.8101 };
  it('distance, ETA and freshness', () => {
    const f = trackEstimate({ ...store, atMs: NOW - 10_000 }, home, NOW);
    expect(f.distanceKm).toBeGreaterThan(2);
    expect(f.distanceKm).toBeLessThan(3);
    expect(f.etaMinutes).toBeGreaterThanOrEqual(8);
    expect(f.live).toBe(true);
    expect(trackEstimate({ ...store, atMs: NOW - LIVE_LOCATION_MAX_AGE_MS - 1 }, home, NOW).live).toBe(false);
    expect(trackEstimate({ ...home, atMs: NOW }, home, NOW).etaMinutes).toBe(1);
  });
  it('simulated position moves from the store toward the customer and never arrives', () => {
    const a = simulateRiderPosition(store, home, NOW, NOW);
    const b = simulateRiderPosition(store, home, NOW, NOW + 5 * 60_000);
    const c = simulateRiderPosition(store, home, NOW, NOW + 3 * 3600_000);
    expect(a.lat).toBeLessThan(store.lat);
    expect(b.lat).toBeLessThan(a.lat);
    expect(c.lat).toBeGreaterThan(home.lat);
  });
  it('rejects bad pings', () => {
    expect(validPing({ lat: 26.91234567, lng: 75.8 })).toEqual({ lat: 26.912346, lng: 75.8 });
    expect(validPing({ lat: 0, lng: 0 })).toBeNull();
    expect(validPing({ lat: 'x', lng: 75 })).toBeNull();
    expect(validPing(null)).toBeNull();
  });
});

describe('hygiene checklists', () => {
  const all = (kind: keyof typeof HYGIENE_QUESTIONS, ok = true) => HYGIENE_QUESTIONS[kind].map((question) => ({ question, ok }));
  it('every question answered; a "no" needs a note and flags the check', () => {
    expect(validateHygiene('HYGIENE_DAILY', all('HYGIENE_DAILY'), null)).toMatchObject({ failed: 0, flag: false, temperatureC: null });
    const one = all('HYGIENE_DAILY');
    one[2] = { ...one[2]!, ok: false };
    expect(() => validateHygiene('HYGIENE_DAILY', one, null)).toThrow(/Say what is wrong/);
    one[2] = { ...one[2]!, note: 'Two torn packets of kesar removed' };
    expect(validateHygiene('HYGIENE_DAILY', one, null)).toMatchObject({ failed: 1, flag: true });
    expect(() => validateHygiene('HYGIENE_DAILY', all('HYGIENE_DAILY').slice(1), null)).toThrow(/every question/);
    expect(() => validateHygiene('NOPE', [], null)).toThrow(/Unknown/);
  });
  it('cool storage needs a temperature and flags out-of-range readings', () => {
    expect(() => validateHygiene('COLD_CHAIN', all('COLD_CHAIN'), null)).toThrow(/temperature/);
    expect(validateHygiene('COLD_CHAIN', all('COLD_CHAIN'), 18.26)).toMatchObject({ temperatureC: 18.3, flag: false });
    expect(validateHygiene('COLD_CHAIN', all('COLD_CHAIN'), 31)).toMatchObject({ flag: true, failed: 0 });
  });
  it('lists stores without today’s daily check (IST day)', () => {
    const earlyIst = Date.UTC(2026, 10, 25, 0, 30); // 06:00 IST on the 25th
    const lateYesterdayIst = Date.UTC(2026, 10, 24, 17, 0); // 22:30 IST on the 24th
    expect(
      missingDailyChecks(
        ['S1', 'S2', 'G1'],
        [
          { storeId: 'S1', kind: 'HYGIENE_DAILY', submittedMs: earlyIst },
          { storeId: 'S2', kind: 'HYGIENE_DAILY', submittedMs: lateYesterdayIst },
          { storeId: 'G1', kind: 'PEST_CONTROL', submittedMs: earlyIst },
        ],
        NOW,
      ),
    ).toEqual(['S2', 'G1']);
  });
});
