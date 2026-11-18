import jwt from 'jsonwebtoken';
import type { Request, RequestHandler, Response } from 'express';
import type { Staff, StaffRole } from '@prisma/client';
import { env } from './env';
import { prisma } from './db';

// Staff sign in with email + password and get an 8-hour token. Patients never sign in:
// they follow their ticket with a random link token.
export type StaffClaims = { kind: 'staff'; staffId: string; role: StaffRole; hospitalId: string };

export function signStaff(s: Pick<Staff, 'id' | 'role' | 'hospitalId'>): string {
  const claims: StaffClaims = { kind: 'staff', staffId: s.id, role: s.role, hospitalId: s.hospitalId };
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn: '8h' });
}

export function verifyToken(token: string | undefined | null): StaffClaims | null {
  if (!token) return null;
  try {
    const claims = jwt.verify(token, env.JWT_SECRET) as StaffClaims;
    return claims.kind === 'staff' ? claims : null;
  } catch {
    return null;
  }
}

function readClaims(req: Request): StaffClaims | null {
  const header = req.headers.authorization ?? '';
  return verifyToken(header.startsWith('Bearer ') ? header.slice(7) : null);
}

/**
 * Every staff route uses this. The staff row is re-read on each request, so a deactivated
 * account or a changed role takes effect immediately, not when the token expires.
 * Hospital admins may use every staff route.
 */
export function requireStaff(...roles: StaffRole[]): RequestHandler {
  return (req, res, next) => {
    const claims = readClaims(req);
    if (!claims) return res.status(401).json({ error: 'Please sign in' });
    prisma.staff
      .findUnique({ where: { id: claims.staffId } })
      .then((staff) => {
        if (!staff || !staff.active) return res.status(401).json({ error: 'Please sign in again' });
        if (roles.length && !roles.includes(staff.role) && staff.role !== 'HOSPITAL_ADMIN') {
          return res.status(403).json({ error: 'Your role cannot do this' });
        }
        res.locals.staff = staff;
        next();
      })
      .catch(next);
  };
}

export const mustStaff = (res: Response) => res.locals.staff as Staff;
