type Data = Record<string, unknown>;
export type NotificationTarget =
  | { kind: 'waiter-order'; orderId?: string }
  | { kind: 'kitchen' }
  | { kind: 'bar' }
  | { kind: 'admin-orders'; orderId?: string }
  | { kind: 'admin-receipts'; orderId?: string };

const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

/** SDK 52 maps Android dataString for response listeners, but not its handler. */
export function notificationData(content: { data?: unknown; dataString?: unknown }): Data {
  const record = (value: unknown): value is Data => !!value && typeof value === 'object' && !Array.isArray(value);
  if (typeof content.dataString === 'string') {
    try {
      const parsed: unknown = JSON.parse(content.dataString);
      if (record(parsed)) return parsed;
    } catch { /* Malformed transport metadata must not break notification handling. */ }
  }
  return record(content.data) ? content.data : {};
}

/** Only known, role-appropriate destinations. Payloads never become arbitrary URLs. */
export function notificationTarget(data: Data, userId: string, role: string): NotificationTarget | null {
  if (typeof data.recipientUserId === 'string' && data.recipientUserId !== userId) return null;
  if (data.kind === 'sound-test') return null;
  const url = typeof data.url === 'string' ? data.url : '';
  if (url && (!url.startsWith('/') || url.startsWith('//') || url.includes('\\'))) return null;
  const path = url.split(/[?#]/)[0];
  const orderId = typeof data.orderId === 'string' && SAFE_ID.test(data.orderId) ? data.orderId : undefined;
  if (role === 'WAITER' && (!path || /^\/waiter(?:\/|$)/.test(path))) return { kind: 'waiter-order', orderId };
  if (role === 'KITCHEN' && (!path || path === '/kitchen')) return { kind: 'kitchen' };
  if (role === 'BAR' && (!path || path === '/bar')) return { kind: 'bar' };
  if (role === 'ADMIN' || role === 'OWNER') {
    if (path === '/admin/receipts' || path === '/admin/checks') return { kind: 'admin-receipts', orderId };
    if (!path || path === '/admin' || path === '/admin/orders') return { kind: 'admin-orders', orderId };
  }
  return null;
}

function fingerprint(data: Data, body: string) {
  // Metadata supports old servers while new servers supply an exact notificationId.
  return JSON.stringify([data.orderId ?? '', data.type ?? 'info', body.trim()]);
}

/** Bounded event memory shared by socket delivery and foreground OS push delivery. */
export class NotificationDeduper {
  private seen = new Map<string, number>();
  constructor(private now = () => Date.now()) {}

  claim(data: Data, body: string) {
    const now = this.now();
    for (const [key, expires] of this.seen) if (expires <= now) this.seen.delete(key);
    const id = typeof data.notificationId === 'string' ? `id:${data.notificationId}` : null;
    const fallback = `body:${fingerprint(data, body)}`;
    if (id ? this.seen.has(id) : this.seen.has(fallback)) return false;
    if (id) this.seen.set(id, now + 10 * 60_000);
    // A short fallback window avoids hiding later legitimate equal status messages.
    this.seen.set(fallback, now + 5_000);
    while (this.seen.size > 512) this.seen.delete(this.seen.keys().next().value!);
    return true;
  }

  clear() { this.seen.clear(); }
}

export const notificationDeduper = new NotificationDeduper();
