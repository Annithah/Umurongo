// In-process scheduler. Each tick takes a PostgreSQL advisory lock (held by one transaction),
// so with several API instances only one runs a given job at a time.
import { prisma } from '../db';
import { dailyClose, retention, runJob, smsOutbox, type JobName } from './jobs';

const LOCK_KEYS: Record<JobName, number> = { retention: 41_001, 'daily-close': 41_002, 'sms-outbox': 41_003 };

/** Runs fn only if this process gets the job's lock; otherwise returns null. */
export async function withJobLock<T>(job: JobName, fn: () => Promise<T>): Promise<T | null> {
  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_KEYS[job]}) AS locked`;
      return locked ? fn() : null;
    },
    { timeout: 5 * 60_000, maxWait: 10_000 },
  );
}

const timers: NodeJS.Timeout[] = [];

function every(ms: number, job: JobName, run: () => Promise<unknown>) {
  const tick = () => withJobLock(job, run).catch((e) => console.error(`Scheduler ${job}:`, e));
  timers.push(setInterval(tick, ms));
  setTimeout(tick, 5_000); // first run shortly after start
}

export function startScheduler() {
  every(15_000, 'sms-outbox', () => runJob('sms-outbox', () => smsOutbox(), { logIfEmpty: (r) => r.sent + r.retried + r.failed > 0 }));
  every(60_000, 'daily-close', () => runJob('daily-close', () => dailyClose(), { logIfEmpty: (r) => r.closed.length > 0 }));
  every(60 * 60_000, 'retention', () => runJob('retention', () => retention()));
  console.log('Background jobs started: SMS outbox (15 s), daily close (1 min), retention (1 h)');
}

export function stopScheduler() {
  while (timers.length) clearInterval(timers.pop());
}
