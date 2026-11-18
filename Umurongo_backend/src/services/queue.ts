// All queue state changes live here. Every change:
//   1. updates the ticket,
//   2. writes an audit-log row,
//   3. queues an SMS when it matters (walk-ins who gave a phone number),
//   4. emits Socket.IO events so every screen refetches.
// The ordering, estimate and grace rules themselves are in packages/shared.
import type { Department, Hospital, Language, Priority, PriorityReason, Staff, StaffStatus, Ticket } from '@prisma/client';
import {
  canCancel,
  estimateWaitMinutes,
  formatTicketNumber,
  isPastGrace,
  isServingStatus,
  kigaliDate,
  nextOpening,
  pickNextTicket,
  shouldSendGetReady,
  waitPhrase,
  en,
  rw,
} from '@umurongo/shared';
import { prisma } from '../db';
import { patientUrl } from '../env';
import { HttpError, notFound } from '../http';
import { emit } from '../realtime';
import { sendTemplate } from '../sms/outbox';
import { kigaliToday } from '../time';
import { randomToken } from '../tokens';
import { audit } from './audit';
import { avgMinutesOf, hospitalOf, servingStaffCount, ticketInclude, waitingLine, type FullTicket } from './views';

const ACTIVE = ['WAITING', 'CHECKED_IN', 'CALLED', 'IN_CONSULTATION'] as const;
type StaffWithRoom = Staff & { room?: { name: string } | null };

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadTicket(id: string): Promise<FullTicket> {
  const t = await prisma.ticket.findUnique({ where: { id }, include: ticketInclude });
  if (!t) throw notFound('Ticket not found');
  return t;
}

/** Staff may only act on tickets of their own hospital. */
async function loadTicketFor(id: string, staff: Staff): Promise<FullTicket> {
  const t = await loadTicket(id);
  if (t.hospitalId !== staff.hospitalId) throw notFound('Ticket not found');
  return t;
}

const emitTicket = (t: Ticket) => emit.ticketUpdated(t);

/**
 * Rule: ticket number = prefix + daily counter (3 digits), reset each day.
 * One SQL UPDATE, so two receptionists registering at the same moment never get the same number.
 * (Same logic as nextDailyCounter() in packages/shared.)
 */
async function nextTicketNumber(departmentId: string): Promise<string> {
  const today = kigaliToday().toISOString().slice(0, 10);
  const rows = await prisma.$queryRaw<{ prefix: string; dailyCounter: number }[]>`
    UPDATE "Department"
    SET "dailyCounter" = CASE WHEN "counterDate" = ${today}::date THEN "dailyCounter" + 1 ELSE 1 END,
        "counterDate" = ${today}::date,
        "updatedAt" = now()
    WHERE id = ${departmentId}
    RETURNING prefix, "dailyCounter"`;
  if (!rows[0]) throw notFound('Department not found');
  return formatTicketNumber(rows[0].prefix, rows[0].dailyCounter);
}

const deptName = (d: Pick<Department, 'nameEn' | 'nameRw'>, lang: Language) => (lang === 'EN' ? d.nameEn : d.nameRw);

async function staffWithRoom(id: string): Promise<StaffWithRoom> {
  return prisma.staff.findUniqueOrThrow({ where: { id }, include: { room: true } });
}

// ─── After every change to a line ───────────────────────────────────────────

/**
 * Rule: send "Get ready" once when the ticket reaches the get-ready threshold (default 3 ahead).
 * A ticket that already started at or below the threshold got that information in its first SMS.
 */
export async function afterQueueChange(department: Pick<Department, 'id' | 'hospitalId'>) {
  const [line, hospital] = await Promise.all([waitingLine(department.id), hospitalOf(department.hospitalId)]);
  const candidates = line.slice(0, hospital.getReadyAhead + 1).filter((t) => t.phone);
  if (candidates.length) {
    const sent = await prisma.smsMessage.findMany({
      where: { ticketId: { in: candidates.map((t) => t.id) }, template: 'GET_READY' },
      select: { ticketId: true },
    });
    const already = new Set(sent.map((s) => s.ticketId));
    for (const t of candidates) {
      const ahead = line.indexOf(t);
      if (t.aheadAtJoin <= hospital.getReadyAhead) continue;
      if (!shouldSendGetReady(ahead, already.has(t.id), hospital.getReadyAhead)) continue;
      await sendTemplate({ hospitalId: t.hospitalId, ticket: t, template: 'GET_READY', vars: { number: t.number, ahead, dept: deptName(t.department, t.language) } });
    }
  }
  emit.queueUpdated(department.hospitalId, department.id);
}

// ─── Creating tickets ───────────────────────────────────────────────────────

interface NewTicket {
  department: Department;
  visitId: string;
  displayName: string;
  phone: string | null;
  language: Language;
  priority: Priority;
  priorityReason: PriorityReason;
  channel: 'WALK_IN' | 'NEXT_STEP';
  parentTicketId?: string | null;
  note?: string | null;
  actorId: string;
  auditAction: string;
}

async function createTicket(input: NewTicket): Promise<FullTicket> {
  if (!input.department.isOpen) throw new HttpError(409, `${input.department.nameEn} is closed`);
  const now = new Date();
  const created = await prisma.ticket.create({
    data: {
      hospitalId: input.department.hospitalId,
      departmentId: input.department.id,
      visitId: input.visitId,
      publicToken: randomToken(),
      number: await nextTicketNumber(input.department.id),
      displayName: input.displayName,
      phone: input.phone,
      language: input.language,
      priority: input.priority,
      priorityReason: input.priorityReason,
      channel: input.channel,
      status: 'CHECKED_IN',
      parentTicketId: input.parentTicketId ?? null,
      note: input.note ?? null,
      sortKey: now.getTime(),
      joinedAt: now,
      checkedInAt: now,
    },
  });
  const line = await waitingLine(input.department.id);
  const ahead = Math.max(0, line.findIndex((x) => x.id === created.id));
  const ticket = await prisma.ticket.update({ where: { id: created.id }, data: { aheadAtJoin: ahead }, include: ticketInclude });
  await audit({
    hospitalId: ticket.hospitalId,
    actorId: input.actorId,
    action: input.auditAction,
    ticketId: ticket.id,
    detail: { department: input.department.code, priority: input.priority, reason: input.priorityReason },
  });
  return ticket;
}

/** Reception registers a walk-in. The ticket is checked in straight away and can be called. */
export async function registerWalkIn(
  staff: Staff,
  input: {
    departmentId: string;
    displayName: string;
    phone: string | null;
    language: Language;
    priority: Priority;
    priorityReason: PriorityReason;
    note?: string | null;
  },
) {
  const department = await prisma.department.findFirst({ where: { id: input.departmentId, hospitalId: staff.hospitalId } });
  if (!department) throw notFound('Department not found');
  const visit = await prisma.visit.create({ data: { hospitalId: staff.hospitalId } });
  const ticket = await createTicket({ ...input, department, visitId: visit.id, channel: 'WALK_IN', actorId: staff.id, auditAction: 'REGISTERED' });

  const hospital = await hospitalOf(staff.hospitalId);
  const available = await servingStaffCount(department.id);
  const estimate = estimateWaitMinutes(ticket.aheadAtJoin, avgMinutesOf(department, hospital), available);
  await sendTemplate({
    hospitalId: ticket.hospitalId,
    ticket,
    template: 'JOINED',
    vars: { number: ticket.number, ahead: ticket.aheadAtJoin, wait: waitPhrase(ticket.language, estimate), link: patientUrl(ticket.publicToken) },
  });
  emitTicket(ticket);
  await afterQueueChange(department);
  return { ticket, peopleAhead: ticket.aheadAtJoin, estimateMinutes: estimate };
}

// ─── Serving: the staff member's current patient ────────────────────────────

/** The patient a staff member is serving now (called or in consultation). */
export async function currentTicketOf(staffId: string): Promise<FullTicket | null> {
  return prisma.ticket.findFirst({
    where: { staffId, status: { in: ['CALLED', 'IN_CONSULTATION'] } },
    orderBy: { calledAt: 'desc' },
    include: ticketInclude,
  });
}

async function mustCurrent(staff: Staff, allowed: Ticket['status'][] = ['CALLED', 'IN_CONSULTATION']) {
  const t = await currentTicketOf(staff.id);
  if (!t || !allowed.includes(t.status)) throw new HttpError(409, 'You have no patient in that state right now');
  return t;
}

/** Staff status follows the work: start -> In consultation, finish -> Available (only from those two). */
async function autoStatus(staff: Staff, to: 'AVAILABLE' | 'IN_CONSULTATION') {
  const fresh = await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } });
  const from = to === 'IN_CONSULTATION' ? 'AVAILABLE' : 'IN_CONSULTATION';
  if (fresh.status !== from) return;
  await prisma.staff.update({ where: { id: staff.id }, data: { status: to } });
  emit.staffStatus(staff.hospitalId, staff.id, to);
}

/** Puts the call on the TV and sends the "your turn" SMS. */
async function announceCall(t: FullTicket, staff: StaffWithRoom) {
  const room = staff.room?.name;
  if (!room) throw new HttpError(400, 'You have no room assigned. Ask an admin to assign one.');
  const at = new Date();
  await prisma.callLog.create({ data: { hospitalId: t.hospitalId, ticketNumber: t.number, room, staffName: staff.fullName, at } });
  emit.callNew(t.hospitalId, { ticketNumber: t.number, room, staffName: staff.fullName, at: at.toISOString() });
  await sendTemplate({ hospitalId: t.hospitalId, ticket: t, template: 'CALLED', vars: { number: t.number, room } });
}

/**
 * Rule: "Call next" picks the first checked-in ticket of the staff member's department whose
 * preferred staff is empty or this person. A patient still in consultation is finished first.
 */
export async function callNext(staff: Staff) {
  if (!staff.departmentId) throw new HttpError(400, 'You are not assigned to a department');
  const me = await staffWithRoom(staff.id);
  if (!me.room) throw new HttpError(400, 'You have no room assigned. Ask an admin to assign one.');
  const current = await currentTicketOf(staff.id);
  if (current?.status === 'CALLED') {
    throw new HttpError(409, `${current.number} is already called. Start, mark no-show or finish first.`);
  }
  if (current?.status === 'IN_CONSULTATION') await finishTicket(staff);

  // Two staff may click at the same moment: claim the ticket only if it is still CHECKED_IN.
  for (let attempt = 0; attempt < 3; attempt++) {
    const checkedIn = await prisma.ticket.findMany({ where: { departmentId: staff.departmentId, status: 'CHECKED_IN' } });
    const next = pickNextTicket(checkedIn, staff.id);
    if (!next) throw new HttpError(404, 'No one is waiting');
    const claimed = await prisma.ticket.updateMany({
      where: { id: next.id, status: 'CHECKED_IN' },
      data: { status: 'CALLED', staffId: staff.id, calledAt: new Date() },
    });
    if (claimed.count === 0) continue;
    const t = await loadTicket(next.id);
    await audit({ hospitalId: t.hospitalId, actorId: staff.id, action: 'CALLED', ticketId: t.id });
    await announceCall(t, me);
    emitTicket(t);
    await afterQueueChange(t.department);
    return t;
  }
  throw new HttpError(409, 'The queue changed, please try again');
}

export async function startTicket(staff: Staff) {
  const t = await mustCurrent(staff, ['CALLED']);
  const updated = await prisma.ticket.update({ where: { id: t.id }, data: { status: 'IN_CONSULTATION', startedAt: new Date() }, include: ticketInclude });
  await audit({ hospitalId: t.hospitalId, actorId: staff.id, action: 'STARTED', ticketId: t.id });
  await autoStatus(staff, 'IN_CONSULTATION');
  emitTicket(updated);
  await afterQueueChange(t.department);
  return updated;
}

/** Closes the visit when none of its tickets is active any more, and asks for feedback by SMS. */
async function closeVisitIfDone(t: Ticket, askFeedback: boolean) {
  const stillActive = await prisma.ticket.count({ where: { visitId: t.visitId, status: { in: [...ACTIVE] } } });
  if (stillActive > 0) return;
  const visit = await prisma.visit.update({ where: { id: t.visitId }, data: { finishedAt: new Date() } });
  if (!askFeedback || !t.phone || visit.feedbackRequestedAt) return;
  const hospital = await hospitalOf(t.hospitalId);
  if (!hospital.feedbackSmsEnabled) return;
  const sms = await sendTemplate({ hospitalId: t.hospitalId, ticket: t, template: 'FEEDBACK', vars: { number: t.number, hospital: hospital.name } });
  if (sms) await prisma.visit.update({ where: { id: visit.id }, data: { feedbackRequestedAt: new Date() } });
}

export async function finishTicket(staff: Staff) {
  const t = await mustCurrent(staff);
  const now = new Date();
  const updated = await prisma.ticket.update({
    where: { id: t.id },
    data: { status: 'DONE', startedAt: t.startedAt ?? now, finishedAt: now },
    include: ticketInclude,
  });
  await audit({ hospitalId: t.hospitalId, actorId: staff.id, action: 'FINISHED', ticketId: t.id });
  await autoStatus(staff, 'AVAILABLE');
  await closeVisitIfDone(updated, true);
  emitTicket(updated);
  await afterQueueChange(t.department);
  return updated;
}

/**
 * Rule (next step): the current ticket becomes REFERRED and a new ticket is created in the target
 * department in the same visit, same priority, already checked in, linked by parentTicketId.
 * The patient's page shows the new ticket; an SMS gives its link.
 */
export async function referCurrent(staff: Staff, targetDepartmentId: string, note?: string | null) {
  const t = await mustCurrent(staff);
  const target = await prisma.department.findFirst({ where: { id: targetDepartmentId, hospitalId: t.hospitalId } });
  if (!target) throw notFound('Department not found');
  if (target.id === t.departmentId) throw new HttpError(400, 'Choose another department');
  if (!target.isOpen) throw new HttpError(409, `${target.nameEn} is closed`);

  const now = new Date();
  const referred = await prisma.ticket.update({
    where: { id: t.id },
    data: { status: 'REFERRED', startedAt: t.startedAt ?? now, finishedAt: now },
    include: ticketInclude,
  });
  await audit({ hospitalId: t.hospitalId, actorId: staff.id, action: 'REFERRED', ticketId: t.id, reason: note ?? null, detail: { to: target.code } });

  const child = await createTicket({
    department: target,
    visitId: t.visitId,
    displayName: t.displayName,
    phone: t.phone,
    language: t.language,
    priority: t.priority,
    priorityReason: t.priorityReason,
    channel: 'NEXT_STEP',
    parentTicketId: t.id,
    note,
    actorId: staff.id,
    auditAction: 'NEXT_STEP_CREATED',
  });
  await sendTemplate({
    hospitalId: child.hospitalId,
    ticket: child,
    template: 'NEXT_STEP',
    vars: { number: child.number, dept: deptName(target, child.language), link: patientUrl(child.publicToken) },
  });
  await autoStatus(staff, 'AVAILABLE');
  emitTicket(referred);
  emitTicket(child);
  await afterQueueChange(t.department);
  await afterQueueChange(target);
  return child;
}

/**
 * Marks a called patient who did not come as NO_SHOW.
 * Rule: only after the grace period (Hospital.graceMinutes, default 10) since the call.
 */
export async function markNoShow(ticketId: string, staff: Staff, now = new Date()) {
  const t = await loadTicketFor(ticketId, staff);
  if (t.status !== 'CALLED' || !t.calledAt) throw new HttpError(409, 'Only a called ticket can be marked no-show');
  const hospital = await hospitalOf(t.hospitalId);
  if (!isPastGrace(t.calledAt, now, hospital.graceMinutes)) {
    throw new HttpError(409, `No-show is possible ${hospital.graceMinutes} minutes after the call`);
  }
  const updated = await prisma.ticket.update({ where: { id: t.id }, data: { status: 'NO_SHOW', finishedAt: now }, include: ticketInclude });
  await audit({ hospitalId: t.hospitalId, actorId: staff.id, action: 'NO_SHOW', ticketId: t.id });
  if (t.staffId) await autoStatus(await prisma.staff.findUniqueOrThrow({ where: { id: t.staffId } }), 'AVAILABLE');
  await closeVisitIfDone(updated, false);
  emitTicket(updated);
  await afterQueueChange(t.department);
  return updated;
}

/** Calls the same patient again: the TV chimes again and the SMS is repeated. */
export async function callAgain(ticketId: string, staff: Staff) {
  const t = await loadTicketFor(ticketId, staff);
  if (t.status !== 'CALLED' || !t.staffId) throw new HttpError(409, 'Only a called ticket can be called again');
  await audit({ hospitalId: t.hospitalId, actorId: staff.id, action: 'CALLED_AGAIN', ticketId: t.id });
  await announceCall(t, await staffWithRoom(t.staffId));
  return t;
}

// ─── Reception: cancel, priority and order ──────────────────────────────────

/** Rule: only WAITING or CHECKED_IN tickets can be cancelled. A reason is required. */
export async function cancelTicket(ticketId: string, staff: Staff, reason: string) {
  const t = await loadTicketFor(ticketId, staff);
  if (!canCancel(t.status)) throw new HttpError(409, `Ticket ${t.number} can no longer be cancelled`);
  const updated = await prisma.ticket.update({ where: { id: t.id }, data: { status: 'CANCELLED', finishedAt: new Date() }, include: ticketInclude });
  await audit({ hospitalId: t.hospitalId, actorId: staff.id, action: 'CANCELLED', ticketId: t.id, reason });
  await closeVisitIfDone(updated, false);
  emitTicket(updated);
  await afterQueueChange(t.department);
  return updated;
}

export async function setPriority(ticketId: string, staff: Staff, priority: Priority, priorityReason: PriorityReason, reason: string) {
  const t = await loadTicketFor(ticketId, staff);
  if (!['WAITING', 'CHECKED_IN'].includes(t.status)) throw new HttpError(409, 'Only waiting tickets can change priority');
  const updated = await prisma.ticket.update({ where: { id: t.id }, data: { priority, priorityReason }, include: ticketInclude });
  await audit({ hospitalId: t.hospitalId, actorId: staff.id, action: 'PRIORITY_CHANGED', ticketId: t.id, reason, detail: { from: t.priority, to: priority, priorityReason } });
  emitTicket(updated);
  await afterQueueChange(t.department);
  return updated;
}

/** Rule: reorder swaps sortKey with the neighbour of the same priority, and needs a reason. */
export async function reorder(ticketId: string, direction: 'UP' | 'DOWN', reason: string, staff: Staff) {
  const t = await loadTicketFor(ticketId, staff);
  const line = await waitingLine(t.departmentId);
  const index = line.findIndex((x) => x.id === t.id);
  if (index < 0) throw new HttpError(409, 'Only waiting tickets can be moved');
  const neighbour = line[direction === 'UP' ? index - 1 : index + 1];
  if (!neighbour || neighbour.priority !== t.priority) {
    throw new HttpError(409, `${t.number} is already ${direction === 'UP' ? 'first' : 'last'} in its priority group`);
  }
  await prisma.$transaction([
    prisma.ticket.update({ where: { id: t.id }, data: { sortKey: neighbour.sortKey } }),
    prisma.ticket.update({ where: { id: neighbour.id }, data: { sortKey: t.sortKey } }),
  ]);
  await audit({ hospitalId: t.hospitalId, actorId: staff.id, action: `MOVED_${direction}`, ticketId: t.id, reason, detail: { swappedWith: neighbour.number } });
  await afterQueueChange(t.department);
}

// ─── Staff status ───────────────────────────────────────────────────────────

/**
 * Sets a staff member's status (by themselves or by reception).
 * Rule: when a department goes from "someone serving" to "no one serving" (or back), every waiting
 * patient with a phone gets one SMS with the new estimate. Smaller changes do not send SMS:
 * the patient page always shows the live estimate.
 */
export async function setStaffStatus(target: Staff, status: StaffStatus, backAt: Date | null, actor: Staff) {
  const before = target.departmentId ? await servingStaffCount(target.departmentId) : 0;
  const updated = await prisma.staff.update({ where: { id: target.id }, data: { status, backAt: status === 'AVAILABLE' ? null : backAt } });
  await audit({
    hospitalId: target.hospitalId,
    actorId: actor.id,
    action: 'STAFF_STATUS',
    entityType: 'Staff',
    entityId: target.id,
    detail: { staff: target.fullName, from: target.status, to: status },
  });
  emit.staffStatus(updated.hospitalId, updated.id, status);
  if (!updated.departmentId || target.status === status) return updated;

  const department = await prisma.department.findUniqueOrThrow({ where: { id: updated.departmentId } });
  const after = await servingStaffCount(department.id);
  if ((before > 0) !== (after > 0) && isServingStatus(target.status) !== isServingStatus(status)) {
    const [line, hospital] = await Promise.all([waitingLine(department.id), hospitalOf(department.hospitalId)]);
    for (const [ahead, t] of line.entries()) {
      const est = estimateWaitMinutes(ahead, avgMinutesOf(department, hospital), after);
      await sendTemplate({ hospitalId: t.hospitalId, ticket: t, template: 'WAIT_CHANGED', vars: { number: t.number, wait: waitPhrase(t.language, est) } });
    }
  }
  await afterQueueChange(department);
  return updated;
}

// ─── Daily close ────────────────────────────────────────────────────────────

/**
 * At closing time: tickets still waiting or called are closed (status CLOSED) and patients with a
 * phone get the next opening time. Patients already in consultation are left alone.
 */
export async function closeDepartmentDay(department: Department, hospital: Hospital, now = new Date(), actorId: string | null = null) {
  const open = await prisma.ticket.findMany({
    where: { departmentId: department.id, status: { in: ['WAITING', 'CHECKED_IN', 'CALLED'] } },
    include: ticketInclude,
  });
  const opening = nextOpening(department.opensAt, now);
  for (const t of open) {
    const updated = await prisma.ticket.update({ where: { id: t.id }, data: { status: 'CLOSED', finishedAt: now } });
    await audit({ hospitalId: hospital.id, actorId, action: 'DAY_CLOSED', ticketId: t.id });
    const day = (t.language === 'EN' ? en : rw).days[opening.day];
    await sendTemplate({ hospitalId: hospital.id, ticket: t, template: 'DAY_CLOSED', vars: { number: t.number, dept: deptName(department, t.language), day, time: opening.time } });
    await closeVisitIfDone(updated, false);
    emitTicket(updated);
  }
  await prisma.department.update({ where: { id: department.id }, data: { lastClosedOn: kigaliDate(now) } });
  emit.queueUpdated(hospital.id, department.id);
  return open.length;
}
