// SMS outbox. Code that wants to send an SMS calls sendTemplate(); the message is stored first
// and then sent by processOutbox() with retries, so a slow or failing gateway never breaks a
// queue action. In SMS_MODE=simulate the message is stored as SIMULATED and nothing is sent.
import type { Language, SmsStatus } from '@prisma/client';
import { feedbackThanks, normalizeRwandaPhone, parseFeedbackReply, renderSms, type SmsTemplate, type SmsVars } from '@umurongo/shared';
import { prisma } from '../db';
import { env, isTest } from '../env';
import { emit } from '../realtime';
import type { DeliveryReport, SmsProvider } from './provider';
import { africasTalkingProvider, httpProvider, simulateProvider } from './providers';

export const MAX_ATTEMPTS = 5;
/** Wait before retry n (1-based): 30 s, 1 min, 2 min, 4 min. */
export const backoffMs = (attempt: number) => 30_000 * 2 ** Math.max(0, attempt - 1);
const LEASE_MS = 2 * 60_000;

function providerFromEnv(): SmsProvider {
  if (env.SMS_MODE !== 'live') return simulateProvider;
  if (env.SMS_PROVIDER === 'http') return httpProvider({ url: env.SMS_HTTP_URL!, token: env.SMS_HTTP_TOKEN });
  return africasTalkingProvider({ username: env.AT_USERNAME!, apiKey: env.AT_API_KEY!, sandbox: env.AT_SANDBOX });
}

let provider: SmsProvider = providerFromEnv();
let simulate = env.SMS_MODE !== 'live';

export const smsProvider = () => provider;
export const smsSimulated = () => simulate;

/** Tests swap in a fake provider (and live mode) with this. */
export function useSmsProvider(p: SmsProvider, opts: { simulate?: boolean } = {}) {
  provider = p;
  simulate = opts.simulate ?? p.name === 'simulate';
}

let kickTimer: NodeJS.Timeout | null = null;
/** Sends queued messages soon, without making the caller wait. */
function kickOutbox() {
  if (isTest || kickTimer) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    processOutbox().catch((e) => console.error('SMS outbox failed', e));
  }, 50);
}

async function store(input: { hospitalId: string; ticketId?: string | null; to: string; language: Language; template: string; body: string }) {
  const msg = await prisma.smsMessage.create({
    data: {
      hospitalId: input.hospitalId,
      ticketId: input.ticketId ?? null,
      to: input.to,
      language: input.language,
      template: input.template,
      body: input.body,
      status: simulate ? 'SIMULATED' : 'QUEUED',
      provider: provider.name,
      sentAt: simulate ? new Date() : null,
    },
  });
  if (simulate && !isTest) console.log(`[SMS simulated -> ${input.to}] ${input.body}`);
  if (!simulate) kickOutbox();
  emit.smsChanged(input.hospitalId);
  return msg;
}

/** Renders a template in the ticket's language and queues it. Does nothing when there is no phone number. */
export async function sendTemplate(input: {
  hospitalId: string;
  ticket: { id: string; phone: string | null; language: Language };
  template: SmsTemplate;
  vars: SmsVars;
}) {
  if (!input.ticket.phone) return null;
  const sms = renderSms(input.template, input.ticket.language, input.vars);
  // Admin forms keep names short enough; if a message still does not fit, it is sent anyway
  // (the patient needs it) and the length is logged so the template can be fixed.
  if (!sms.fits) console.warn(`SMS ${input.template} is ${sms.length} characters (gsm7=${sms.gsm7})`);
  return store({ hospitalId: input.hospitalId, ticketId: input.ticket.id, to: input.ticket.phone, language: input.ticket.language, template: input.template, body: sms.text });
}

/** Sends due messages. Safe to run from several processes: each message is claimed before sending. */
export async function processOutbox(now = new Date(), limit = 20) {
  const result = { sent: 0, retried: 0, failed: 0 };
  if (simulate) return result;
  const due = await prisma.smsMessage.findMany({
    where: { status: 'QUEUED', nextAttemptAt: { lte: now } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: { hospital: { select: { smsSenderId: true } } },
  });
  for (const msg of due) {
    if (!msg.to) {
      // The number was removed by the retention job before the message could be sent.
      await prisma.smsMessage.update({ where: { id: msg.id }, data: { status: 'FAILED', error: 'Phone number removed' } });
      result.failed++;
      continue;
    }
    const claimed = await prisma.smsMessage.updateMany({
      where: { id: msg.id, status: 'QUEUED', nextAttemptAt: msg.nextAttemptAt },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
    });
    if (!claimed.count) continue;
    const attempt = msg.attempts + 1;
    const r = await provider.send({ to: msg.to, body: msg.body, senderId: msg.hospital.smsSenderId });
    if (r.ok) {
      await prisma.smsMessage.update({
        where: { id: msg.id },
        data: { status: 'SENT', sentAt: new Date(), providerMessageId: r.providerMessageId ?? null, error: null, provider: provider.name },
      });
      result.sent++;
    } else if (r.retryable && attempt < MAX_ATTEMPTS) {
      await prisma.smsMessage.update({
        where: { id: msg.id },
        data: { status: 'QUEUED', error: r.error ?? 'Send failed', nextAttemptAt: new Date(now.getTime() + backoffMs(attempt)) },
      });
      result.retried++;
    } else {
      await prisma.smsMessage.update({ where: { id: msg.id }, data: { status: 'FAILED', error: r.error ?? 'Send failed' } });
      result.failed++;
    }
    emit.smsChanged(msg.hospitalId);
  }
  return result;
}

const RANK: Record<SmsStatus, number> = { QUEUED: 0, SIMULATED: 1, SENT: 1, FAILED: 2, DELIVERED: 3 };

/** Stores a delivery report. A late "sent" never overwrites "delivered". */
export async function applyDeliveryReport(report: DeliveryReport) {
  const msg = await prisma.smsMessage.findUnique({ where: { providerMessageId: report.providerMessageId } });
  if (!msg) return false;
  if (RANK[report.status] < RANK[msg.status]) return true;
  await prisma.smsMessage.update({
    where: { id: msg.id },
    data: {
      status: report.status,
      deliveredAt: report.status === 'DELIVERED' ? new Date() : msg.deliveredAt,
      error: report.status === 'FAILED' ? (report.error ?? 'Delivery failed') : null,
    },
  });
  emit.smsChanged(msg.hospitalId);
  return true;
}

/** Feedback replies are accepted for 3 days after the feedback SMS. */
const FEEDBACK_WINDOW_MS = 3 * 24 * 3600_000;

/**
 * An inbound SMS. If it answers a feedback question ("1" = yes, "2" = no), the answer is stored
 * on the most recent visit that asked this number for feedback, and a short thank-you is sent.
 */
export async function handleInboundSms(fromRaw: string, text: string) {
  const from = normalizeRwandaPhone(fromRaw) ?? fromRaw;
  const answer = parseFeedbackReply(text);
  const visit = await prisma.visit.findFirst({
    where: {
      feedbackRequestedAt: { gte: new Date(Date.now() - FEEDBACK_WINDOW_MS) },
      feedbackAnswer: null,
      tickets: { some: { phone: from } },
    },
    orderBy: { feedbackRequestedAt: 'desc' },
    include: { tickets: { where: { phone: from }, orderBy: { joinedAt: 'desc' }, take: 1 } },
  });
  await prisma.inboundSms.create({
    data: { from, text: text.slice(0, 500), hospitalId: visit?.hospitalId ?? null, visitId: visit?.id ?? null, answer: visit && answer ? answer : null },
  });
  if (!visit || !answer) return { matched: !!visit, answer: null };

  await prisma.visit.update({ where: { id: visit.id }, data: { feedbackAnswer: answer, feedbackAt: new Date() } });
  const t = visit.tickets[0];
  await store({ hospitalId: visit.hospitalId, ticketId: t?.id, to: from, language: t?.language ?? 'RW', template: 'FEEDBACK_THANKS', body: feedbackThanks(t?.language ?? 'RW') });
  return { matched: true, answer };
}
