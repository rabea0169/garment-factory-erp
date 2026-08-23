// أسماء الأحداث المستخدمة في نظام Event-Driven بين الموديولات
export const EVENTS = {
  // أوامر الإنتاج
  WORK_ORDER_CREATED: 'work_order.created',
  WORK_ORDER_STATUS_UPDATED: 'work_order.status.updated',
  WORK_ORDER_COMPLETED: 'work_order.completed',
  WORK_ORDER_CANCELLED: 'work_order.cancelled',

  // المخزون
  STOCK_ADDED: 'inventory.stock.added',
  STOCK_DEDUCTED: 'inventory.stock.deducted',
  STOCK_LOW: 'inventory.stock.low',
  STOCK_EXHAUSTED: 'inventory.stock.exhausted',

  // المبيعات
  SALES_ORDER_CREATED: 'sales_order.created',
  SALES_ORDER_PAID: 'sales_order.paid',
  SALES_ORDER_OVERDUE: 'sales_order.overdue',

  // المشتريات
  PURCHASE_ORDER_CREATED: 'purchase_order.created',
  PURCHASE_ORDER_RECEIVED: 'purchase_order.received',

  // الجودة
  QUALITY_CHECK_CREATED: 'quality.check.created',
  QUALITY_PIECES_REJECTED: 'quality.pieces.rejected',

  // الشحن
  SHIPMENT_CREATED: 'shipment.created',
  SHIPMENT_DELIVERED: 'shipment.delivered',

  // الرواتب
  PAYROLL_PROCESSED: 'payroll.processed',
  ADVANCE_GIVEN: 'hr.advance.given',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
