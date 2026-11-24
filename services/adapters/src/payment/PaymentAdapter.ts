/**
 * PaymentAdapter — provider-neutral payment contract.
 *
 * API HOLD MODE: only MockPaymentProvider is implemented. A live gateway
 * (Razorpay / Cashfree / PhonePe PG etc.) drops in later by implementing this
 * same interface; callers never change.
 *
 * PCI note: this layer NEVER accepts raw card numbers. Cards are represented by
 * gateway tokens produced by the gateway's own hosted fields / SDK.
 */
import type { Paise, PaymentMethod } from '@pansari/shared';

export type IntentStatus = 'CREATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';

export interface CreatePaymentInput {
  orderId: string;
  amount: Paise;
  method: PaymentMethod;
  payeeVpa?: string; // store UPI id for UPI_INTENT / UPI_QR
  payeeName?: string;
  note?: string;
  customerPhone?: string;
  /** Gateway card token (never a card number). */
  cardToken?: string;
  /** Idempotency: same key → same intent. */
  idempotencyKey?: string;
}

export interface PaymentIntent {
  intentId: string;
  orderId: string;
  amount: Paise;
  method: PaymentMethod;
  status: IntentStatus;
  upiUri: string | null; // upi://pay?... for intent + QR
  qrPayload: string | null;
  providerRef: string | null; // UTR / gateway payment id
  failureReason: string | null;
  refundedAmount: Paise;
  createdAt: number; // epoch ms
  expiresAt: number; // epoch ms
  collectedBy: string | null; // COD / cash
}

export interface RefundResult {
  refundId: string;
  amount: Paise;
  intent: PaymentIntent;
}

export type PaymentEventType = 'payment.succeeded' | 'payment.failed' | 'payment.expired' | 'refund.processed';

export interface PaymentWebhookEvent {
  id: string;
  type: PaymentEventType;
  intentId: string;
  orderId: string;
  amount: Paise;
  at: number;
}

export interface PaymentAdapter {
  readonly provider: string;
  createIntent(input: CreatePaymentInput): Promise<PaymentIntent>;
  getIntent(intentId: string): Promise<PaymentIntent>;
  /** UPI: simulate / await customer approval. CARD: confirm the token charge. */
  confirm(intentId: string): Promise<PaymentIntent>;
  /** COD or counter cash: mark collected by a rider / cashier uid. */
  markCashCollected(intentId: string, collectedBy: string): Promise<PaymentIntent>;
  cancel(intentId: string): Promise<PaymentIntent>;
  refund(intentId: string, amount: Paise, reason: string): Promise<RefundResult>;
  /** Verify + parse an incoming webhook exactly as a live gateway would require. */
  verifyWebhook(rawBody: string, signatureHex: string): Promise<PaymentWebhookEvent>;
  onEvent(listener: (e: PaymentWebhookEvent, rawBody: string, signatureHex: string) => void): () => void;
}

export class PaymentError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'INVALID_STATE' | 'DECLINED' | 'BAD_SIGNATURE' | 'RAW_CARD_REJECTED', message: string) {
    super(message);
    this.name = 'PaymentError';
  }
}

const VPA_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;
export const isValidVpa = (v: string) => VPA_RE.test(v);

/** NPCI UPI deep link (works as an intent on Android and as QR content). */
export function buildUpiUri(p: { vpa: string; name: string; amount: Paise; txnRef: string; note?: string }): string {
  if (!isValidVpa(p.vpa)) throw new PaymentError('INVALID_INPUT', `Invalid UPI id "${p.vpa}"`);
  const q = new URLSearchParams();
  q.set('pa', p.vpa);
  q.set('pn', p.name.slice(0, 50));
  q.set('am', (p.amount / 100).toFixed(2));
  q.set('cu', 'INR');
  q.set('tr', p.txnRef.slice(0, 35));
  if (p.note) q.set('tn', p.note.slice(0, 50));
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
}
