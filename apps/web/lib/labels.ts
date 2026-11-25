import type { OrderStatus, PaymentMethod, StockMovement } from '@pansari/shared';

type Tone = 'good' | 'warn' | 'bad' | 'neutral' | 'brand';

export const MOVEMENT_LABEL: Record<StockMovement, { label: string; tone: Tone }> = {
  INWARD_PO: { label: 'Received', tone: 'good' },
  ONLINE_SALE: { label: 'Online sale', tone: 'brand' },
  OFFLINE_QR_SALE: { label: 'Walk-in QR sale', tone: 'brand' },
  POS_WALKIN_SALE: { label: 'Counter sale', tone: 'brand' },
  CUSTOMER_RETURN: { label: 'Return', tone: 'good' },
  DAMAGED_WRITE_OFF: { label: 'Damaged', tone: 'bad' },
  CYCLE_COUNT_ADJUSTMENT: { label: 'Stock count', tone: 'warn' },
  STOCK_TRANSFER_OUT: { label: 'Transfer out', tone: 'neutral' },
  STOCK_TRANSFER_IN: { label: 'Transfer in', tone: 'neutral' },
  RECALL_REMOVAL: { label: 'Recall', tone: 'bad' },
  ORDER_CANCEL_RESTOCK: { label: 'Order cancelled', tone: 'good' },
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  UPI_QR: 'UPI',
  UPI_INTENT: 'UPI',
  CARD: 'Card',
  COD: 'Cash on delivery',
  WALLET: 'Wallet',
};

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
