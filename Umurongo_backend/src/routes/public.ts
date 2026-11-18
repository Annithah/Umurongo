// Public, read-only routes: the patient ticket page (by secret link token) and the TV.
// Neither ever returns a phone number or another patient's name.
import { Router } from 'express';
import { prisma } from '../db';
import { h } from '../http';
import { rateLimit } from '../rate-limit';
import { buildPublicTicketView, buildTvView } from '../services/views';
import { idParam, tokenParam } from './schemas';

export const publicRoutes = Router();

publicRoutes.get(
  '/public/tickets/:token',
  rateLimit(120),
  h(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await buildPublicTicketView(tokenParam.parse(req.params).token));
  }),
);

publicRoutes.get(
  '/public/tv/:id',
  rateLimit(120),
  h(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await buildTvView(idParam.parse(req.params).id));
  }),
);

/** Lets /tv find the hospital when there is only one (pilot 1). */
publicRoutes.get(
  '/public/hospitals',
  h(async (_req, res) => res.json(await prisma.hospital.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }))),
);
