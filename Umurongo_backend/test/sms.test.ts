// SMS: providers, the outbox (retries, backoff), delivery reports and feedback replies.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FetchLike, SmsProvider } from '../src/sms/provider';
import { africasTalkingProvider, httpProvider, simulateProvider } from '../src/sms/providers';
import { MAX_ATTEMPTS, backoffMs, processOutbox, useSmsProvider } from '../src/sms/outbox';
import { api, as, describeDb, prisma, reseed, walkIn } from './helpers';

/** A fetch stand-in that records calls and answers from a script. */
function fakeFetch(answers: (() => { status: number; body: unknown })[]) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const next = answers.shift();
    if (!next) throw new Error('network down');
    const a = next();
    return { ok: a.status < 300, status: a.status, json: async () => a.body, text: async () => JSON.stringify(a.body) };
  };
  return { fetch, calls };
}

describe("Africa's Talking provider", () => {
  const ok = { status: 201, body: { SMSMessageData: { Message: 'Sent to 1/1', Recipients: [{ statusCode: 101, status: 'Success', messageId: 'ATXid_1', number: '+250788123456' }] } } };

  it('sends a form with the API key and sender ID', async () => {
    const f = fakeFetch([() => ok]);
    const p = africasTalkingProvider({ username: 'masaka', apiKey: 'secret-key', fetch: f.fetch });
    const r = await p.send({ to: '+250788123456', body: 'Umurongo: test', senderId: 'MASAKA HOSP' });
    expect(r).toEqual({ ok: true, retryable: false, providerMessageId: 'ATXid_1' });
    expect(f.calls[0].url).toBe('https://api.africastalking.com/version1/messaging');
    expect(f.calls[0].headers.apiKey).toBe('secret-key');
    const form = new URLSearchParams(f.calls[0].body);
    expect(Object.fromEntries(form)).toEqual({ username: 'masaka', to: '+250788123456', message: 'Umurongo: test', from: 'MASAKA HOSP' });
  });

  it('uses the sandbox URL without a sender ID', async () => {
    const f = fakeFetch([() => ok]);
    await africasTalkingProvider({ username: 'sandbox', apiKey: 'k', sandbox: true, fetch: f.fetch }).send({ to: '+250788123456', body: 'x', senderId: 'MASAKA' });
    expect(f.calls[0].url).toContain('api.sandbox.africastalking.com');
    expect(new URLSearchParams(f.calls[0].body).has('from')).toBe(false);
  });

  it('retries gateway errors but not a bad number', async () => {
    const recipient = (statusCode: number, status: string) => () => ({ status: 201, body: { SMSMessageData: { Recipients: [{ statusCode, status }] } } });
    const p = (answers: Parameters<typeof fakeFetch>[0]) => africasTalkingProvider({ username: 'u', apiKey: 'k', fetch: fakeFetch(answers).fetch });
    expect(await p([recipient(403, 'InvalidPhoneNumber')]).send({ to: '+250788123456', body: 'x', senderId: '' })).toMatchObject({ ok: false, retryable: false });
    expect(await p([recipient(500, 'InternalServerError')]).send({ to: '+250788123456', body: 'x', senderId: '' })).toMatchObject({ ok: false, retryable: true });
    expect(await p([() => ({ status: 503, body: {} })]).send({ to: '+250788123456', body: 'x', senderId: '' })).toMatchObject({ ok: false, retryable: true });
    expect(await p([]).send({ to: '+250788123456', body: 'x', senderId: '' })).toMatchObject({ ok: false, retryable: true, error: 'network down' });
  });

  it('reads delivery reports and inbound messages', () => {
    const p = africasTalkingProvider({ username: 'u', apiKey: 'k' });
    expect(p.parseDeliveryReport({ id: 'ATXid_1', status: 'Success', phoneNumber: '+250788123456' })).toEqual({ providerMessageId: 'ATXid_1', status: 'DELIVERED' });
    expect(p.parseDeliveryReport({ id: 'ATXid_1', status: 'Failed', failureReason: 'UserInBlacklist' })).toEqual({ providerMessageId: 'ATXid_1', status: 'FAILED', error: 'UserInBlacklist' });
    expect(p.parseDeliveryReport({ id: 'ATXid_1', status: 'Buffered' })).toMatchObject({ status: 'SENT' });
    expect(p.parseDeliveryReport({})).toBeNull();
    expect(p.parseInbound({ from: '+250788123456', to: '12345', text: '1' })).toEqual({ from: '+250788123456', text: '1' });
  });
});

describe('generic HTTP provider', () => {
  it('posts JSON with a bearer token and reads reports', async () => {
    const f = fakeFetch([() => ({ status: 200, body: { id: 'msg-9' } })]);
    const p = httpProvider({ url: 'https://sms.example/send', token: 't0k', fetch: f.fetch });
    expect(await p.send({ to: '+250788123456', body: 'hi', senderId: 'UMURONGO' })).toEqual({ ok: true, retryable: false, providerMessageId: 'msg-9' });
    expect(f.calls[0].headers.Authorization).toBe('Bearer t0k');
    expect(JSON.parse(f.calls[0].body)).toEqual({ to: '+250788123456', message: 'hi', from: 'UMURONGO' });
    expect(p.parseDeliveryReport({ id: 'msg-9', status: 'delivered' })).toEqual({ providerMessageId: 'msg-9', status: 'DELIVERED', error: undefined });
    expect(p.parseDeliveryReport({ id: 'msg-9', status: 'weird' })).toBeNull();
  });
});

describe('backoff', () => {
  it('waits 30 s, 1 min, 2 min, 4 min between attempts', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(MAX_ATTEMPTS).toBe(5);
  });
});

describeDb('SMS outbox and webhooks', () => {
  beforeAll(() => reseed());
  afterEach(() => useSmsProvider(simulateProvider));

  /** A provider that answers from a script of results. */
  function scripted(results: { ok: boolean; retryable?: boolean; id?: string; error?: string }[]): SmsProvider & { sent: string[] } {
    const sent: string[] = [];
    return {
      name: 'fake',
      sent,
      async send(sms) {
        sent.push(sms.to);
        const r = results.shift() ?? { ok: true };
        return { ok: r.ok, retryable: r.retryable ?? false, providerMessageId: r.id, error: r.error };
      },
      parseDeliveryReport: (b) => (b.id ? { providerMessageId: String(b.id), status: String(b.status) as 'DELIVERED' } : null),
      parseInbound: (b) => (b.from ? { from: String(b.from), text: String(b.text ?? '') } : null),
    };
  }

  it('stores messages as SIMULATED in simulate mode', async () => {
    const reg = await walkIn({ displayName: 'Aline', phone: '0788123456' });
    const msg = await prisma.smsMessage.findFirstOrThrow({ where: { ticketId: reg.ticket.id } });
    expect(msg).toMatchObject({ status: 'SIMULATED', to: '+250788123456', template: 'JOINED', language: 'RW' });
  });

  it('queues in live mode, sends, and retries with backoff until it gives up', async () => {
    const p = scripted([{ ok: true, id: 'p-1' }, { ok: false, retryable: true, error: 'gateway' }, { ok: false, retryable: true }, { ok: false, retryable: true }, { ok: false, retryable: true }, { ok: false, retryable: true }]);
    useSmsProvider(p, { simulate: false });
    const a = await walkIn({ displayName: 'Eric', phone: '0722000111' });
    const b = await walkIn({ displayName: 'Joy', phone: '0733000222' });
    const msgA = await prisma.smsMessage.findFirstOrThrow({ where: { ticketId: a.ticket.id } });
    expect(msgA.status).toBe('QUEUED');

    const now = new Date();
    expect(await processOutbox(now)).toEqual({ sent: 1, retried: 1, failed: 0 });
    expect(await prisma.smsMessage.findUniqueOrThrow({ where: { id: msgA.id } })).toMatchObject({ status: 'SENT', providerMessageId: 'p-1', attempts: 1 });
    const msgB = await prisma.smsMessage.findFirstOrThrow({ where: { ticketId: b.ticket.id } });
    expect(msgB).toMatchObject({ status: 'QUEUED', attempts: 1, error: 'gateway' });
    expect(msgB.nextAttemptAt.getTime() - now.getTime()).toBe(30_000);

    // Not due yet: nothing happens.
    expect(await processOutbox(new Date(now.getTime() + 10_000))).toEqual({ sent: 0, retried: 0, failed: 0 });
    // Keep failing: attempts 2, 3, 4 are retried, attempt 5 is final.
    let t = now.getTime();
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
      t += backoffMs(attempt - 1);
      await processOutbox(new Date(t));
    }
    expect(await prisma.smsMessage.findUniqueOrThrow({ where: { id: msgB.id } })).toMatchObject({ status: 'FAILED', attempts: MAX_ATTEMPTS });
    expect(p.sent).toEqual(['+250722000111', '+250733000222', ...Array(MAX_ATTEMPTS - 1).fill('+250733000222')]);
  });

  it('accepts delivery reports only with the webhook secret', async () => {
    useSmsProvider(scripted([{ ok: true, id: 'p-77' }]), { simulate: false });
    const reg = await walkIn({ displayName: 'Ange', phone: '0788555444' });
    await processOutbox(new Date());
    expect((await api.post('/api/sms/delivery').send({ id: 'p-77', status: 'DELIVERED' })).status).toBe(401);
    expect((await api.post('/api/sms/delivery?secret=wrong').send({ id: 'p-77', status: 'DELIVERED' })).status).toBe(401);
    const ok = await api.post('/api/sms/delivery?secret=test-webhook-secret').type('form').send({ id: 'p-77', status: 'DELIVERED' });
    expect(ok.body).toEqual({ ok: true, matched: true });
    const msg = await prisma.smsMessage.findFirstOrThrow({ where: { ticketId: reg.ticket.id } });
    expect(msg.status).toBe('DELIVERED');
    expect(msg.deliveredAt).not.toBeNull();
    // A late "sent" report does not undo "delivered".
    await api.post('/api/sms/delivery?secret=test-webhook-secret').send({ id: 'p-77', status: 'SENT' });
    expect((await prisma.smsMessage.findUniqueOrThrow({ where: { id: msg.id } })).status).toBe('DELIVERED');
  });

  describe('feedback replies', () => {
    beforeEach(() => reseed());

    async function finishedVisitWithPhone(phone: string) {
      const reg = await walkIn({ displayName: 'Grace', phone, priority: 'EMERGENCY' });
      const doctor = await as('uwase');
      await api.post('/api/me/call-next').set(doctor);
      await api.post('/api/me/finish').set(doctor);
      const t = await prisma.ticket.findUniqueOrThrow({ where: { id: reg.ticket.id } });
      expect(t.status).toBe('DONE');
      return t;
    }

    it('stores "1" as yes on the visit and thanks the patient', async () => {
      const t = await finishedVisitWithPhone('0788222333');
      const res = await api.post('/api/sms/inbound?secret=test-webhook-secret').type('form').send({ from: '+250788222333', to: '1234', text: ' 1 ' });
      expect(res.body).toMatchObject({ ok: true, matched: true, answer: 'YES' });
      const visit = await prisma.visit.findUniqueOrThrow({ where: { id: t.visitId } });
      expect(visit.feedbackAnswer).toBe('YES');
      expect(await prisma.smsMessage.count({ where: { ticketId: t.id, template: 'FEEDBACK_THANKS' } })).toBe(1);
      // A second answer does not overwrite the first.
      await api.post('/api/sms/inbound?secret=test-webhook-secret').send({ from: '+250788222333', text: '2' });
      expect((await prisma.visit.findUniqueOrThrow({ where: { id: t.visitId } })).feedbackAnswer).toBe('YES');
    });

    it('stores "oya" as no, and ignores unclear replies and unknown numbers', async () => {
      const t = await finishedVisitWithPhone('0722444555');
      expect((await api.post('/api/sms/inbound?secret=test-webhook-secret').send({ from: '0722444555', text: 'murakoze' })).body).toMatchObject({ matched: true, answer: null });
      expect((await prisma.visit.findUniqueOrThrow({ where: { id: t.visitId } })).feedbackAnswer).toBeNull();
      await api.post('/api/sms/inbound?secret=test-webhook-secret').send({ from: '0722444555', text: 'Oya' });
      expect((await prisma.visit.findUniqueOrThrow({ where: { id: t.visitId } })).feedbackAnswer).toBe('NO');
      expect((await api.post('/api/sms/inbound?secret=test-webhook-secret').send({ from: '+250788999888', text: '1' })).body).toMatchObject({ matched: false });
      expect(await prisma.inboundSms.count()).toBe(3);
    });

    it('lets reception simulate a reply from the dev panel', async () => {
      const t = await finishedVisitWithPhone('0733111222');
      const panel = await api.get('/api/dev/sms').set(await as('reception'));
      expect(panel.body.simulated).toBe(true);
      expect(panel.body.messages.some((m: { template: string; to: string }) => m.template === 'FEEDBACK' && m.to === '0733 111 222')).toBe(true);
      const res = await api.post('/api/dev/sms/reply').set(await as('reception')).send({ phone: '0733 111 222', text: '1' });
      expect(res.body).toMatchObject({ matched: true, answer: 'YES' });
      expect((await prisma.visit.findUniqueOrThrow({ where: { id: t.visitId } })).feedbackAnswer).toBe('YES');
    });
  });
});
