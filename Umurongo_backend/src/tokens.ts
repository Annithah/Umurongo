import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 128-bit random token, URL-safe (22 characters). Used for patient links and staff invites. */
export function randomToken(): string {
  return randomBytes(16).toString('base64url');
}

/** Invite tokens are stored hashed, so a database leak does not leak working invite links. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time string comparison for shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const PUBLIC_TOKEN = /^[A-Za-z0-9_-]{22}$/;
