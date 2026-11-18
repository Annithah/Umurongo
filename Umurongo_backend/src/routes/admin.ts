// Hospital admin: settings, departments, rooms, staff accounts, SMS previews, jobs, audit, analytics.
import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  LANGUAGES,
  SMS_TEMPLATES,
  maskPhone,
  renderSms,
  waitPhrase,
  en,
  rw,
  type AuditEntry,
  type DepartmentAdmin,
  type HospitalSettings,
  type JobRunView,
  type RoomView,
  type SmsView,
  type StaffAdminView,
} from '@umurongo/shared';
import { prisma } from '../db';
import { env, patientUrl } from '../env';
import { mustStaff, requireStaff } from '../auth';
import { h, HttpError, notFound } from '../http';
import { emit } from '../realtime';
import { audit } from '../services/audit';
import { analyticsCsv, buildAnalytics, parseRange } from '../services/analytics';
import { toStaffPublic } from '../services/views';
import { JOBS, runJob, type JobName } from '../jobs/jobs';
import { withJobLock } from '../jobs/scheduler';
import { hashToken, randomToken } from '../tokens';
import { departmentBody, id, idParam, roomBody, settingsBody, staffBody } from './schemas';

export const adminRoutes = Router();
const ADMIN = requireStaff('HOSPITAL_ADMIN');
adminRoutes.use('/admin', ADMIN);

const INVITE_DAYS = 7;

/** Prisma unique-constraint errors become a readable 409. */
function conflict(e: unknown, what: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new HttpError(409, `${what} already exists`);
  throw e;
}

// ─── Settings ───────────────────────────────────────────────────────────────

function toSettings(h: Prisma.HospitalGetPayload<object>): HospitalSettings & { retentionDays: number } {
  return {
    id: h.id,
    name: h.name,
    district: h.district,
    smsSenderId: h.smsSenderId,
    feedbackSmsEnabled: h.feedbackSmsEnabled,
    defaultConsultMinutes: h.defaultConsultMinutes,
    getReadyAhead: h.getReadyAhead,
    graceMinutes: h.graceMinutes,
    retentionDays: h.retentionDays,
  };
}

adminRoutes.get(
  '/admin/settings',
  h(async (_req, res) => res.json(toSettings(await prisma.hospital.findUniqueOrThrow({ where: { id: mustStaff(res).hospitalId } })))),
);

adminRoutes.put(
  '/admin/settings',
  h(async (req, res) => {
    const staff = mustStaff(res);
    const data = settingsBody.parse(req.body);
    const before = await prisma.hospital.findUniqueOrThrow({ where: { id: staff.hospitalId } });
    const updated = await prisma.hospital.update({ where: { id: staff.hospitalId }, data });
    const changed = Object.fromEntries(Object.entries(data).filter(([k, v]) => before[k as keyof typeof before] !== v));
    await audit({ hospitalId: staff.hospitalId, actorId: staff.id, action: 'SETTINGS_UPDATED', entityType: 'Hospital', entityId: staff.hospitalId, detail: changed });
    emit.configChanged(staff.hospitalId);
    res.json(toSettings(updated));
  }),
);

// ─── Departments ────────────────────────────────────────────────────────────

const toDepartmentAdmin = (d: Prisma.DepartmentGetPayload<object>): DepartmentAdmin => ({
  id: d.id,
  code: d.code,
  kind: d.kind,
  nameEn: d.nameEn,
  nameRw: d.nameRw,
  prefix: d.prefix,
  avgMinutes: d.avgMinutes,
  isOpen: d.isOpen,
  opensAt: d.opensAt,
  closesAt: d.closesAt,
  locationEn: d.locationEn,
  locationRw: d.locationRw,
  requirementsEn: d.requirementsEn,
  requirementsRw: d.requirementsRw,
  showOnTv: d.showOnTv,
  sortOrder: d.sortOrder,
});

adminRoutes.get(
  '/admin/departments',
  h(async (_req, res) => {
    const list = await prisma.department.findMany({ where: { hospitalId: mustStaff(res).hospitalId }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
    res.json(list.map(toDepartmentAdmin));
  }),
);

adminRoutes.post(
  '/admin/departments',
  h(async (req, res) => {
    const staff = mustStaff(res);
    const data = departmentBody.parse(req.body);
    const d = await prisma.department.create({ data: { ...data, hospitalId: staff.hospitalId } }).catch((e) => conflict(e, `Department ${data.code}`));
    await audit({ hospitalId: staff.hospitalId, actorId: staff.id, action: 'DEPARTMENT_CREATED', entityType: 'Department', entityId: d.id, detail: { code: d.code } });
    emit.configChanged(staff.hospitalId);
    res.status(201).json(toDepartmentAdmin(d));
  }),
);

adminRoutes.put(
  '/admin/departments/:id',
  h(async (req, res) => {
    const staff = mustStaff(res);
    const { id: deptId } = idParam.parse(req.params);
    const before = await prisma.department.findFirst({ where: { id: deptId, hospitalId: staff.hospitalId } });
    if (!before) throw notFound('Department not found');
    const data = departmentBody.parse(req.body);
    const d = await prisma.department.update({ where: { id: deptId }, data }).catch((e) => conflict(e, `Department ${data.code}`));
    const changed = Object.keys(data).filter((k) => before[k as keyof typeof before] !== data[k as keyof typeof data]);
    await audit({ hospitalId: staff.hospitalId, actorId: staff.id, action: 'DEPARTMENT_UPDATED', entityType: 'Department', entityId: d.id, detail: { code: d.code, changed } });
    emit.configChanged(staff.hospitalId);
    emit.queueUpdated(staff.hospitalId, d.id);
    res.json(toDepartmentAdmin(d));
  }),
);

// ─── Rooms ──────────────────────────────────────────────────────────────────

async function listRooms(hospitalId: string): Promise<RoomView[]> {
  const rooms = await prisma.room.findMany({
    where: { hospitalId },
    include: { department: true, staff: { where: { active: true }, select: { fullName: true } } },
    orderBy: [{ department: { sortOrder: 'asc' } }, { name: 'asc' }],
  });
  return rooms.map((r) => ({ id: r.id, name: r.name, departmentId: r.departmentId, departmentCode: r.department?.code ?? null, active: r.active, staffNames: r.staff.map((s) => s.fullName) }));
}

async function checkDepartment(hospitalId: string, departmentId: string | null) {
  if (departmentId && !(await prisma.department.findFirst({ where: { id: departmentId, hospitalId } }))) throw new HttpError(400, 'Unknown department');
}

adminRoutes.get('/admin/rooms', h(async (_req, res) => res.json(await listRooms(mustStaff(res).hospitalId))));

adminRoutes.post(
  '/admin/rooms',
  h(async (req, res) => {
    const staff = mustStaff(res);
    const data = roomBody.parse(req.body);
    await checkDepartment(staff.hospitalId, data.departmentId);
    const r = await prisma.room.create({ data: { ...data, hospitalId: staff.hospitalId } }).catch((e) => conflict(e, `Room "${data.name}"`));
    await audit({ hospitalId: staff.hospitalId, actorId: staff.id, action: 'ROOM_CREATED', entityType: 'Room', entityId: r.id, detail: { name: r.name } });
    res.status(201).json((await listRooms(staff.hospitalId)).find((x) => x.id === r.id));
  }),
);

adminRoutes.put(
  '/admin/rooms/:id',
  h(async (req, res) => {
    const staff = mustStaff(res);
    const { id: roomId } = idParam.parse(req.params);
    if (!(await prisma.room.findFirst({ where: { id: roomId, hospitalId: staff.hospitalId } }))) throw notFound('Room not found');
    const data = roomBody.parse(req.body);
    await checkDepartment(staff.hospitalId, data.departmentId);
    const r = await prisma.room.update({ where: { id: roomId }, data }).catch((e) => conflict(e, `Room "${data.name}"`));
    await audit({ hospitalId: staff.hospitalId, actorId: staff.id, action: 'ROOM_UPDATED', entityType: 'Room', entityId: r.id, detail: { name: r.name, active: r.active } });
    emit.configChanged(staff.hospitalId);
    res.json((await listRooms(staff.hospitalId)).find((x) => x.id === r.id));
  }),
);

// ─── Staff accounts ─────────────────────────────────────────────────────────

async function listStaffAdmin(hospitalId: string): Promise<StaffAdminView[]> {
  const staff = await prisma.staff.findMany({ where: { hospitalId }, include: { department: true, room: true }, orderBy: [{ active: 'desc' }, { fullName: 'asc' }] });
  return staff.map((s) => ({
    ...toStaffPublic(s),
    email: s.email,
    active: s.active,
    roomId: s.roomId,
    invitePending: !s.passwordHash,
    lastLoginAt: s.lastLoginAt?.toISOString() ?? null,
  }));
}

async function checkStaffRefs(hospitalId: string, data: z.infer<typeof staffBody>) {
  await checkDepartment(hospitalId, data.departmentId);
  if (data.roomId && !(await prisma.room.findFirst({ where: { id: data.roomId, hospitalId } }))) throw new HttpError(400, 'Unknown room');
  if ((data.role === 'CLINICIAN' || data.role === 'COUNTER') && !data.departmentId) {
    throw new HttpError(400, 'Clinicians and counter staff need a department');
  }
}

/** Creates a one-time invite link (valid 7 days). Only the hash is stored. */
async function newInvite(staffId: string) {
  const token = randomToken();
  await prisma.staff.update({
    where: { id: staffId },
    data: { inviteTokenHash: hashToken(token), inviteExpiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) },
  });
  return { inviteUrl: `${env.PUBLIC_WEB_URL.replace(/\/$/, '')}/staff/invite/${token}`, expiresInDays: INVITE_DAYS };
}

adminRoutes.get('/admin/staff', h(async (_req, res) => res.json(await listStaffAdmin(mustStaff(res).hospitalId))));

adminRoutes.post(
  '/admin/staff',
  h(async (req, res) => {
    const admin = mustStaff(res);
    const data = staffBody.parse(req.body);
    await checkStaffRefs(admin.hospitalId, data);
    const s = await prisma.staff.create({ data: { ...data, hospitalId: admin.hospitalId, status: 'OFF_DUTY' } }).catch((e) => conflict(e, `An account for ${data.email}`));
    const invite = await newInvite(s.id);
    await audit({ hospitalId: admin.hospitalId, actorId: admin.id, action: 'STAFF_INVITED', entityType: 'Staff', entityId: s.id, detail: { email: s.email, role: s.role } });
    res.status(201).json({ staff: (await listStaffAdmin(admin.hospitalId)).find((x) => x.id === s.id), ...invite });
  }),
);

adminRoutes.put(
  '/admin/staff/:id',
  h(async (req, res) => {
    const admin = mustStaff(res);
    const { id: staffId } = idParam.parse(req.params);
    const before = await prisma.staff.findFirst({ where: { id: staffId, hospitalId: admin.hospitalId } });
    if (!before) throw notFound('Staff member not found');
    const data = staffBody.parse(req.body);
    await checkStaffRefs(admin.hospitalId, data);
    const losesAdmin = before.role === 'HOSPITAL_ADMIN' && (data.role !== 'HOSPITAL_ADMIN' || !data.active);
    if (losesAdmin) {
      if (staffId === admin.id) throw new HttpError(400, 'You cannot remove your own admin access');
      const admins = await prisma.staff.count({ where: { hospitalId: admin.hospitalId, role: 'HOSPITAL_ADMIN', active: true } });
      if (admins <= 1) throw new HttpError(400, 'Keep at least one active admin');
    }
    const s = await prisma.staff
      .update({
        where: { id: staffId },
        // A deactivated account is taken off duty and can no longer sign in (checked on every request).
        data: { ...data, ...(data.active ? {} : { status: 'OFF_DUTY', inviteTokenHash: null, inviteExpiresAt: null }) },
      })
      .catch((e) => conflict(e, `An account for ${data.email}`));
    const changed = Object.keys(data).filter((k) => before[k as keyof typeof before] !== data[k as keyof typeof data]);
    await audit({
      hospitalId: admin.hospitalId,
      actorId: admin.id,
      action: before.active && !s.active ? 'STAFF_DEACTIVATED' : 'STAFF_UPDATED',
      entityType: 'Staff',
      entityId: s.id,
      detail: { email: s.email, changed },
    });
    if (before.status !== s.status) emit.staffStatus(admin.hospitalId, s.id, s.status);
    emit.configChanged(admin.hospitalId);
    res.json((await listStaffAdmin(admin.hospitalId)).find((x) => x.id === s.id));
  }),
);

/** New invite link: for someone who lost theirs, or to reset a forgotten password. */
adminRoutes.post(
  '/admin/staff/:id/invite',
  h(async (req, res) => {
    const admin = mustStaff(res);
    const { id: staffId } = idParam.parse(req.params);
    const s = await prisma.staff.findFirst({ where: { id: staffId, hospitalId: admin.hospitalId, active: true } });
    if (!s) throw notFound('Active staff member not found');
    const invite = await newInvite(s.id);
    await audit({ hospitalId: admin.hospitalId, actorId: admin.id, action: 'STAFF_INVITE_RENEWED', entityType: 'Staff', entityId: s.id, detail: { email: s.email } });
    res.json(invite);
  }),
);

// ─── SMS templates preview and outbox ───────────────────────────────────────

adminRoutes.get(
  '/admin/sms/templates',
  h(async (_req, res) => {
    const hospitalId = mustStaff(res).hospitalId;
    const [hospital, departments, rooms] = await Promise.all([
      prisma.hospital.findUniqueOrThrow({ where: { id: hospitalId } }),
      prisma.department.findMany({ where: { hospitalId } }),
      prisma.room.findMany({ where: { hospitalId, active: true }, orderBy: { name: 'asc' } }),
    ]);
    const longest = <T,>(xs: T[], f: (x: T) => string, fallback: string) => xs.map(f).sort((a, b) => b.length - a.length)[0] ?? fallback;
    const opd = departments.sort((a, b) => a.sortOrder - b.sortOrder).find((d) => d.kind === 'CONSULTATION') ?? departments[0];
    const sampleRoom = rooms.find((r) => r.departmentId === opd?.id) ?? rooms[0];
    const sampleLink = patientUrl('k3J9xQ2mZp7Lr0aW5bYc1d');
    const out = SMS_TEMPLATES.flatMap((template) =>
      LANGUAGES.map((language) => {
        const dict = language === 'EN' ? en : rw;
        const vars = {
          number: `${opd?.prefix ?? 'OPD'}-024`,
          ahead: 4,
          wait: waitPhrase(language, 25),
          room: sampleRoom?.name ?? 'Room 3',
          dept: language === 'EN' ? (opd?.nameEn ?? 'OPD') : (opd?.nameRw ?? 'OPD'),
          link: sampleLink,
          hospital: hospital.name,
          day: dict.days.tomorrow,
          time: opd?.opensAt ?? '07:00',
        };
        // Worst case with this hospital's longest names, so admins see if any combination is too long.
        const worst = renderSms(template, language, {
          ...vars,
          ahead: 999,
          wait: [waitPhrase(language, 999), waitPhrase(language, null)].sort((a, b) => b.length - a.length)[0],
          room: longest(rooms, (r) => r.name, vars.room),
          dept: longest(departments, (d) => (language === 'EN' ? d.nameEn : d.nameRw), vars.dept),
        });
        const sample = renderSms(template, language, vars);
        return { template, language, text: sample.text, length: sample.length, worstLength: worst.length, fits: worst.fits };
      }),
    );
    res.json({ senderId: hospital.smsSenderId, mode: env.SMS_MODE, templates: out });
  }),
);

adminRoutes.get(
  '/admin/sms',
  h(async (_req, res) => {
    const list = await prisma.smsMessage.findMany({
      where: { hospitalId: mustStaff(res).hospitalId },
      include: { ticket: { select: { number: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const body: SmsView[] = list.map((m) => ({
      id: m.id,
      at: m.createdAt.toISOString(),
      to: maskPhone(m.to),
      template: m.template,
      language: m.language,
      body: m.body,
      status: m.status,
      attempts: m.attempts,
      error: m.error,
      ticketNumber: m.ticket?.number ?? null,
    }));
    res.json(body);
  }),
);

// ─── Jobs ───────────────────────────────────────────────────────────────────

adminRoutes.get(
  '/admin/jobs',
  h(async (_req, res) => {
    const runs = await prisma.jobRun.findMany({ orderBy: { startedAt: 'desc' }, take: 50 });
    const body: JobRunView[] = runs.map((r) => ({
      id: r.id,
      job: r.job,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      ok: r.ok,
      summary: r.error ?? (r.summary ? JSON.stringify(r.summary) : null),
    }));
    res.json(body);
  }),
);

adminRoutes.post(
  '/admin/jobs/:name/run',
  h(async (req, res) => {
    const staff = mustStaff(res);
    const { name } = z.object({ name: z.enum(Object.keys(JOBS) as [JobName, ...JobName[]]) }).parse(req.params);
    const result = await withJobLock(name, () => runJob(name, () => JOBS[name]()));
    if (result === null) throw new HttpError(409, 'This job is running right now');
    await audit({ hospitalId: staff.hospitalId, actorId: staff.id, action: 'JOB_RUN_MANUAL', entityType: 'Job', entityId: name });
    res.json(result);
  }),
);

// ─── Audit log ──────────────────────────────────────────────────────────────

function describe(detail: Prisma.JsonValue | null): string | null {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;
  return Object.entries(detail)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

adminRoutes.get(
  '/admin/audit',
  h(async (req, res) => {
    const q = z
      .object({ before: z.string().datetime().optional(), action: z.string().max(40).optional(), ticket: z.string().max(12).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) })
      .parse(req.query);
    const rows = await prisma.auditLog.findMany({
      where: {
        hospitalId: mustStaff(res).hospitalId,
        ...(q.before ? { at: { lt: new Date(q.before) } } : {}),
        ...(q.action ? { action: q.action } : {}),
        ...(q.ticket ? { ticket: { number: { contains: q.ticket.toUpperCase() } } } : {}),
      },
      include: { actor: { select: { fullName: true } }, ticket: { select: { number: true } } },
      orderBy: { at: 'desc' },
      take: q.limit,
    });
    const body: AuditEntry[] = rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      action: r.action,
      actorName: r.actor?.fullName ?? (r.actorId ? null : 'System'),
      ticketNumber: r.ticket?.number ?? null,
      reason: r.reason,
      detail: describe(r.detail),
    }));
    res.json(body);
  }),
);

// ─── Analytics ──────────────────────────────────────────────────────────────

const rangeQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  departmentId: id.optional(),
});

adminRoutes.get(
  '/admin/analytics',
  h(async (req, res) => {
    const q = rangeQuery.parse(req.query);
    res.json(await buildAnalytics(mustStaff(res).hospitalId, parseRange(q.from, q.to), q.departmentId));
  }),
);

adminRoutes.get(
  '/admin/analytics.csv',
  h(async (req, res) => {
    const q = rangeQuery.parse(req.query);
    const range = parseRange(q.from, q.to);
    const csv = await analyticsCsv(mustStaff(res).hospitalId, range, q.departmentId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="umurongo-tickets-${range.start}-to-${range.end}.csv"`);
    res.send('﻿' + csv); // BOM so Excel opens it as UTF-8
  }),
);
