// Hospital admin: role matrix, departments, rooms, staff invites, settings, SMS previews, audit, analytics.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PHONE_LIKE, api, as, calledMinutesAgo, describeDb, dept, prisma, reseed, walkIn } from './helpers';

const ADMIN_ROUTES: [method: 'get' | 'put' | 'post', path: string][] = [
  ['get', '/api/admin/settings'],
  ['put', '/api/admin/settings'],
  ['get', '/api/admin/departments'],
  ['post', '/api/admin/departments'],
  ['put', '/api/admin/departments/dept-opd'],
  ['get', '/api/admin/rooms'],
  ['post', '/api/admin/rooms'],
  ['get', '/api/admin/staff'],
  ['post', '/api/admin/staff'],
  ['put', '/api/admin/staff/staff-uwase'],
  ['post', '/api/admin/staff/staff-uwase/invite'],
  ['get', '/api/admin/sms/templates'],
  ['get', '/api/admin/sms'],
  ['get', '/api/admin/jobs'],
  ['post', '/api/admin/jobs/retention/run'],
  ['get', '/api/admin/audit'],
  ['get', '/api/admin/analytics'],
  ['get', '/api/admin/analytics.csv'],
];

const opdBody = {
  code: 'OPD',
  prefix: 'OPD',
  kind: 'CONSULTATION',
  nameEn: 'General consultation',
  nameRw: 'Isuzumwa rusange',
  avgMinutes: 12,
  isOpen: true,
  opensAt: '07:00',
  closesAt: '19:00',
  locationEn: 'Ground floor, Wing A',
  locationRw: 'Hasi, inyubako A',
  requirementsEn: 'Insurance card\nTransfer letter',
  requirementsRw: "Ikarita y'ubwishingizi\nUrupapuro rwa transfert",
  showOnTv: true,
  sortOrder: 0,
};

describeDb('admin API', () => {
  describe('access', () => {
    beforeAll(() => reseed());

    it('is for hospital admins only', async () => {
      for (const who of ['reception', 'uwase', 'lab'] as const) {
        const h = await as(who);
        for (const [method, path] of ADMIN_ROUTES) expect((await api[method](path).set(h).send({})).status, `${who} ${method} ${path}`).toBe(403);
      }
      for (const [method, path] of ADMIN_ROUTES) expect((await api[method](path).send({})).status, `anonymous ${path}`).toBe(401);
      const admin = await as('admin');
      expect((await api.get('/api/admin/settings').set(admin)).status).toBe(200);
    });
  });

  describe('departments and rooms', () => {
    beforeEach(() => reseed());

    it('creates and updates departments, with SMS-safe names', async () => {
      const admin = await as('admin');
      const created = await api.post('/api/admin/departments').set(admin).send({ ...opdBody, code: 'ENT', prefix: 'ENT', nameEn: 'Ear, nose and throat', nameRw: "Amatwi, izuru n'umuhogo" });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect((await api.post('/api/admin/departments').set(admin).send({ ...opdBody })).status).toBe(409); // OPD exists
      const tooLong = await api.post('/api/admin/departments').set(admin).send({ ...opdBody, code: 'XYZ', nameEn: 'A'.repeat(37) });
      expect(tooLong.status).toBe(400);
      expect(tooLong.body.error).toMatch(/SMS/);
      expect((await api.post('/api/admin/departments').set(admin).send({ ...opdBody, code: 'XYZ', nameRw: 'Ubuvuzi 😷' })).status).toBe(400);
      expect((await api.post('/api/admin/departments').set(admin).send({ ...opdBody, code: 'XYZ', opensAt: '19:00', closesAt: '07:00' })).status).toBe(400);
      // Smart apostrophes are turned into plain ones instead of being rejected.
      const curly = await api.post('/api/admin/departments').set(admin).send({ ...opdBody, code: 'DNT', nameRw: 'Ubuvuzi bw’amenyo' });
      expect(curly.body.nameRw).toBe("Ubuvuzi bw'amenyo");

      const updated = await api.put('/api/admin/departments/dept-opd').set(admin).send({ ...opdBody, isOpen: false, requirementsEn: 'Insurance card' });
      expect(updated.body).toMatchObject({ isOpen: false, requirementsEn: 'Insurance card' });
      const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'DEPARTMENT_UPDATED' } });
      expect(log.detail).toMatchObject({ code: 'OPD', changed: expect.arrayContaining(['isOpen', 'requirementsEn']) });
      // Closed now: reception cannot register.
      expect((await api.post('/api/walk-ins').set(await as('reception')).send({ departmentId: 'dept-opd', displayName: 'Aline' })).status).toBe(409);
    });

    it('shows "what to bring" on the patient page right after an edit', async () => {
      const reg = await walkIn({ displayName: 'Aline' });
      await api.put('/api/admin/departments/dept-opd').set(await as('admin')).send({ ...opdBody, requirementsEn: 'Insurance card\n\nTransfer letter\n' });
      const page = await api.get(`/api/public/tickets/${reg.ticket.publicToken}`);
      expect(page.body.department.requirementsEn).toEqual(['Insurance card', 'Transfer letter']);
    });

    it('manages rooms', async () => {
      const admin = await as('admin');
      const r = await api.post('/api/admin/rooms').set(admin).send({ name: 'Room 8', departmentId: 'dept-opd' });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ name: 'Room 8', departmentCode: 'OPD', active: true, staffNames: [] });
      expect((await api.post('/api/admin/rooms').set(admin).send({ name: 'Room 8', departmentId: null })).status).toBe(409);
      const list = await api.get('/api/admin/rooms').set(admin);
      expect(list.body.find((x: { name: string }) => x.name === 'Room 3').staffNames).toEqual(['Dr. Claudine Uwase']);
    });
  });

  describe('staff accounts', () => {
    beforeEach(() => reseed());

    it('invites a person who then sets a password and signs in', async () => {
      const admin = await as('admin');
      const res = await api.post('/api/admin/staff').set(admin).send({ fullName: 'Dr. Paul Nzeyimana', email: 'Paul@Masaka.demo', role: 'CLINICIAN', title: 'GP', departmentId: 'dept-opd', roomId: null });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.staff).toMatchObject({ email: 'paul@masaka.demo', invitePending: true, status: 'OFF_DUTY' });
      const token = res.body.inviteUrl.split('/').pop();
      expect(res.body.inviteUrl).toBe(`https://umurongo.test/staff/invite/${token}`);
      // Only a hash is stored.
      const row = await prisma.staff.findUniqueOrThrow({ where: { email: 'paul@masaka.demo' } });
      expect(row.inviteTokenHash).not.toContain(token);

      expect((await api.post('/api/auth/login').send({ email: 'paul@masaka.demo', password: 'anything12' })).status).toBe(401);
      expect((await api.get(`/api/auth/invite/${token}`)).body).toEqual({ fullName: 'Dr. Paul Nzeyimana', email: 'paul@masaka.demo', hospitalName: 'Masaka Hospital' });
      expect((await api.post(`/api/auth/invite/${token}`).send({ password: 'short' })).status).toBe(400);
      const accepted = await api.post(`/api/auth/invite/${token}`).send({ password: 'a-long-password' });
      expect(accepted.status).toBe(200);
      expect(accepted.body.staff.role).toBe('CLINICIAN');
      // The link works once.
      expect((await api.get(`/api/auth/invite/${token}`)).status).toBe(404);
      expect((await api.post('/api/auth/login').send({ email: 'paul@masaka.demo', password: 'a-long-password' })).status).toBe(200);
    });

    it('locks a deactivated account out at once, even with a valid token', async () => {
      const admin = await as('admin');
      const doctor = await as('habimana');
      expect((await api.get('/api/me/queue').set(doctor)).status).toBe(200);
      const s = await prisma.staff.findUniqueOrThrow({ where: { id: 'staff-habimana' } });
      const res = await api.put('/api/admin/staff/staff-habimana').set(admin).send({ fullName: s.fullName, email: s.email, role: s.role, title: s.title, departmentId: s.departmentId, roomId: s.roomId, active: false });
      expect(res.body).toMatchObject({ active: false, status: 'OFF_DUTY' });
      expect((await api.get('/api/me/queue').set(doctor)).status).toBe(401);
      expect((await api.post('/api/auth/login').send({ email: s.email, password: 'demo1234' })).status).toBe(401);
      expect(await prisma.auditLog.count({ where: { action: 'STAFF_DEACTIVATED', entityId: 'staff-habimana' } })).toBe(1);
    });

    it('keeps at least one admin and checks departments for clinicians', async () => {
      const admin = await as('admin');
      const me = await prisma.staff.findUniqueOrThrow({ where: { id: 'staff-admin' } });
      const selfDemote = await api.put('/api/admin/staff/staff-admin').set(admin).send({ fullName: me.fullName, email: me.email, role: 'RECEPTIONIST', title: '', departmentId: null, roomId: null });
      expect(selfDemote.status).toBe(400);
      const noDept = await api.post('/api/admin/staff').set(admin).send({ fullName: 'Lab Two', email: 'lab2@masaka.demo', role: 'COUNTER', departmentId: null, roomId: null });
      expect(noDept.body.error).toMatch(/need a department/);
    });

    it('renews an invite link to reset a password', async () => {
      const res = await api.post('/api/admin/staff/staff-uwase/invite').set(await as('admin'));
      expect(res.body.expiresInDays).toBe(7);
      const token = res.body.inviteUrl.split('/').pop();
      await api.post(`/api/auth/invite/${token}`).send({ password: 'new-password-1' });
      expect((await api.post('/api/auth/login').send({ email: 'claudine@masaka.demo', password: 'new-password-1' })).status).toBe(200);
    });
  });

  describe('settings', () => {
    beforeEach(() => reseed());

    it('changes the grace period used for no-show', async () => {
      const admin = await as('admin');
      const current = (await api.get('/api/admin/settings').set(admin)).body;
      const res = await api.put('/api/admin/settings').set(admin).send({ ...current, id: undefined, graceMinutes: 3 });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const doctor = await as('uwase');
      await api.post('/api/me/call-next').set(doctor);
      expect((await api.get('/api/me/queue').set(doctor)).body.graceMinutes).toBe(3);
      const called = await prisma.ticket.findFirstOrThrow({ where: { status: 'CALLED' } });
      await calledMinutesAgo(called.id, 3);
      expect((await api.post('/api/me/no-show').set(doctor)).status).toBe(200);
      expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'SETTINGS_UPDATED' } })).detail).toEqual({ graceMinutes: 3 });
    });

    it('validates the sender ID and limits', async () => {
      const admin = await as('admin');
      const current = (await api.get('/api/admin/settings').set(admin)).body;
      expect((await api.put('/api/admin/settings').set(admin).send({ ...current, smsSenderId: 'TOO-LONG-SENDER' })).status).toBe(400);
      expect((await api.put('/api/admin/settings').set(admin).send({ ...current, graceMinutes: 0 })).status).toBe(400);
    });
  });

  describe('SMS previews, outbox, audit', () => {
    beforeAll(() => reseed());

    it('previews every template in both languages within one SMS', async () => {
      const res = await api.get('/api/admin/sms/templates').set(await as('admin'));
      expect(res.body.templates).toHaveLength(14);
      for (const t of res.body.templates) {
        expect(t.fits, `${t.template} ${t.language}: ${t.text}`).toBe(true);
        expect(t.worstLength).toBeLessThanOrEqual(160);
      }
      expect(res.body.templates.find((t: { template: string; language: string }) => t.template === 'CALLED' && t.language === 'EN').text).toBe(
        'Umurongo: It is your turn! OPD-024, please go to Room 3 now.',
      );
    });

    it('lists the outbox with masked numbers', async () => {
      await walkIn({ displayName: 'Aline', phone: '0788123456' });
      const res = await api.get('/api/admin/sms').set(await as('admin'));
      expect(res.body.find((m: { template: string }) => m.template === 'JOINED')).toMatchObject({ to: '+250 78* *** 456', status: 'SIMULATED' });
      expect(JSON.stringify(res.body.map((m: { to: string }) => m.to))).not.toMatch(PHONE_LIKE);
    });

    it('shows the audit log with who, what and why', async () => {
      const h = await as('reception');
      const t = await prisma.ticket.findFirstOrThrow({ where: { number: 'OPD-023' } });
      await api.post(`/api/tickets/${t.id}/cancel`).set(h).send({ reason: 'Went to another hospital' });
      const res = await api.get('/api/admin/audit?ticket=OPD-023').set(await as('admin'));
      expect(res.body[0]).toMatchObject({ action: 'CANCELLED', actorName: 'Josiane Mutoni', ticketNumber: 'OPD-023', reason: 'Went to another hospital' });
    });
  });

  describe('analytics', () => {
    beforeAll(() => reseed(5));

    it('computes waits per stage, per hour, no-shows and feedback', async () => {
      const res = await api.get('/api/admin/analytics').set(await as('admin'));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const a = res.body;
      expect(a.totals.tickets).toBeGreaterThan(100);
      expect(a.trend).toHaveLength(30);
      expect(a.trend.filter((d: { tickets: number }) => d.tickets > 0).length).toBeGreaterThanOrEqual(5);
      expect(a.perHour).toHaveLength(24);
      expect(a.perHour.slice(7, 11).reduce((n: number, h: { count: number }) => n + h.count, 0)).toBeGreaterThan(a.perHour.slice(13, 17).reduce((n: number, h: { count: number }) => n + h.count, 0));
      const opdWait = a.stages.find((s: { stage: string; departmentCode: string }) => s.stage === 'WAIT' && s.departmentCode === 'OPD');
      expect(opdWait.medianMinutes).toBeGreaterThan(5);
      expect(opdWait.p90Minutes).toBeGreaterThanOrEqual(opdWait.medianMinutes);
      expect(a.totals.noShowRate).toBeGreaterThan(0);
      expect(a.totals.noShowRate).toBeLessThan(0.15);
      expect(a.feedback.score).toBeGreaterThan(0.5);
      expect(a.feedback.yes + a.feedback.no).toBeLessThanOrEqual(a.feedback.asked);
    });

    it('filters by department and validates the range', async () => {
      const admin = await as('admin');
      const lab = await dept('LAB');
      const res = await api.get(`/api/admin/analytics?departmentId=${lab.id}`).set(admin);
      expect(new Set(res.body.stages.map((s: { departmentCode: string }) => s.departmentCode))).toEqual(new Set(['LAB']));
      expect((await api.get('/api/admin/analytics?from=2026-01-01&to=2026-12-31').set(admin)).status).toBe(400);
      expect((await api.get('/api/admin/analytics?from=2026-11-10&to=2026-11-01').set(admin)).status).toBe(400);
    });

    it('exports CSV without names or phone numbers', async () => {
      const reg = await walkIn({ displayName: 'Zawadi', phone: '0788123456' });
      const res = await api.get('/api/admin/analytics.csv').set(await as('admin'));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="umurongo-tickets-/);
      const text = res.text.replace(/^﻿/, '');
      const [header, ...rows] = text.trim().split('\r\n');
      expect(header).toBe('"date","ticket","department","priority","channel","status","joined_at","called_at","started_at","finished_at","wait_minutes","service_minutes"');
      expect(rows.length).toBeGreaterThan(100);
      expect(text).toContain(`"${reg.ticket.number}"`);
      expect(text).not.toContain('Zawadi');
      expect(text).not.toMatch(PHONE_LIKE);
    });
  });
});
