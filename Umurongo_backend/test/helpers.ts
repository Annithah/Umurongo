// Shared helpers for the API tests. They run against TEST_DATABASE_URL and re-seed it.
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/db';
import { DEMO_PASSWORD, seedDemo } from '../src/seed-data';

export const dbReachable = await prisma.$queryRaw`SELECT 1`.then(
  () => true,
  () => false,
);
export const skipDb = process.env.SKIP_DB_TESTS === '1';

/**
 * Like describe(), for suites that need the database. Without a database the suite FAILS with a
 * clear message (it never skips silently), unless SKIP_DB_TESTS=1 asks for a skip on purpose.
 */
export function describeDb(name: string, fn: () => void) {
  if (dbReachable) return describe(name, fn);
  if (skipDb) return describe.skip(name, fn);
  return describe(name, () => {
    it('needs the test database', () => {
      expect.fail('No database at TEST_DATABASE_URL / DATABASE_URL. Start it (npm run db:start) or set SKIP_DB_TESTS=1.');
    });
  });
}

export const app = createApp();
// One server for the whole test file. request(app) would start and stop a server per request,
// which breaks parallel requests (Promise.all) with "Cannot read properties of null (reading 'address')".
export const server = app.listen(0);
export const api = request(server);

// Each test file runs in its own worker: close its connections so files do not pile up
// connections until PostgreSQL refuses new ones.
afterAll(async () => {
  server.close();
  await prisma.$disconnect();
});
export { prisma };

export const EMAILS = {
  admin: 'admin@masaka.demo',
  reception: 'reception@masaka.demo',
  uwase: 'claudine@masaka.demo',
  habimana: 'eric@masaka.demo',
  lab: 'diane@masaka.demo',
  cashier: 'cashier@masaka.demo',
  pharmacy: 'samuel@masaka.demo',
} as const;

const tokens = new Map<string, string>();

/** Signs in once per email per test file. */
export async function tokenFor(who: keyof typeof EMAILS): Promise<string> {
  const email = EMAILS[who];
  if (!tokens.has(email)) {
    const res = await api.post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    tokens.set(email, res.body.token);
  }
  return tokens.get(email)!;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function as(who: keyof typeof EMAILS) {
  return bearer(await tokenFor(who));
}

export async function reseed(historyDays = 0) {
  tokens.clear();
  await seedDemo(prisma, { historyDays });
}

export const dept = (code: string) => prisma.department.findFirstOrThrow({ where: { code } });

/** Registers a walk-in through the API as reception. */
export async function walkIn(body: Record<string, unknown>) {
  const opd = await dept('OPD');
  const res = await api.post('/api/walk-ins').set(await as('reception')).send({ departmentId: opd.id, displayName: 'Aline', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { ticket: { id: string; number: string; publicToken: string; phone: string | null }; peopleAhead: number; estimateMinutes: number | null; patientUrl: string };
}

/** Moves a called ticket's call time into the past (to test the no-show grace period). */
export async function calledMinutesAgo(ticketId: string, minutes: number) {
  await prisma.ticket.update({ where: { id: ticketId }, data: { calledAt: new Date(Date.now() - minutes * 60_000) } });
}

/** Any digit run that looks like a phone number. Used to prove a response carries none. */
export const PHONE_LIKE = /(\+?250|\b0)7[2389]\d{7}/;
