// The SmsProvider interface. Everything else in the API only talks to the outbox (outbox.ts),
// which uses one of these providers. Adding a provider = implementing this interface.

export interface OutgoingSms {
  to: string; // E.164
  body: string;
  senderId: string;
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  /** For failures: should the outbox try again later? (network errors and gateway errors: yes) */
  retryable: boolean;
  error?: string;
}

export interface DeliveryReport {
  providerMessageId: string;
  status: 'SENT' | 'DELIVERED' | 'FAILED';
  error?: string;
}

export interface InboundMessage {
  from: string;
  text: string;
}

export interface SmsProvider {
  readonly name: string;
  send(sms: OutgoingSms): Promise<SendResult>;
  /** Reads a delivery-report webhook body. Null when the body is not a report this provider understands. */
  parseDeliveryReport(body: Record<string, unknown>): DeliveryReport | null;
  /** Reads an inbound-SMS webhook body. */
  parseInbound(body: Record<string, unknown>): InboundMessage | null;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** Network calls give up after 10 seconds so a slow gateway never blocks the outbox. */
export function withTimeout(ms = 10_000): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}
