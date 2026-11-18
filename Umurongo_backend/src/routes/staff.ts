// Staff routes: shared views (any staff), reception actions and serving ("My queue") actions.
// Privacy: only reception (and hospital admins) ever receive phone numbers.
import { Router } from 'express';
import { z } from 'zod';
import type { Staff } from '@prisma/client';
import { kigaliDate, kigaliMidnight, type DepartmentQueue, type MyQueueView, type RegisterResult } from '@umurongo/shared';
import { prisma } from '../db';
import { patientUrl } from '../env';
import { mustStaff, requireStaff } from '../auth';
import { h, HttpError, notFound } from '../http';
import {
  callAgain,
  callNext,
  cancelTicket,
  currentTicketOf,
  finishTicket,
  markNoShow,
  referCurrent,
  registerWalkIn,
  reorder,
  setPriority,
  setStaffStatus,
  startTicket,
} from '../services/queue';
import {
  departmentSummaries,
  hospitalOf,
  listStaff,
  staffMe,
  ticketInclude,
  toQueueEntry,
  toReceptionEntry,
  toStaffPublic,
  waitingLine,
} from '../services/views';
import { idParam, priority, priorityReason, reason, statusBody, walkInBody } from './schemas';

export const staffRoutes = Router();

const ANY_STAFF = requireStaff();
const RECEPTION = requireStaff('RECEPTIONIST');
const SERVING = requireStaff('CLINICIAN', 'COUNTER');

const seesPhones = (s: Staff) => s.role === 'RECEPTIONIST' || s.role === 'HOSPITAL_ADMIN';

// ─── Shared views ───────────────────────────────────────────────────────────

staffRoutes.get(
  '/departments',
  ANY_STAFF,
  h(async (_req, res) => res.json(await departmentSummaries(mustStaff(res).hospitalId))),
);

staffRoutes.get(
  '/queues/:id',
  ANY_STAFF,
  h(async (req, res) => {
    const staff = mustStaff(res);
    const { id } = idParam.parse(req.params);
    const department = (await departmentSummaries(staff.hospitalId)).find((d) => d.id === id);
    if (!department) throw notFound('Department not found');
    const entry = seesPhones(staff) ? toReceptionEntry : toQueueEntry;
    const [line, serving, team, hospital] = await Promise.all([
      waitingLine(id),
      prisma.ticket.findMany({ where: { departmentId: id, status: { in: ['CALLED', 'IN_CONSULTATION'] } }, include: ticketInclude, orderBy: { calledAt: 'asc' } }),
      listStaff({ departmentId: id }),
      hospitalOf(staff.hospitalId),
    ]);
    const body: DepartmentQueue = { department, waiting: line.map(entry), serving: serving.map(entry), staff: team, graceMinutes: hospital.graceMinutes };
    res.json(body);
  }),
);

staffRoutes.get(
  '/staff',
  ANY_STAFF,
  h(async (_req, res) => res.json(await listStaff({ hospitalId: mustStaff(res).hospitalId }))),
);

/** Reception (and admins) can change anyone's status; everyone can change their own. */
staffRoutes.patch(
  '/staff/:id/status',
  ANY_STAFF,
  h(async (req, res) => {
    const actor = mustStaff(res);
    const { id } = idParam.parse(req.params);
    if (id !== actor.id && !seesPhones(actor)) throw new HttpError(403, 'Only reception can change another person\'s status');
    const target = await prisma.staff.findFirst({ where: { id, hospitalId: actor.hospitalId, active: true } });
    if (!target) throw notFound('Staff member not found');
    const { status, backAt } = statusBody.parse(req.body);
    const updated = await setStaffStatus(target, status, backAt ? new Date(backAt) : null, actor);
    const full = await prisma.staff.findUniqueOrThrow({ where: { id: updated.id }, include: { department: true, room: true } });
    res.json(toStaffPublic(full));
  }),
);

// ─── Reception ──────────────────────────────────────────────────────────────

staffRoutes.post(
  '/walk-ins',
  RECEPTION,
  h(async (req, res) => {
    const input = walkInBody.parse(req.body);
    const r = await registerWalkIn(mustStaff(res), { ...input, note: input.note || null });
    const body: RegisterResult = {
      ticket: toReceptionEntry(r.ticket),
      peopleAhead: r.peopleAhead,
      estimateMinutes: r.estimateMinutes,
      patientUrl: patientUrl(r.ticket.publicToken),
    };
    res.status(201).json(body);
  }),
);

/** Search the last 24 hours of tickets by ticket number ("024", "OPD-024") or phone ("0788 123 456"). */
staffRoutes.get(
  '/search',
  RECEPTION,
  h(async (req, res) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(40) }).parse(req.query);
    const staff = mustStaff(res);
    const digits = q.replace(/\D/g, '');
    const since = new Date(Date.now() - 24 * 3600_000); // a rolling day, so night shifts see the evening
    const or: object[] = [{ number: { contains: q.toUpperCase() } }];
    if (digits.length >= 6) or.push({ phone: { contains: digits.slice(-9) } });
    const tickets = await prisma.ticket.findMany({
      where: { hospitalId: staff.hospitalId, joinedAt: { gte: since }, OR: or },
      include: ticketInclude,
      orderBy: { joinedAt: 'desc' },
      take: 20,
    });
    res.json(tickets.map(toReceptionEntry));
  }),
);

staffRoutes.get(
  '/tickets/:id',
  RECEPTION,
  h(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const t = await prisma.ticket.findFirst({ where: { id, hospitalId: mustStaff(res).hospitalId }, include: ticketInclude });
    if (!t) throw notFound('Ticket not found');
    res.json({ ...toReceptionEntry(t), patientUrl: patientUrl(t.publicToken) });
  }),
);

staffRoutes.post(
  '/tickets/:id/reorder',
  RECEPTION,
  h(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ direction: z.enum(['UP', 'DOWN']), reason }).parse(req.body);
    await reorder(id, body.direction, body.reason, mustStaff(res));
    res.json({ ok: true });
  }),
);

staffRoutes.post(
  '/tickets/:id/priority',
  RECEPTION,
  h(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = z
      .object({ priority, priorityReason: priorityReason.default('NONE'), reason })
      .refine((v) => (v.priority === 'PRIORITY') === (v.priorityReason !== 'NONE'), { message: 'Choose a reason for Priority', path: ['priorityReason'] })
      .parse(req.body);
    res.json(toReceptionEntry(await setPriority(id, mustStaff(res), body.priority, body.priorityReason, body.reason)));
  }),
);

staffRoutes.post(
  '/tickets/:id/cancel',
  RECEPTION,
  h(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason }).parse(req.body);
    res.json(toReceptionEntry(await cancelTicket(id, mustStaff(res), body.reason)));
  }),
);

staffRoutes.post(
  '/tickets/:id/no-show',
  RECEPTION,
  h(async (req, res) => res.json(toReceptionEntry(await markNoShow(idParam.parse(req.params).id, mustStaff(res))))),
);

staffRoutes.post(
  '/tickets/:id/call-again',
  RECEPTION,
  h(async (req, res) => {
    await callAgain(idParam.parse(req.params).id, mustStaff(res));
    res.json({ ok: true });
  }),
);

// ─── Serving: "My queue" for clinicians and counters (lab, pharmacy, cashier) ─

async function myQueue(staff: Staff): Promise<MyQueueView> {
  if (!staff.departmentId) throw new HttpError(400, 'You are not assigned to a department. Ask an admin.');
  const since = kigaliMidnight(kigaliDate());
  const [me, current, line, todayCount, hospital, targets] = await Promise.all([
    staffMe(staff.id),
    currentTicketOf(staff.id),
    waitingLine(staff.departmentId),
    prisma.ticket.count({ where: { staffId: staff.id, status: { in: ['DONE', 'REFERRED'] }, finishedAt: { gte: since } } }),
    hospitalOf(staff.hospitalId),
    prisma.department.findMany({ where: { hospitalId: staff.hospitalId, id: { not: staff.departmentId } }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
  ]);
  const { email: _email, hospital: _hospital, ...publicMe } = me;
  return {
    me: publicMe,
    current: current ? toQueueEntry(current) : null,
    queue: line.map(toQueueEntry),
    todayCount,
    graceMinutes: hospital.graceMinutes,
    nextStepTargets: targets.map((d) => ({ id: d.id, code: d.code, nameEn: d.nameEn, kind: d.kind, isOpen: d.isOpen })),
  };
}

staffRoutes.get('/me/queue', SERVING, h(async (_req, res) => res.json(await myQueue(mustStaff(res)))));

staffRoutes.post(
  '/me/call-next',
  SERVING,
  h(async (_req, res) => {
    const t = await callNext(mustStaff(res));
    res.json({ called: toQueueEntry(t), ...(await myQueue(mustStaff(res))) });
  }),
);

staffRoutes.post(
  '/me/start',
  SERVING,
  h(async (_req, res) => {
    await startTicket(mustStaff(res));
    res.json(await myQueue(mustStaff(res)));
  }),
);

staffRoutes.post(
  '/me/finish',
  SERVING,
  h(async (_req, res) => {
    await finishTicket(mustStaff(res));
    res.json(await myQueue(mustStaff(res)));
  }),
);

staffRoutes.post(
  '/me/refer',
  SERVING,
  h(async (req, res) => {
    const body = z.object({ departmentId: idParam.shape.id, note: z.string().trim().max(200).optional() }).parse(req.body);
    const child = await referCurrent(mustStaff(res), body.departmentId, body.note || null);
    res.json({ referredTo: toQueueEntry(child), ...(await myQueue(mustStaff(res))) });
  }),
);

staffRoutes.post(
  '/me/no-show',
  SERVING,
  h(async (_req, res) => {
    const staff = mustStaff(res);
    const current = await currentTicketOf(staff.id);
    if (!current) throw new HttpError(409, 'You have no called patient');
    await markNoShow(current.id, staff);
    res.json(await myQueue(staff));
  }),
);

staffRoutes.post(
  '/me/call-again',
  SERVING,
  h(async (_req, res) => {
    const staff = mustStaff(res);
    const current = await currentTicketOf(staff.id);
    if (!current) throw new HttpError(409, 'You have no called patient');
    await callAgain(current.id, staff);
    res.json(await myQueue(staff));
  }),
);
