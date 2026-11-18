// Turns database rows into the API shapes in packages/shared/src/types.ts.
// Privacy: toQueueEntry never includes the phone; only toReceptionEntry does.
import type { Department, Hospital, Prisma, Staff } from '@prisma/client';
import {
  ACTIVE_TICKET_STATUSES,
  SERVING_ROLES,
  buildJourney,
  estimateWaitMinutes,
  queueProgress,
  sortQueue,
  type DepartmentSummary,
  type PublicTicketView,
  type QueueEntry,
  type ReceptionEntry,
  type StaffMe,
  type StaffPublic,
  type TvView,
} from '@umurongo/shared';
import { prisma } from '../db';
import { notFound } from '../http';

export const ticketInclude = {
  department: true,
  staff: { include: { room: true } },
  parentTicket: { select: { number: true } },
} satisfies Prisma.TicketInclude;

export type FullTicket = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** Statuses that count as "serving the queue" (see isServingStatus in packages/shared). */
export const SERVING_STATUSES = ['AVAILABLE', 'IN_CONSULTATION'] as const;

export async function servingStaffCount(departmentId: string) {
  return prisma.staff.count({ where: { departmentId, active: true, role: { in: SERVING_ROLES }, status: { in: [...SERVING_STATUSES] } } });
}

export async function onDutyStaffCount(departmentId: string) {
  return prisma.staff.count({ where: { departmentId, active: true, role: { in: SERVING_ROLES }, status: { not: 'OFF_DUTY' } } });
}

export const avgMinutesOf = (d: Pick<Department, 'avgMinutes'>, h: Pick<Hospital, 'defaultConsultMinutes'>) =>
  d.avgMinutes ?? h.defaultConsultMinutes;

export async function hospitalOf(id: string) {
  const h = await prisma.hospital.findUnique({ where: { id } });
  if (!h) throw notFound('Hospital not found');
  return h;
}

/** The waiting line of a department in call order (EMERGENCY, PRIORITY, then join order). */
export async function waitingLine(departmentId: string) {
  const tickets = await prisma.ticket.findMany({
    where: { departmentId, status: { in: ['WAITING', 'CHECKED_IN'] } },
    include: ticketInclude,
  });
  return sortQueue(tickets);
}

/** A ticket as clinicians, counters and the queue board see it. No phone number. */
export function toQueueEntry(t: FullTicket): QueueEntry {
  return {
    id: t.id,
    number: t.number,
    status: t.status,
    priority: t.priority,
    priorityReason: t.priorityReason,
    channel: t.channel,
    displayName: t.displayName,
    language: t.language,
    departmentId: t.departmentId,
    departmentCode: t.department.code,
    note: t.note,
    sortKey: t.sortKey,
    joinedAt: t.joinedAt.toISOString(),
    calledAt: iso(t.calledAt),
    startedAt: iso(t.startedAt),
    staffId: t.staffId,
    staffName: t.staff?.fullName ?? null,
    roomName: t.staff?.room?.name ?? null,
    fromNumber: t.parentTicket?.number ?? null,
  };
}

/** Reception only: adds the phone number and the patient link token. */
export function toReceptionEntry(t: FullTicket): ReceptionEntry {
  return { ...toQueueEntry(t), phone: t.phone, publicToken: t.publicToken };
}

type StaffWithRefs = Staff & { department?: Department | null; room?: { name: string } | null };

export function toStaffPublic(s: StaffWithRefs, currentTicketNumber: string | null = null): StaffPublic {
  return {
    id: s.id,
    fullName: s.fullName,
    title: s.title,
    role: s.role,
    status: s.status,
    backAt: iso(s.backAt),
    departmentId: s.departmentId,
    departmentCode: s.department?.code ?? null,
    departmentNameEn: s.department?.nameEn ?? null,
    roomName: s.room?.name ?? null,
    currentTicketNumber,
  };
}

/** Staff of a hospital (or one department) with the ticket each one is serving now. */
export async function listStaff(where: Prisma.StaffWhereInput): Promise<StaffPublic[]> {
  const staff = await prisma.staff.findMany({
    where: { active: true, ...where },
    include: { department: true, room: true },
    orderBy: [{ department: { sortOrder: 'asc' } }, { fullName: 'asc' }],
  });
  const serving = await prisma.ticket.findMany({
    where: { staffId: { in: staff.map((s) => s.id) }, status: { in: ['CALLED', 'IN_CONSULTATION'] } },
    select: { staffId: true, number: true },
  });
  const current = new Map(serving.map((t) => [t.staffId, t.number]));
  return staff.map((s) => toStaffPublic(s, current.get(s.id) ?? null));
}

export async function staffMe(staffId: string): Promise<StaffMe> {
  const s = await prisma.staff.findUniqueOrThrow({ where: { id: staffId }, include: { department: true, room: true, hospital: true } });
  const current = await prisma.ticket.findFirst({ where: { staffId, status: { in: ['CALLED', 'IN_CONSULTATION'] } }, select: { number: true } });
  return { ...toStaffPublic(s, current?.number ?? null), email: s.email, hospital: { id: s.hospital.id, name: s.hospital.name } };
}

/** Every department with live numbers: waiting count, serving staff, estimate, now serving. */
export async function departmentSummaries(hospitalId: string): Promise<DepartmentSummary[]> {
  const [hospital, depts, counts, serving, nowServing] = await Promise.all([
    hospitalOf(hospitalId),
    prisma.department.findMany({ where: { hospitalId }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
    prisma.ticket.groupBy({
      by: ['departmentId', 'status'],
      where: { hospitalId, status: { in: ACTIVE_TICKET_STATUSES } },
      _count: { _all: true },
    }),
    prisma.staff.groupBy({
      by: ['departmentId'],
      where: { hospitalId, active: true, role: { in: SERVING_ROLES }, status: { in: [...SERVING_STATUSES] } },
      _count: { _all: true },
    }),
    prisma.ticket.findMany({
      where: { hospitalId, status: { in: ['CALLED', 'IN_CONSULTATION'] } },
      orderBy: { calledAt: 'desc' },
      select: { departmentId: true, number: true },
    }),
  ]);
  const count = (deptId: string, statuses: string[]) =>
    counts.filter((c) => c.departmentId === deptId && statuses.includes(c.status)).reduce((n, c) => n + c._count._all, 0);

  return depts.map((d) => {
    const waitingCount = count(d.id, ['WAITING', 'CHECKED_IN']);
    const availableStaff = serving.find((a) => a.departmentId === d.id)?._count._all ?? 0;
    const avg = avgMinutesOf(d, hospital);
    return {
      id: d.id,
      code: d.code,
      kind: d.kind,
      nameEn: d.nameEn,
      nameRw: d.nameRw,
      prefix: d.prefix,
      avgMinutes: avg,
      isOpen: d.isOpen,
      opensAt: d.opensAt,
      closesAt: d.closesAt,
      locationEn: d.locationEn,
      locationRw: d.locationRw,
      waitingCount,
      servingCount: count(d.id, ['CALLED', 'IN_CONSULTATION']),
      availableStaff,
      estimateMinutes: d.isOpen ? estimateWaitMinutes(waitingCount, avg, availableStaff) : null,
      nowServing: nowServing.find((s) => s.departmentId === d.id)?.number ?? null,
    };
  });
}

/** Position and estimate of one waiting ticket. */
export async function positionOf(t: { id: string; departmentId: string; department: Department; hospitalId: string }) {
  const [line, hospital, available] = await Promise.all([waitingLine(t.departmentId), hospitalOf(t.hospitalId), servingStaffCount(t.departmentId)]);
  const index = line.findIndex((x) => x.id === t.id);
  const ahead = index < 0 ? 0 : index;
  return {
    inLine: index >= 0,
    ahead,
    estimate: index < 0 ? null : estimateWaitMinutes(ahead, avgMinutesOf(t.department, hospital), available),
    available,
  };
}

/** The patient's live ticket, looked up by link token. No phone number, no other patients' names. */
export async function buildPublicTicketView(token: string): Promise<PublicTicketView> {
  const t = await prisma.ticket.findUnique({
    where: { publicToken: token },
    include: {
      ...ticketInclude,
      hospital: true,
      childTickets: { orderBy: { joinedAt: 'desc' }, take: 1, include: { department: true } },
      visit: { include: { tickets: { include: { department: true }, orderBy: { joinedAt: 'asc' } } } },
    },
  });
  if (!t) throw notFound('Ticket not found');

  const [pos, onDuty] = await Promise.all([positionOf(t), onDutyStaffCount(t.departmentId)]);
  const next = t.status === 'REFERRED' ? t.childTickets[0] : undefined;

  return {
    token: t.publicToken,
    number: t.number,
    status: t.status,
    displayName: t.displayName,
    language: t.language,
    hospital: { id: t.hospital.id, name: t.hospital.name },
    department: {
      id: t.department.id,
      code: t.department.code,
      kind: t.department.kind,
      nameEn: t.department.nameEn,
      nameRw: t.department.nameRw,
      locationEn: t.department.locationEn,
      locationRw: t.department.locationRw,
      requirementsEn: lines(t.department.requirementsEn),
      requirementsRw: lines(t.department.requirementsRw),
    },
    peopleAhead: pos.ahead,
    estimateMinutes: pos.estimate,
    progress: ['CALLED', 'IN_CONSULTATION', 'DONE', 'REFERRED'].includes(t.status) ? 1 : queueProgress(pos.ahead, t.aheadAtJoin),
    staff: { available: pos.available, onDuty },
    room: t.staff?.room?.name ?? null,
    staffName: t.staff?.fullName ?? null,
    calledAt: iso(t.calledAt),
    nextTicket: next
      ? {
          token: next.publicToken,
          number: next.number,
          nameEn: next.department.nameEn,
          nameRw: next.department.nameRw,
          locationEn: next.department.locationEn,
          locationRw: next.department.locationRw,
        }
      : null,
    journey: buildJourney(
      t.visit.tickets.map((x) => ({ number: x.number, kind: x.department.kind, nameEn: x.department.nameEn, nameRw: x.department.nameRw, status: x.status, joinedAt: x.joinedAt })),
      !!t.visit.finishedAt,
    ),
    smsEnabled: !!t.phone,
    visitFinishedAt: iso(t.visit.finishedAt),
    serverTime: new Date().toISOString(),
  };
}

/** Waiting-room TV: ticket numbers, rooms and staff names only. */
export async function buildTvView(hospitalId: string): Promise<TvView> {
  const hospital = await hospitalOf(hospitalId);
  const [calls, departments, staff] = await Promise.all([
    prisma.callLog.findMany({ where: { hospitalId }, orderBy: { at: 'desc' }, take: 6 }),
    prisma.department.findMany({ where: { hospitalId, showOnTv: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
    listStaff({ hospitalId, role: { in: SERVING_ROLES }, status: { not: 'OFF_DUTY' } }),
  ]);
  const boards = await Promise.all(
    departments.map(async (d) => {
      const [line, serving] = await Promise.all([
        waitingLine(d.id),
        prisma.ticket.findFirst({ where: { departmentId: d.id, status: { in: ['CALLED', 'IN_CONSULTATION'] } }, orderBy: { calledAt: 'desc' }, select: { number: true } }),
      ]);
      return { code: d.code, nameEn: d.nameEn, nameRw: d.nameRw, nowServing: serving?.number ?? null, next: line.slice(0, 4).map((t) => t.number), waitingCount: line.length };
    }),
  );
  return {
    hospital: { id: hospital.id, name: hospital.name },
    calls: calls.map((c) => ({ ticketNumber: c.ticketNumber, room: c.room, staffName: c.staffName, at: c.at.toISOString() })),
    departments: boards,
    staff: staff.map((s) => ({ id: s.id, fullName: s.fullName, status: s.status, roomName: s.roomName, departmentCode: s.departmentCode })),
    serverTime: new Date().toISOString(),
  };
}
