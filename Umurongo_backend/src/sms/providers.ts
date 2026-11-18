// SMS providers: simulate (default), Africa's Talking, and a generic HTTP aggregator.
import type { DeliveryReport, FetchLike, InboundMessage, OutgoingSms, SendResult, SmsProvider } from './provider';
import { str, withTimeout } from './provider';

/** Sends nothing. The outbox stores the message as SIMULATED so the dev panel can show it. */
export const simulateProvider: SmsProvider = {
  name: 'simulate',
  async send() {
    return { ok: true, retryable: false, providerMessageId: undefined };
  },
  parseDeliveryReport() {
    return null;
  },
  parseInbound(body) {
    const from = str(body.from);
    const text = str(body.text);
    return from && text ? { from, text } : null;
  },
};

// ─── Africa's Talking ───────────────────────────────────────────────────────
// Send:     POST /version1/messaging (form-encoded), header apiKey.
// Reports:  POST to our callback, form fields id, status, phoneNumber, failureReason.
// Inbound:  POST to our callback, form fields from, to, text, date, id.

/** Recipient status codes that mean the message was accepted (100 Processed, 101 Sent, 102 Queued). */
const AT_OK = new Set([100, 101, 102]);
/** Codes worth retrying: gateway and internal errors. 402 sender ID, 403 number, 405 balance, 406 blacklist are final. */
const AT_RETRY = new Set([500, 501, 502]);

export function africasTalkingProvider(opts: { username: string; apiKey: string; sandbox?: boolean; fetch?: FetchLike }): SmsProvider {
  const doFetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const url = opts.sandbox
    ? 'https://api.sandbox.africastalking.com/version1/messaging'
    : 'https://api.africastalking.com/version1/messaging';
  return {
    name: 'africastalking',
    async send(sms: OutgoingSms): Promise<SendResult> {
      const form = new URLSearchParams({ username: opts.username, to: sms.to, message: sms.body });
      // The sandbox rejects alphanumeric sender IDs that are not registered there.
      if (sms.senderId && !opts.sandbox) form.set('from', sms.senderId);
      const t = withTimeout();
      try {
        const res = await doFetch(url, {
          method: 'POST',
          headers: { apiKey: opts.apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
          signal: t.signal,
        });
        if (!res.ok) {
          return { ok: false, retryable: res.status >= 500 || res.status === 429, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
        }
        const data = (await res.json()) as { SMSMessageData?: { Message?: string; Recipients?: { statusCode?: number; status?: string; messageId?: string }[] } };
        const r = data.SMSMessageData?.Recipients?.[0];
        if (!r) return { ok: false, retryable: false, error: data.SMSMessageData?.Message ?? 'No recipient in response' };
        if (AT_OK.has(Number(r.statusCode))) return { ok: true, retryable: false, providerMessageId: r.messageId };
        return { ok: false, retryable: AT_RETRY.has(Number(r.statusCode)), error: `${r.statusCode} ${r.status ?? ''}`.trim() };
      } catch (e) {
        return { ok: false, retryable: true, error: e instanceof Error ? e.message : 'Network error' };
      } finally {
        t.done();
      }
    },
    parseDeliveryReport(body): DeliveryReport | null {
      const id = str(body.id);
      const status = str(body.status);
      if (!id || !status) return null;
      if (status === 'Success') return { providerMessageId: id, status: 'DELIVERED' };
      if (status === 'Failed' || status === 'Rejected') {
        return { providerMessageId: id, status: 'FAILED', error: str(body.failureReason) || status };
      }
      return { providerMessageId: id, status: 'SENT' }; // Sent, Submitted, Buffered
    },
    parseInbound(body): InboundMessage | null {
      const from = str(body.from);
      const text = str(body.text);
      return from ? { from, text } : null;
    },
  };
}

// ─── Generic HTTP aggregator ────────────────────────────────────────────────
// Send:     POST SMS_HTTP_URL, JSON { to, message, from }, Bearer token. Reply { id }.
// Reports:  POST JSON { id, status: "DELIVERED" | "FAILED" | "SENT", error? }.
// Inbound:  POST JSON { from, text }.

export function httpProvider(opts: { url: string; token?: string; fetch?: FetchLike }): SmsProvider {
  const doFetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  return {
    name: 'http',
    async send(sms: OutgoingSms): Promise<SendResult> {
      const t = withTimeout();
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
        if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
        const res = await doFetch(opts.url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ to: sms.to, message: sms.body, from: sms.senderId }),
          signal: t.signal,
        });
        if (!res.ok) return { ok: false, retryable: res.status >= 500 || res.status === 429, error: `HTTP ${res.status}` };
        const data = (await res.json().catch(() => ({}))) as { id?: string; messageId?: string };
        return { ok: true, retryable: false, providerMessageId: data.id ?? data.messageId };
      } catch (e) {
        return { ok: false, retryable: true, error: e instanceof Error ? e.message : 'Network error' };
      } finally {
        t.done();
      }
    },
    parseDeliveryReport(body): DeliveryReport | null {
      const id = str(body.id);
      const status = str(body.status).toUpperCase();
      if (!id || !['SENT', 'DELIVERED', 'FAILED'].includes(status)) return null;
      return { providerMessageId: id, status: status as DeliveryReport['status'], error: str(body.error) || undefined };
    },
    parseInbound(body): InboundMessage | null {
      const from = str(body.from);
      return from ? { from, text: str(body.text) } : null;
    },
  };
}
