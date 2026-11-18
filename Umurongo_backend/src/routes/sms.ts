// SMS provider webhooks: delivery reports and inbound SMS (feedback replies).
// The provider must call them with ?secret=<SMS_WEBHOOK_SECRET>.
import { Router, type Request } from 'express';
import { env } from '../env';
import { h, HttpError } from '../http';
import { rateLimit } from '../rate-limit';
import { applyDeliveryReport, handleInboundSms, smsProvider } from '../sms/outbox';
import { safeEqual } from '../tokens';

export const smsRoutes = Router();

function checkSecret(req: Request) {
  if (!env.SMS_WEBHOOK_SECRET) throw new HttpError(503, 'SMS webhooks are not configured');
  const given = String(req.query.secret ?? req.headers['x-webhook-secret'] ?? '');
  if (!safeEqual(given, env.SMS_WEBHOOK_SECRET)) throw new HttpError(401, 'Bad webhook secret');
}

smsRoutes.post(
  '/sms/delivery',
  rateLimit(600),
  h(async (req, res) => {
    checkSecret(req);
    const report = smsProvider().parseDeliveryReport(req.body ?? {});
    if (!report) throw new HttpError(400, 'Not a delivery report');
    res.json({ ok: true, matched: await applyDeliveryReport(report) });
  }),
);

smsRoutes.post(
  '/sms/inbound',
  rateLimit(600),
  h(async (req, res) => {
    checkSecret(req);
    const msg = smsProvider().parseInbound(req.body ?? {});
    if (!msg) throw new HttpError(400, 'Not an inbound SMS');
    res.json({ ok: true, ...(await handleInboundSms(msg.from, msg.text)) });
  }),
);
