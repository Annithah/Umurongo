// Staff sign-in, invite acceptance and "who am I".
import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import type { LoginResponse } from '@umurongo/shared';
import { prisma } from '../db';
import { mustStaff, requireStaff, signStaff } from '../auth';
import { h, HttpError } from '../http';
import { rateLimit } from '../rate-limit';
import { staffMe } from '../services/views';
import { audit } from '../services/audit';
import { hashToken, randomToken } from '../tokens';
import { password } from './schemas';

export const authRoutes = Router();

// A bcrypt hash of a random string, compared when the email is unknown, so a wrong email
// takes as long as a wrong password (no account discovery by timing).
const DUMMY_HASH = bcrypt.hashSync(randomToken(), 10);

authRoutes.post(
  '/auth/login',
  rateLimit(10), // per IP and minute
  rateLimit(5, 60_000, (req) => `email:${String(req.body?.email ?? '').toLowerCase()}`), // per account and minute
  h(async (req, res) => {
    const { email, password: pw } = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }).parse(req.body);
    const staff = await prisma.staff.findUnique({ where: { email } });
    const ok = await bcrypt.compare(pw, staff?.passwordHash ?? DUMMY_HASH);
    if (!staff || !staff.passwordHash || !ok || !staff.active) throw new HttpError(401, 'Wrong email or password');
    await prisma.staff.update({ where: { id: staff.id }, data: { lastLoginAt: new Date() } });
    await audit({ hospitalId: staff.hospitalId, actorId: staff.id, action: 'SIGNED_IN', entityType: 'Staff', entityId: staff.id });
    const body: LoginResponse = { token: signStaff(staff), staff: await staffMe(staff.id) };
    res.json(body);
  }),
);

authRoutes.get(
  '/staff/me',
  requireStaff(),
  h(async (_req, res) => res.json(await staffMe(mustStaff(res).id))),
);

const inviteParam = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{22}$/, 'Invalid invite link') });

async function findInvite(token: string) {
  const staff = await prisma.staff.findUnique({ where: { inviteTokenHash: hashToken(token) }, include: { hospital: true } });
  if (!staff || !staff.active || !staff.inviteExpiresAt || staff.inviteExpiresAt < new Date()) {
    throw new HttpError(404, 'This invite link is not valid any more. Ask your admin for a new one.');
  }
  return staff;
}

authRoutes.get(
  '/auth/invite/:token',
  rateLimit(20),
  h(async (req, res) => {
    const staff = await findInvite(inviteParam.parse(req.params).token);
    res.json({ fullName: staff.fullName, email: staff.email, hospitalName: staff.hospital.name });
  }),
);

authRoutes.post(
  '/auth/invite/:token',
  rateLimit(10),
  h(async (req, res) => {
    const staff = await findInvite(inviteParam.parse(req.params).token);
    const { password: pw } = z.object({ password }).parse(req.body);
    const updated = await prisma.staff.update({
      where: { id: staff.id },
      data: { passwordHash: await bcrypt.hash(pw, 10), inviteTokenHash: null, inviteExpiresAt: null, lastLoginAt: new Date() },
    });
    await audit({ hospitalId: staff.hospitalId, actorId: staff.id, action: 'INVITE_ACCEPTED', entityType: 'Staff', entityId: staff.id });
    const body: LoginResponse = { token: signStaff(updated), staff: await staffMe(staff.id) };
    res.json(body);
  }),
);
