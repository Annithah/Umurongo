import type { RequestHandler } from 'express';
import { isTest } from './env';

// Small in-memory rate limiter: at most `max` requests per key per window.
// Off in tests by default (every test request comes from one IP); a test can switch it on.
let enabled = !isTest;
export function setRateLimitEnabled(on: boolean) {
  enabled = on;
}

export function rateLimit(max: number, windowMs = 60_000, keyOf: (req: Parameters<RequestHandler>[0]) => string = (req) => `${req.ip}:${req.baseUrl}${req.route?.path ?? req.path}`): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    if (!enabled) return next();
    const now = Date.now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
    const key = keyOf(req);
    const hit = hits.get(key);
    if (!hit || hit.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    hit.count += 1;
    if (hit.count > max) {
      res.setHeader('Retry-After', Math.ceil((hit.resetAt - now) / 1000));
      return res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.' });
    }
    next();
  };
}
