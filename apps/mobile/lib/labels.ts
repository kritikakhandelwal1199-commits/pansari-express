import type { OrderStatus, PaymentMethod } from '@pansari/shared';
type Tone = 'good' | 'warn' | 'bad' | 'neutral' | 'brand';
export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  PLACED: { label: 'Placed', tone: 'warn' },
  ACCEPTED: { label: 'Accepted', tone: 'brand' },
  PICKING: { label: 'Packing', tone: 'brand' },
  PACKED: { label: 'Packed', tone: 'brand' },
  HANDED_TO_RIDER: { label: 'With rider', tone: 'brand' },
  OUT_FOR_DELIVERY: { label: 'On the way', tone: 'brand' },
  DELIVERED: { label: 'Delivered', tone: 'good' },
  COMPLETED: { label: 'Completed', tone: 'good' },
  CANCELLED: { label: 'Cancelled', tone: 'bad' },
  REJECTED: { label: 'Rejected by store', tone: 'bad' },
};
export const PAYMENT_LABEL: Record<PaymentMethod, string> = { CASH: 'Cash', UPI_QR: 'UPI', UPI_INTENT: 'UPI', CARD: 'Card', COD: 'Cash on delivery', WALLET: 'Wallet' };
