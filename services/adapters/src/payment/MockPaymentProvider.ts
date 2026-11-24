import { randomId, signEdgeRequest, verifyEdgeRequest, type Paise } from '@pansari/shared';
import {
  buildUpiUri,
  PaymentError,
  type CreatePaymentInput,
  type PaymentAdapter,
  type PaymentEventType,
  type PaymentIntent,
  type PaymentWebhookEvent,
  type RefundResult,
} from './PaymentAdapter.js';

export type MockOutcome = 'success' | 'fail' | 'random' | 'manual';

export interface MockPaymentConfig {
  /** success: confirm always succeeds; fail: always declines; random: uses failureRate; manual: stays PENDING until forceOutcome(). */
  outcome: MockOutcome;
  failureRate: number; // 0..1, used by "random"
  latencyMs: number; // simulated network delay
  intentTtlSeconds: number;
  /** Signs simulated webhooks the same way a live gateway would. >= 32 chars. */
  webhookSecret: string;
  random?: () => number;
}

export const MOCK_CARD_TOKENS = {
  success: 'tok_mock_success',
  decline: 'tok_mock_decline',
  insufficientFunds: 'tok_mock_insufficient_funds',
} as const;

const DEFAULTS: MockPaymentConfig = {
  outcome: 'success',
  failureRate: 0.1,
  latencyMs: 300,
  intentTtlSeconds: 10 * 60,
  webhookSecret: 'mock-webhook-secret-change-me-0123456789',
};

export class MockPaymentProvider implements PaymentAdapter {
  readonly provider = 'mock';
  private cfg: MockPaymentConfig;
  private intents = new Map<string, PaymentIntent>();
  private cardTokens = new Map<string, string>();
  private idem = new Map<string, string>();
  private listeners = new Set<(e: PaymentWebhookEvent, raw: string, sig: string) => void>();

  constructor(cfg: Partial<MockPaymentConfig> = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
    if (this.cfg.webhookSecret.length < 32) throw new Error('webhookSecret must be at least 32 characters');
  }

  /** Change behaviour at runtime (e.g. from a dev toolbar toggle). */
  configure(patch: Partial<MockPaymentConfig>) {
    this.cfg = { ...this.cfg, ...patch };
  }

  private sleep() {
    return this.cfg.latencyMs > 0 ? new Promise((r) => setTimeout(r, this.cfg.latencyMs)) : Promise.resolve();
  }

  private get(intentId: string): PaymentIntent {
    const it = this.intents.get(intentId);
    if (!it) throw new PaymentError('NOT_FOUND', `No payment intent ${intentId}`);
    if ((it.status === 'CREATED' || it.status === 'PENDING') && Date.now() > it.expiresAt) {
      it.status = 'EXPIRED';
      void this.emit('payment.expired', it);
    }
    return it;
  }

  async createIntent(input: CreatePaymentInput): Promise<PaymentIntent> {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new PaymentError('INVALID_INPUT', 'amount must be a positive integer (paise)');
    if (!input.orderId) throw new PaymentError('INVALID_INPUT', 'orderId required');
    if (input.idempotencyKey && this.idem.has(input.idempotencyKey)) return { ...this.get(this.idem.get(input.idempotencyKey)!) };

    if (input.method === 'CARD') {
      if (!input.cardToken) throw new PaymentError('INVALID_INPUT', 'cardToken required for CARD');
      if (/^\d[\d\s-]{11,22}$/.test(input.cardToken)) throw new PaymentError('RAW_CARD_REJECTED', 'Raw card numbers are never accepted — pass a gateway token');
    }

    await this.sleep();
    const intentId = `pi_mock_${randomId(10)}`;
    const now = Date.now();
    let upiUri: string | null = null;
    if (input.method === 'UPI_INTENT' || input.method === 'UPI_QR') {
      if (!input.payeeVpa) throw new PaymentError('INVALID_INPUT', 'payeeVpa required for UPI');
      upiUri = buildUpiUri({ vpa: input.payeeVpa, name: input.payeeName ?? 'Merchant', amount: input.amount, txnRef: input.orderId, note: input.note });
    }
    const intent: PaymentIntent = {
      intentId,
      orderId: input.orderId,
      amount: input.amount,
      method: input.method,
      status: input.method === 'COD' || input.method === 'CASH' ? 'PENDING' : 'CREATED',
      upiUri,
      qrPayload: input.method === 'UPI_QR' ? upiUri : null,
      providerRef: null,
      failureReason: null,
      refundedAmount: 0,
      createdAt: now,
      expiresAt: now + this.cfg.intentTtlSeconds * 1000,
      collectedBy: null,
    };
    this.intents.set(intentId, intent);
    if (input.method === 'CARD' && input.cardToken) this.cardTokens.set(intentId, input.cardToken);
    if (input.idempotencyKey) this.idem.set(input.idempotencyKey, intentId);
    return { ...intent };
  }

  async getIntent(intentId: string) {
    return { ...this.get(intentId) };
  }

  private decide(it: PaymentIntent): 'success' | 'fail' | 'pending' {
    if (it.method === 'CARD') {
      // card outcome comes from the token, regardless of global mode
      return 'pending';
    }
    switch (this.cfg.outcome) {
      case 'success':
        return 'success';
      case 'fail':
        return 'fail';
      case 'manual':
        return 'pending';
      case 'random':
        return (this.cfg.random ?? Math.random)() < this.cfg.failureRate ? 'fail' : 'success';
    }
  }

  async confirm(intentId: string): Promise<PaymentIntent> {
    const it = this.get(intentId);
    if (it.method === 'COD' || it.method === 'CASH') throw new PaymentError('INVALID_STATE', 'Use markCashCollected for cash/COD');
    if (it.status !== 'CREATED' && it.status !== 'PENDING') throw new PaymentError('INVALID_STATE', `Cannot confirm a ${it.status} payment`);
    await this.sleep();
    let outcome = this.decide(it);
    if (it.method === 'CARD') {
      const token = this.cardTokens.get(intentId) ?? MOCK_CARD_TOKENS.success;
      outcome = token === MOCK_CARD_TOKENS.success ? 'success' : 'fail';
      if (outcome === 'fail') it.failureReason = token === MOCK_CARD_TOKENS.insufficientFunds ? 'INSUFFICIENT_FUNDS' : 'CARD_DECLINED';
    }
    if (outcome === 'pending') {
      it.status = 'PENDING';
    } else if (outcome === 'success') {
      it.status = 'SUCCEEDED';
      it.providerRef = `MOCKUTR${Date.now().toString().slice(-8)}${Math.floor((this.cfg.random ?? Math.random)() * 1e4).toString().padStart(4, '0')}`;
      await this.emit('payment.succeeded', it);
    } else {
      it.status = 'FAILED';
      it.failureReason ??= 'DECLINED_BY_PAYER';
      await this.emit('payment.failed', it);
    }
    return { ...it };
  }

  /** Test helper for "manual" mode: resolve a pending payment explicitly. */
  async forceOutcome(intentId: string, outcome: 'success' | 'fail'): Promise<PaymentIntent> {
    const prev = this.cfg.outcome;
    this.cfg.outcome = outcome;
    try {
      return await this.confirm(intentId);
    } finally {
      this.cfg.outcome = prev;
    }
  }

  async markCashCollected(intentId: string, collectedBy: string): Promise<PaymentIntent> {
    const it = this.get(intentId);
    if (it.method !== 'COD' && it.method !== 'CASH') throw new PaymentError('INVALID_STATE', 'Only COD/CASH can be marked collected');
    if (it.status !== 'PENDING') throw new PaymentError('INVALID_STATE', `Payment is ${it.status}`);
    it.status = 'SUCCEEDED';
    it.collectedBy = collectedBy;
    it.providerRef = `CASH-${collectedBy}-${Date.now()}`;
    await this.emit('payment.succeeded', it);
    return { ...it };
  }

  async cancel(intentId: string): Promise<PaymentIntent> {
    const it = this.get(intentId);
    if (it.status !== 'CREATED' && it.status !== 'PENDING') throw new PaymentError('INVALID_STATE', `Cannot cancel a ${it.status} payment`);
    it.status = 'CANCELLED';
    return { ...it };
  }

  async refund(intentId: string, amount: Paise, reason: string): Promise<RefundResult> {
    const it = this.get(intentId);
    if (it.status !== 'SUCCEEDED' && it.status !== 'PARTIALLY_REFUNDED') throw new PaymentError('INVALID_STATE', `Cannot refund a ${it.status} payment`);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new PaymentError('INVALID_INPUT', 'Refund amount must be positive paise');
    if (it.refundedAmount + amount > it.amount) throw new PaymentError('INVALID_INPUT', 'Refund exceeds amount paid');
    if (!reason.trim()) throw new PaymentError('INVALID_INPUT', 'Refund reason required');
    await this.sleep();
    it.refundedAmount += amount;
    it.status = it.refundedAmount === it.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    await this.emit('refund.processed', it, amount);
    return { refundId: `rf_mock_${randomId(8)}`, amount, intent: { ...it } };
  }

  async verifyWebhook(rawBody: string, signatureHex: string): Promise<PaymentWebhookEvent> {
    const [ts, sig] = signatureHex.split(':');
    const ok = await verifyEdgeRequest(rawBody, ts, sig, this.cfg.webhookSecret);
    if (!ok) throw new PaymentError('BAD_SIGNATURE', 'Webhook signature invalid or stale');
    return JSON.parse(rawBody) as PaymentWebhookEvent;
  }

  onEvent(listener: (e: PaymentWebhookEvent, raw: string, sig: string) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async emit(type: PaymentEventType, it: PaymentIntent, amount: Paise = it.amount) {
    if (this.listeners.size === 0) return;
    const event: PaymentWebhookEvent = { id: `evt_mock_${randomId(8)}`, type, intentId: it.intentId, orderId: it.orderId, amount, at: Date.now() };
    const raw = JSON.stringify(event);
    const h = await signEdgeRequest(raw, this.cfg.webhookSecret);
    const sig = `${h['X-Edge-Timestamp']}:${h['X-Edge-Signature']}`;
    for (const l of this.listeners) l(event, raw, sig);
  }
}
