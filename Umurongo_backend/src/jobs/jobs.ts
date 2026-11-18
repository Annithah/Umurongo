// Background jobs. They run inside the API process (see scheduler.ts) and can also be started
// from the command line (cli.ts), e.g. by a hosted cron. Each run is logged in JobRun.
import type { Prisma } from '@prisma/client';
import { isDueForDailyClose, kigaliDate } from '@umurongo/shared';
import { prisma } from '../db';
import { processOutbox } from '../sms/outbox';
import { closeDepartmentDay } from '../services/queue';
import { audit } from '../services/audit';

export type JobName = 'retention' | 'daily-close' | 'sms-outbox';

/** Runs fn and records the run (start, end, ok, summary or error). */
export async function runJob<T extends Prisma.InputJsonValue>(job: JobName, fn: () => Promise<T>, opts: { logIfEmpty?: (r: T) => boolean } = {}) {
  const startedAt = new Date();
  try {
    const summary = await fn();
    if (opts.logIfEmpty && !opts.logIfEmpty(summary)) return { ok: true as const, summary };
    await prisma.jobRun.create({ data: { job, startedAt, finishedAt: new Date(), ok: true, summary } });
    return { ok: true as const, summary };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await prisma.jobRun.create({ data: { job, startedAt, finishedAt: new Date(), ok: false, error: error.slice(0, 1000) } });
    console.error(`Job ${job} failed:`, e);
    return { ok: false as const, error };
  }
}

/**
 * Data retention: removes phone numbers older than Hospital.retentionDays (default 30) from
 * tickets, the SMS outbox and inbound SMS. Ticket numbers and timestamps stay for analytics.
 */
export async function retention(now = new Date()) {
  const hospitals = await prisma.hospital.findMany({ select: { id: true, retentionDays: true } });
  const summary = { tickets: 0, smsMessages: 0, inboundSms: 0 };
  for (const h of hospitals) {
    const cutoff = new Date(now.getTime() - h.retentionDays * 86_400_000);
    const t = await prisma.ticket.updateMany({ where: { hospitalId: h.id, joinedAt: { lt: cutoff }, phone: { not: null } }, data: { phone: null, phoneRemovedAt: now } });
    const s = await prisma.smsMessage.updateMany({ where: { hospitalId: h.id, createdAt: { lt: cutoff }, to: { not: null } }, data: { to: null } });
    const i = await prisma.inboundSms.updateMany({ where: { OR: [{ hospitalId: h.id }, { hospitalId: null }], receivedAt: { lt: cutoff }, from: { not: null } }, data: { from: null } });
    summary.tickets += t.count;
    summary.smsMessages += s.count;
    summary.inboundSms += i.count;
    if (t.count + s.count + i.count > 0) {
      await audit({ hospitalId: h.id, action: 'RETENTION_RUN', entityType: 'Hospital', entityId: h.id, detail: { cutoff: cutoff.toISOString(), tickets: t.count, smsMessages: s.count, inboundSms: i.count } });
    }
  }
  return summary;
}

/** Daily close: for each department past its closing time and not closed today, close open tickets. */
export async function dailyClose(now = new Date()) {
  const departments = await prisma.department.findMany({ include: { hospital: true } });
  const closed: { department: string; tickets: number }[] = [];
  for (const d of departments) {
    if (!isDueForDailyClose(d.closesAt, d.opensAt, d.lastClosedOn, now)) continue;
    // Claim the department for today so a second process does not close it again.
    const { lastClosedOn } = d;
    const claimed = await prisma.department.updateMany({ where: { id: d.id, lastClosedOn }, data: { lastClosedOn: kigaliDate(now) } });
    if (!claimed.count) continue;
    try {
      const tickets = await closeDepartmentDay(d, d.hospital, now);
      closed.push({ department: d.code, tickets });
    } catch (e) {
      await prisma.department.update({ where: { id: d.id }, data: { lastClosedOn } });
      throw e;
    }
  }
  return { closed };
}

export async function smsOutbox(now = new Date()) {
  return processOutbox(now);
}

export const JOBS: Record<JobName, (now?: Date) => Promise<Prisma.InputJsonValue>> = {
  retention,
  'daily-close': dailyClose,
  'sms-outbox': smsOutbox,
};
