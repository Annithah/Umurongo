// Background jobs: data retention and daily close, run logging and the job lock.
import { beforeEach, describe, expect, it } from 'vitest';
import { clockToMinutes, kigaliDate } from '@umurongo/shared';
import { dailyClose, retention, runJob } from '../src/jobs/jobs';
import { withJobLock } from '../src/jobs/scheduler';
import { api, as, describeDb, prisma, reseed, walkIn } from './helpers';

const DAY = 86_400_000;
/** A moment today in Kigali at the given clock time. */
const kigaliAt = (clock: string) => new Date(new Date(`${kigaliDate()}T00:00:00Z`).getTime() - 2 * 3600_000 + clockToMinutes(clock) * 60_000);

describeDb('jobs', () => {
  beforeEach(() => reseed());

  describe('retention', () => {
    it('removes phone numbers older than 30 days and nothing else', async () => {
      const old = await walkIn({ displayName: 'Aline', phone: '0788123456' });
      const fresh = await walkIn({ displayName: 'Eric', phone: '0722000111' });
      await prisma.ticket.update({ where: { id: old.ticket.id }, data: { joinedAt: new Date(Date.now() - 31 * DAY) } });
      await prisma.smsMessage.updateMany({ where: { ticketId: old.ticket.id }, data: { createdAt: new Date(Date.now() - 31 * DAY) } });
      await prisma.inboundSms.create({ data: { from: '+250788123456', text: '1', receivedAt: new Date(Date.now() - 40 * DAY) } });

      const result = await runJob('retention', () => retention());
      expect(result).toMatchObject({ ok: true, summary: { tickets: 1, smsMessages: 1, inboundSms: 1 } });

      const o = await prisma.ticket.findUniqueOrThrow({ where: { id: old.ticket.id } });
      expect(o.phone).toBeNull();
      expect(o.phoneRemovedAt).not.toBeNull();
      expect(o.number).toBe(old.ticket.number); // kept for analytics
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: fresh.ticket.id } })).phone).toBe('+250722000111');
      expect(await prisma.smsMessage.count({ where: { ticketId: old.ticket.id, to: { not: null } } })).toBe(0);
      expect(await prisma.inboundSms.count({ where: { from: { not: null } } })).toBe(0);

      // The run is logged, and the audit log says what was removed.
      const run = await prisma.jobRun.findFirstOrThrow({ where: { job: 'retention' } });
      expect(run).toMatchObject({ ok: true, summary: { tickets: 1, smsMessages: 1, inboundSms: 1 } });
      expect(await prisma.auditLog.count({ where: { action: 'RETENTION_RUN' } })).toBe(1);

      // Running again finds nothing new.
      expect((await retention()).tickets).toBe(0);
    });

    it('respects a hospital retention period set by the admin', async () => {
      const t = await walkIn({ displayName: 'Joy', phone: '0733000222' });
      await prisma.ticket.update({ where: { id: t.ticket.id }, data: { joinedAt: new Date(Date.now() - 10 * DAY) } });
      expect((await retention()).tickets).toBe(0);
      await prisma.hospital.update({ where: { id: 'masaka' }, data: { retentionDays: 7 } });
      expect((await retention()).tickets).toBe(1);
    });

    it('logs a failed run', async () => {
      const r = await runJob('retention', async () => {
        throw new Error('disk full');
      });
      expect(r).toEqual({ ok: false, error: 'disk full' });
      expect(await prisma.jobRun.findFirstOrThrow({ where: { ok: false } })).toMatchObject({ job: 'retention', error: 'disk full' });
    });
  });

  describe('daily close', () => {
    it('closes waiting tickets at closing time, sends the next opening time, once a day', async () => {
      const reg = await walkIn({ displayName: 'Aline', phone: '0788123456', language: 'EN' });
      // Before closing time: nothing happens.
      expect((await dailyClose(kigaliAt('18:59'))).closed).toEqual([]);

      const evening = kigaliAt('19:05');
      const r = await dailyClose(evening);
      const opd = r.closed.find((c) => c.department === 'OPD');
      expect(opd?.tickets).toBe(5); // 020-023 and the new walk-in; 018 and 019 are in consultation
      expect(r.closed.find((c) => c.department === 'MAT')).toBeUndefined(); // open 24 hours

      const t = await prisma.ticket.findUniqueOrThrow({ where: { id: reg.ticket.id } });
      expect(t.status).toBe('CLOSED');
      expect((await prisma.ticket.findFirstOrThrow({ where: { number: 'OPD-018' } })).status).toBe('IN_CONSULTATION');
      const sms = await prisma.smsMessage.findFirstOrThrow({ where: { ticketId: t.id, template: 'DAY_CLOSED' } });
      expect(sms.body).toBe(`Umurongo: General consultation has closed for today and ticket ${t.number} has ended. We open again tomorrow at 07:00.`);

      const page = await api.get(`/api/public/tickets/${t.publicToken}`);
      expect(page.body.status).toBe('CLOSED');

      // Second run the same evening does nothing.
      expect((await dailyClose(kigaliAt('19:30'))).closed).toEqual([]);
      expect(await prisma.auditLog.count({ where: { action: 'DAY_CLOSED', ticketId: t.id } })).toBe(1);
    });

    it('can be run by an admin from the jobs screen', async () => {
      const res = await api.post('/api/admin/jobs/retention/run').set(await as('admin'));
      expect(res.body).toMatchObject({ ok: true });
      const runs = await api.get('/api/admin/jobs').set(await as('admin'));
      expect(runs.body[0]).toMatchObject({ job: 'retention', ok: true });
    });
  });

  describe('job lock', () => {
    it('lets only one process run a job at a time', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const first = withJobLock('retention', async () => {
        await gate;
        return 'first';
      });
      await new Promise((r) => setTimeout(r, 200)); // let the first take the lock
      const second = await withJobLock('retention', async () => 'second');
      release();
      expect(second).toBeNull();
      expect(await first).toBe('first');
      expect(await withJobLock('retention', async () => 'third')).toBe('third');
    });
  });
});
