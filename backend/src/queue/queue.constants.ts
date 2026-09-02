// Deliberately its own file, importing nothing else. Both queue.module.ts
// and notification-queue.service.ts / notification.processor.ts need
// this constant — previously it lived inside queue.module.ts itself,
// which created a real circular import: that module imports
// NotificationQueueService, which imported the constant back FROM
// queue.module.ts. Since imports execute before any other module-level
// code, queue.module.ts started loading notification-queue.service.ts
// before its own INVOICE_EMAIL_QUEUE constant was even defined — so
// @InjectQueue() silently received `undefined` instead of the real
// queue name, which is what caused a "circular dependency detected"
// crash on boot. A neutral, dependency-free file breaks the cycle
// entirely.
export const INVOICE_EMAIL_QUEUE = 'invoice-email';

// Order-status WhatsApp notifications — a customer gets a WhatsApp
// message ("Order confirmed", "Out for delivery", etc.) alongside the
// existing email and in-app notification, not instead of them. Same
// queue-with-fallback reasoning as the invoice email queue: a slow or
// down WhatsApp provider must never block an order status update from
// actually happening in the app itself.
export const WHATSAPP_NOTIFICATION_QUEUE = 'whatsapp-notification';
