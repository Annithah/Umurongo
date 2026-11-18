// Demo and development helpers. Mounted only when NODE_ENV !== production or DEMO_MODE=true,
// and still behind staff sign-in (simulated SMS show full phone numbers).
import { Router } from 'express';
import { z } from 'zod';
import type { Department, Staff } from '@prisma/client';
import { formatRwandaPhone } from '@umurongo/shared';
import { prisma } from '../db';
import { mustStaff, requireStaff } from '../auth';
import { h, HttpError } from '../http';
import { emit } from '../realtime';
import { handleInboundSms, smsSimulated } from '../sms/outbox';
import { seedDemo } from '../seed-data';
import { callNext, currentTicketOf, finishTicket, referCurrent, registerWalkIn, startTicket } from '../services/queue';
import { phone } from './schemas';

export const devRoutes = Router();

devRoutes.get(
  '/dev/sms',
  requireStaff('RECEPTIONIST'),
  h(async (_req, res) => {
    const list = await prisma.smsMessage.findMany({
      where: { hospitalId: mustStaff(res).hospitalId },
      include: { ticket: { select: { number: true } } },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });
    res.json({
      simulated: smsSimulated(),
      messages: list.map((m) => ({
        id: m.id,
        at: m.createdAt.toISOString(),
        to: formatRwandaPhone(m.to),
        template: m.template,
        language: m.language,
        body: m.body,
        status: m.status,
        ticketNumber: m.ticket?.number ?? null,
      })),
    });
  }),
);

/** Pretend a patient replied to an SMS (e.g. "1" to the feedback question). */
devRoutes.post(
  '/dev/sms/reply',
  requireStaff('RECEPTIONIST'),
  h(async (req, res) => {
    const body = z.object({ phone, text: z.string().trim().min(1).max(160) }).parse(req.body);
    if (!body.phone) throw new HttpError(400, 'phone: required');
    res.json(await handleInboundSms(body.phone, body.text));
  }),
);

const WALK_INS = ['Claude', 'J. N.', 'Aimée', 'Eric', 'P. U.', 'Sandrine', 'Innocent', 'Fiona', 'Olivier', 'Grace'];

/** Where each kind of department sends a patient next, for the demo journey OPD -> LAB -> CSH -> PHA. */
function nextStep(kind: Department['kind'], departments: Department[]): Department | null | 'finish' {
  const byKind = (k: Department['kind']) => departments.find((d) => d.kind === k && d.isOpen) ?? null;
  if (kind === 'CONSULTATION') return Math.random() < 0.6 ? byKind('LAB') : Math.random() < 0.5 ? byKind('PHARMACY') : 'finish';
  if (kind === 'LAB' || kind === 'IMAGING') return byKind('CASHIER');
  if (kind === 'CASHIER') return byKind('PHARMACY');
  return 'finish';
}

async function advanceOne(staff: Staff & { department: Department | null }, departments: Department[]): Promise<string | null> {
  const current = await currentTicketOf(staff.id);
  if (current?.status === 'CALLED') {
    await startTicket(staff);
    return `${staff.fullName}: started ${current.number}`;
  }
  let action = '';
  if (current?.status === 'IN_CONSULTATION' && staff.department) {
    const next = nextStep(staff.department.kind, departments);
    if (next && next !== 'finish') {
      await referCurrent(staff, next.id, null);
      action = `${current.number} -> ${next.code}, `;
    } else {
      await finishTicket(staff);
      action = `${current.number} done, `;
    }
  }
  try {
    const called = await callNext(staff);
    return `${staff.fullName}: ${action}called ${called.number}`;
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 400)) return action ? `${staff.fullName}: ${action}nobody waiting` : null;
    throw e;
  }
}

devRoutes.post(
  '/dev/advance',
  requireStaff('HOSPITAL_ADMIN'),
  h(async (_req, res) => {
    const hospitalId = mustStaff(res).hospitalId;
    const departments = await prisma.department.findMany({ where: { hospitalId } });
    const staff = await prisma.staff.findMany({
      where: { hospitalId, active: true, role: { in: ['CLINICIAN', 'COUNTER'] }, status: { in: ['AVAILABLE', 'IN_CONSULTATION'] }, departmentId: { not: null } },
      include: { department: true },
      orderBy: { fullName: 'asc' },
    });
    const log: string[] = [];
    for (const s of staff) {
      const line = await advanceOne(s, departments);
      if (line) log.push(line);
    }
    if (Math.random() < 0.6) {
      const reception = await prisma.staff.findFirst({ where: { hospitalId, role: 'RECEPTIONIST', active: true } });
      const opd = departments.find((d) => d.kind === 'CONSULTATION' && d.isOpen);
      if (reception && opd) {
        const r = await registerWalkIn(reception, {
          departmentId: opd.id,
          displayName: WALK_INS[Math.floor(Math.random() * WALK_INS.length)],
          phone: null,
          language: 'RW',
          priority: 'NORMAL',
          priorityReason: 'NONE',
        });
        log.push(`New walk-in ${r.ticket.number}`);
      }
    }
    res.json({ ok: true, log });
  }),
);

devRoutes.post(
  '/dev/reset',
  requireStaff('HOSPITAL_ADMIN'),
  h(async (_req, res) => {
    await seedDemo(prisma);
    emit.reset();
    res.json({ ok: true });
  }),
);
