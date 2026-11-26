import { describe, expect, it } from 'vitest';
import { DemoDataClient } from '../lib/data/demo';

describe('demo history', () => {
  it('builds a few days of orders, bills and deliveries once, with a rider on the road now', async () => {
    const c = new DemoDataClient({ storage: null, sessionStorage: null, noWindowSync: true });
    await c.ensureHistory();
    await c.verifyOtp('demo:+919999999991', '123456');
    const s1 = await c.listOnlineOrders('S1', { includeClosed: true });
    const s2 = await c.listOnlineOrders('S2', { includeClosed: true });
    const all = [...s1, ...s2];
    expect(all.filter((o) => o.status === 'DELIVERED').length).toBeGreaterThanOrEqual(4);
    expect(all.some((o) => o.status === 'OUT_FOR_DELIVERY' && o.riderUid)).toBe(true);
    expect(all.some((o) => o.status === 'PLACED')).toBe(true);
    expect(all.some((o) => o.status === 'CANCELLED')).toBe(true);
    const oldest = Math.min(...all.map((o) => o.placedMs));
    expect(Date.now() - oldest).toBeGreaterThan(60 * 3_600_000);
    const inv = await c.listInvoices({ fromMs: Date.now() - 5 * 86_400_000, toMs: Date.now() + 1 });
    expect(inv.length).toBeGreaterThanOrEqual(9);
    expect(inv.some((i) => i.kind === 'B2B')).toBe(true);
    const onRoad = all.find((o) => o.status === 'OUT_FOR_DELIVERY')!;
    const fix = await c.trackRider(onRoad.orderId);
    expect(fix).not.toBeNull();
    const before = all.length;
    await c.ensureHistory();
    expect((await c.listOnlineOrders('S1', { includeClosed: true })).length + (await c.listOnlineOrders('S2', { includeClosed: true })).length).toBe(before);
  });
});
