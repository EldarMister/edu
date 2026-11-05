import type { ReceiptPrintRequest } from '@/types';
import { registerSessionCleanup } from '@/store/auth';
import { receiptRequestVoice } from './realtimeVoice';
import { waiterVoice } from './waiterVoice';

export type AdministratorVoiceCall = {
  message: string; orderId?: string; orderNumber?: string; createdAt: string; voice?: { text?: string };
};
// Foreground and background listeners can overlap during AppState transitions.
// Speech has its own dedupe: a foreground OS notification must not swallow its TTS.
const announced = new Map<string, number>();
function announce(key: string, text?: string | null) {
  if (!text?.trim()) return;
  const now = Date.now();
  for (const [id, expiry] of announced) if (expiry <= now) announced.delete(id);
  if (announced.has(key)) return;
  announced.set(key, now + 10 * 60_000);
  while (announced.size > 512) announced.delete(announced.keys().next().value!);
  waiterVoice.enqueue(text);
}
export function announceReceiptRequest(request: ReceiptPrintRequest) {
  announce(`receipt:${request.id}:created`, receiptRequestVoice(request));
}
export function announceAdministratorCall(call: AdministratorVoiceCall) {
  announce(`admin-call:${call.orderId}:${call.createdAt}`, call.voice?.text);
}
registerSessionCleanup(() => announced.clear());
