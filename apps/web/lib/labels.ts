import type { StockMovement } from '@pansari/shared';

export const MOVEMENT_LABEL: Record<StockMovement, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' | 'brand' }> = {
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
};
