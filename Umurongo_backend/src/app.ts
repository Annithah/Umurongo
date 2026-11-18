import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import type { HealthResponse } from '@umurongo/shared';
import { corsOrigins, devRoutesEnabled } from './env';
import { prisma } from './db';
import { HttpError } from './http';
import { authRoutes } from './routes/auth';
import { staffRoutes } from './routes/staff';
import { publicRoutes } from './routes/public';
import { adminRoutes } from './routes/admin';
import { smsRoutes } from './routes/sms';
import { devRoutes } from './routes/dev';

// The Express app is built separately from the HTTP server so tests can use it with Supertest.
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render/Railway put one proxy in front; needed for per-IP rate limits
  app.use(cors({ origin: corsOrigins }));
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' })); // SMS provider webhooks post forms
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer'); // patient link tokens must not leak in Referer
    next();
  });

  const api = express.Router();

  api.get('/health', async (_req, res) => {
    let db = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    const body: HealthResponse = { ok: true, db, time: new Date().toISOString() };
    res.status(db ? 200 : 503).json(body);
  });

  api.use(authRoutes);
  api.use(publicRoutes);
  api.use(smsRoutes);
  api.use(adminRoutes);
  api.use(staffRoutes);
  if (devRoutesEnabled) api.use(devRoutes);

  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return res.status(400).json({ error: first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input', issues: err.issues });
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return res.status(404).json({ error: 'Not found' });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  };
  app.use(onError);

  return app;
}
