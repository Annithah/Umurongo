import 'dotenv/config';
import { z } from 'zod';

// Validate environment variables once at startup so a missing value fails loudly.
const schema = z
  .object({
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    // Base URL of the web app, used in patient links (QR codes and SMS).
    PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),
    PORT: z.coerce.number().default(4000),
    NODE_ENV: z.string().default('development'),
    // Pitch demo helpers (/api/dev/*). Always on outside production.
    DEMO_MODE: z
      .string()
      .optional()
      .transform((v) => v === 'true'),

    // SMS. simulate = nothing leaves the server; messages appear in the dev panel.
    SMS_MODE: z.enum(['simulate', 'live']).default('simulate'),
    SMS_PROVIDER: z.enum(['africastalking', 'http']).default('africastalking'),
    AT_USERNAME: z.string().optional(),
    AT_API_KEY: z.string().optional(),
    AT_SANDBOX: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    SMS_HTTP_URL: z.string().url().optional(),
    SMS_HTTP_TOKEN: z.string().optional(),
    // Shared secret the SMS provider must send with delivery reports and inbound SMS.
    SMS_WEBHOOK_SECRET: z.string().optional(),

    // Background jobs (SMS outbox, retention, daily close) run inside the API process.
    JOBS_ENABLED: z
      .string()
      .optional()
      .transform((v) => v !== 'false'),
  })
  .superRefine((e, ctx) => {
    if (e.SMS_MODE !== 'live') return;
    if (e.SMS_PROVIDER === 'africastalking' && (!e.AT_USERNAME || !e.AT_API_KEY)) {
      ctx.addIssue({ code: 'custom', path: ['AT_API_KEY'], message: 'AT_USERNAME and AT_API_KEY are needed when SMS_MODE=live' });
    }
    if (e.SMS_PROVIDER === 'http' && !e.SMS_HTTP_URL) {
      ctx.addIssue({ code: 'custom', path: ['SMS_HTTP_URL'], message: 'SMS_HTTP_URL is needed when SMS_PROVIDER=http' });
    }
    if (!e.SMS_WEBHOOK_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['SMS_WEBHOOK_SECRET'], message: 'SMS_WEBHOOK_SECRET is needed when SMS_MODE=live' });
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isTest = env.NODE_ENV === 'test';
export const corsOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim());
/** Dev-only routes (simulated SMS panel data, advance, reset) are on outside production or in demo mode. */
export const devRoutesEnabled = env.NODE_ENV !== 'production' || env.DEMO_MODE;
export const patientUrl = (token: string) => `${env.PUBLIC_WEB_URL.replace(/\/$/, '')}/t/${token}`;
