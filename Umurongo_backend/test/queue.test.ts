// Queue API: the full patient journey, privacy, roles, validation and the queue rules.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PHONE_LIKE, api, as, calledMinutesAgo, describeDb, dept, prisma, reseed, walkIn } from './helpers';

describeDb('queue API', () => {
  describe('full journey: reception -> OPD -> LAB -> cashier -> pharmacy -> done', () => {
    beforeAll(() => reseed());

    it('runs end to end and keeps the patient page and TV in step', async () => {
      // Reception registers Aline with a phone number.
      const reg = await walkIn({ displayName: 'Aline', phone: '0788 123 456', language: 'RW' });
      expect(reg.ticket.number).toBe('OPD-024');
      expect(reg.ticket.phone).toBe('+250788123456');
      expect(reg.peopleAhead).toBe(4);
      expect(reg.estimateMinutes).toBe(28); // (4 + 0.6) * 12 / 2 doctors serving
      expect(reg.patientUrl).toBe(`https://umurongo.test/t/${reg.ticket.publicToken}`);
      const joined = await prisma.smsMessage.findFirstOrThrow({ where: { ticketId: reg.ticket.id, template: 'JOINED' } });
      expect(joined.status).toBe('SIMULATED');
      expect(joined.body).toContain('OPD-024');
      expect(joined.body).toContain(reg.patientUrl);
      expect(joined.body.length).toBeLessThanOrEqual(160);

      // The patient page: position, estimate, what to bring, journey. No phone number.
      const token = reg.ticket.publicToken;
      const page = await api.get(`/api/public/tickets/${token}`);
      expect(page.status).toBe(200);
      expect(page.body).toMatchObject({ number: 'OPD-024', status: 'CHECKED_IN', peopleAhead: 4, estimateMinutes: 28, progress: 0, smsEnabled: true });
      expect(page.body.department.requirementsRw.length).toBeGreaterThan(2);
      expect(page.body.journey.map((s: { state: string }) => s.state)).toEqual(['done', 'current', 'upcoming', 'upcoming']);
      expect(JSON.stringify(page.body)).not.toMatch(PHONE_LIKE);

      // Dr. Uwase calls next until OPD-024: the elderly priority patient first, then join order.
      const doctor = await as('uwase');
      const order: string[] = [];
      for (let i = 0; i < 6 && !order.includes('OPD-024'); i++) {
        const res = await api.post('/api/me/call-next').set(doctor);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        order.push(res.body.called.number);
        if (res.body.called.number !== 'OPD-024') expect((await api.post('/api/me/start').set(doctor)).status).toBe(200);
      }
      expect(order).toEqual(['OPD-022', 'OPD-020', 'OPD-021', 'OPD-023', 'OPD-024']);

      const called = await api.get(`/api/public/tickets/${token}`);
      expect(called.body).toMatchObject({ status: 'CALLED', room: 'Room 3', staffName: 'Dr. Claudine Uwase', progress: 1 });
      const sms = await prisma.smsMessage.findFirstOrThrow({ where: { ticketId: reg.ticket.id, template: 'CALLED' } });
      expect(sms.body).toBe('Umurongo: Igihe cyawe kirageze! OPD-024, jya kuri Room 3 ubu.');

      // The TV shows the call with ticket number and room only.
      const tv = await api.get('/api/public/tv/masaka');
      expect(tv.body.calls[0]).toMatchObject({ ticketNumber: 'OPD-024', room: 'Room 3' });
      expect(JSON.stringify(tv.body)).not.toMatch(PHONE_LIKE);
      expect(JSON.stringify(tv.body)).not.toContain('Aline');

      // Start: the doctor's status follows the work.
      expect((await api.post('/api/me/start').set(doctor)).status).toBe(200);
      expect((await prisma.staff.findUniqueOrThrow({ where: { id: 'staff-uwase' } })).status).toBe('IN_CONSULTATION');

      // Refer to the laboratory.
      const lab = await dept('LAB');
      const refer = await api.post('/api/me/refer').set(doctor).send({ departmentId: lab.id, note: 'Malaria test' });
      expect(refer.status, JSON.stringify(refer.body)).toBe(200);
      expect(refer.body.referredTo.number).toBe('LAB-004');
      expect(refer.body.referredTo.fromNumber).toBe('OPD-024');
      const referred = await api.get(`/api/public/tickets/${token}`);
      expect(referred.body.status).toBe('REFERRED');
      expect(referred.body.nextTicket).toMatchObject({ number: 'LAB-004', nameEn: 'Laboratory' });
      const labToken = referred.body.nextTicket.token;
      const nextSms = await prisma.smsMessage.findFirstOrThrow({ where: { template: 'NEXT_STEP', ticket: { publicToken: labToken } } });
      expect(nextSms.body).toContain(`/t/${labToken}`);

      // Lab, cashier and pharmacy each serve whoever is ahead, then our patient.
      async function serveUntil(who: 'lab' | 'cashier' | 'pharmacy', number: string) {
        const h = await as(who);
        for (let i = 0; i < 6; i++) {
          const res = await api.post('/api/me/call-next').set(h);
          expect(res.status, JSON.stringify(res.body)).toBe(200);
          if (res.body.called.number === number) return h;
          await api.post('/api/me/start').set(h);
        }
        throw new Error(`${number} was never called`);
      }
      const labStaff = await serveUntil('lab', 'LAB-004');
      const csh = await dept('CSH');
      const toCashier = await api.post('/api/me/refer').set(labStaff).send({ departmentId: csh.id });
      const cashierNumber = toCashier.body.referredTo.number;
      const cashier = await serveUntil('cashier', cashierNumber);
      const pha = await dept('PHA');
      const toPharmacy = await api.post('/api/me/refer').set(cashier).send({ departmentId: pha.id });
      const pharmacyNumber = toPharmacy.body.referredTo.number;
      const pharmacist = await serveUntil('pharmacy', pharmacyNumber);
      expect((await api.post('/api/me/finish').set(pharmacist)).status).toBe(200);

      // Done: the visit is closed and the journey ends on Done.
      const last = await prisma.ticket.findFirstOrThrow({ where: { number: pharmacyNumber, status: 'DONE' } });
      const done = await api.get(`/api/public/tickets/${last.publicToken}`);
      expect(done.body.status).toBe('DONE');
      expect(done.body.visitFinishedAt).not.toBeNull();
      expect(done.body.journey.map((s: { state: string }) => s.state)).toEqual(['done', 'done', 'done', 'current']);
      expect(done.body.journey[2].tickets.map((t: { number: string }) => t.number)).toEqual(['LAB-004', cashierNumber, pharmacyNumber]);

      // A feedback SMS was sent and the visit remembers it asked.
      const visit = await prisma.visit.findUniqueOrThrow({ where: { id: last.visitId } });
      expect(visit.feedbackRequestedAt).not.toBeNull();
      const feedback = await prisma.smsMessage.findFirstOrThrow({ where: { ticketId: last.id, template: 'FEEDBACK' } });
      expect(feedback.body).toContain('Subiza 1 = yego, 2 = oya');

      // Every step is in the audit log.
      const actions = (await prisma.auditLog.findMany({ where: { ticket: { visitId: last.visitId } }, select: { action: true } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['REGISTERED', 'CALLED', 'STARTED', 'REFERRED', 'NEXT_STEP_CREATED', 'FINISHED']));
    });
  });

  describe('privacy', () => {
    beforeAll(() => reseed());

    it('never sends phone numbers to clinicians, counters, the TV or the patient page', async () => {
      const reg = await walkIn({ displayName: 'Pacifique', phone: '0788777666' });
      const opd = await dept('OPD');

      const reception = await api.get(`/api/queues/${opd.id}`).set(await as('reception'));
      expect(JSON.stringify(reception.body)).toContain('+250788777666');

      for (const who of ['uwase', 'lab'] as const) {
        const h = await as(who);
        for (const path of ['/api/me/queue', `/api/queues/${opd.id}`, '/api/staff', '/api/departments']) {
          const res = await api.get(path).set(h);
          expect(res.status, `${who} ${path}`).toBe(200);
          expect(JSON.stringify(res.body), `${who} ${path}`).not.toMatch(PHONE_LIKE);
        }
      }
      const called = await api.post('/api/me/call-next').set(await as('uwase'));
      expect(JSON.stringify(called.body)).not.toMatch(PHONE_LIKE);

      expect(JSON.stringify((await api.get(`/api/public/tickets/${reg.ticket.publicToken}`)).body)).not.toMatch(PHONE_LIKE);
      expect(JSON.stringify((await api.get('/api/public/tv/masaka')).body)).not.toMatch(PHONE_LIKE);
    });

    it('keeps the patient link unguessable and validated', async () => {
      expect((await api.get('/api/public/tickets/not-a-token')).status).toBe(400);
      expect((await api.get('/api/public/tickets/AAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
      const t = await prisma.ticket.findFirstOrThrow({ where: { number: 'OPD-020' } });
      expect(t.publicToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
      // The ticket id is not a way in.
      expect((await api.get(`/api/public/tickets/${t.id}`)).status).toBe(400);
    });
  });

  describe('roles', () => {
    beforeAll(() => reseed());

    it('needs a sign-in for every staff route', async () => {
      for (const [method, path] of [
        ['get', '/api/me/queue'],
        ['post', '/api/walk-ins'],
        ['get', '/api/departments'],
        ['get', '/api/staff/me'],
        ['get', '/api/admin/settings'],
        ['get', '/api/dev/sms'],
      ] as const) {
        expect((await api[method](path)).status, path).toBe(401);
      }
      expect((await api.get('/api/me/queue').set({ Authorization: 'Bearer nonsense' })).status).toBe(401);
    });

    it('checks the role on every action', async () => {
      const opd = await dept('OPD');
      const clinician = await as('uwase');
      const reception = await as('reception');
      const counter = await as('lab');
      expect((await api.post('/api/walk-ins').set(clinician).send({ departmentId: opd.id, displayName: 'Aline' })).status).toBe(403);
      expect((await api.get('/api/search?q=OPD').set(clinician)).status).toBe(403);
      expect((await api.post('/api/me/call-next').set(reception)).status).toBe(403);
      expect((await api.get('/api/admin/settings').set(counter)).status).toBe(403);
      expect((await api.get('/api/admin/analytics').set(reception)).status).toBe(403);
      expect((await api.post('/api/dev/reset').set(reception)).status).toBe(403);
      // Staff can set their own status, only reception can set someone else's.
      expect((await api.patch('/api/staff/staff-habimana/status').set(clinician).send({ status: 'AWAY' })).status).toBe(403);
      expect((await api.patch('/api/staff/staff-uwase/status').set(clinician).send({ status: 'ON_BREAK' })).status).toBe(200);
      expect((await api.patch('/api/staff/staff-habimana/status').set(reception).send({ status: 'AWAY' })).status).toBe(200);
    });

    it('rate-limits sign-in attempts', async () => {
      const { setRateLimitEnabled } = await import('../src/rate-limit');
      setRateLimitEnabled(true);
      try {
        const codes: number[] = [];
        for (let i = 0; i < 7; i++) codes.push((await api.post('/api/auth/login').send({ email: 'nobody@masaka.demo', password: 'wrong' })).status);
        expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
        expect(codes.at(-1)).toBe(429);
      } finally {
        setRateLimitEnabled(false);
      }
    });
  });

  describe('registration rules', () => {
    beforeEach(() => reseed());

    it('accepts first names or initials only, and Rwandan mobile numbers', async () => {
      const opd = await dept('OPD');
      const h = await as('reception');
      const full = await api.post('/api/walk-ins').set(h).send({ departmentId: opd.id, displayName: 'Aline Uwimana' });
      expect(full.status).toBe(400);
      expect(full.body.error).toMatch(/first name or initials/);
      expect((await api.post('/api/walk-ins').set(h).send({ departmentId: opd.id, displayName: 'A. U.' })).status).toBe(201);
      const badPhone = await api.post('/api/walk-ins').set(h).send({ departmentId: opd.id, displayName: 'Aline', phone: '12345' });
      expect(badPhone.status).toBe(400);
      expect(badPhone.body.error).toMatch(/Rwandan mobile/);
      const noPhone = await walkIn({ displayName: 'Bosco' });
      expect(noPhone.ticket.phone).toBeNull();
      expect(await prisma.smsMessage.count({ where: { ticketId: noPhone.ticket.id } })).toBe(0);
    });

    it('requires a reason for Priority and puts emergencies first', async () => {
      const opd = await dept('OPD');
      const h = await as('reception');
      expect((await api.post('/api/walk-ins').set(h).send({ departmentId: opd.id, displayName: 'Eric', priority: 'PRIORITY' })).status).toBe(400);
      expect((await api.post('/api/walk-ins').set(h).send({ departmentId: opd.id, displayName: 'Eric', priority: 'EMERGENCY', priorityReason: 'ELDERLY' })).status).toBe(400);
      const pregnant = await walkIn({ displayName: 'Uwase', priority: 'PRIORITY', priorityReason: 'PREGNANT' });
      expect(pregnant.peopleAhead).toBe(1); // behind the elderly priority patient who came first
      const emergency = await walkIn({ displayName: 'Kalisa', priority: 'EMERGENCY' });
      expect(emergency.peopleAhead).toBe(0);
    });

    it('refuses a closed department', async () => {
      const den = await dept('DEN');
      const res = await api.post('/api/walk-ins').set(await as('reception')).send({ departmentId: den.id, displayName: 'Aline' });
      expect(res.status).toBe(409);
    });
  });

  describe('queue board actions', () => {
    beforeAll(() => reseed());

    it('reorders only with a reason, within a priority band, and audits it', async () => {
      const h = await as('reception');
      const t21 = await prisma.ticket.findFirstOrThrow({ where: { number: 'OPD-021' } });
      expect((await api.post(`/api/tickets/${t21.id}/reorder`).set(h).send({ direction: 'UP' })).status).toBe(400);
      expect((await api.post(`/api/tickets/${t21.id}/reorder`).set(h).send({ direction: 'UP', reason: 'ok' })).status).toBe(400);
      const moved = await api.post(`/api/tickets/${t21.id}/reorder`).set(h).send({ direction: 'UP', reason: 'Very weak, needs to sit' });
      expect(moved.status).toBe(200);
      const opd = await dept('OPD');
      const board = await api.get(`/api/queues/${opd.id}`).set(h);
      expect(board.body.waiting.map((t: { number: string }) => t.number)).toEqual(['OPD-022', 'OPD-021', 'OPD-020', 'OPD-023']);
      // OPD-021 cannot jump over the priority patient.
      const again = await api.post(`/api/tickets/${t21.id}/reorder`).set(h).send({ direction: 'UP', reason: 'Very weak, needs to sit' });
      expect(again.status).toBe(409);
      const log = await prisma.auditLog.findFirstOrThrow({ where: { ticketId: t21.id, action: 'MOVED_UP' } });
      expect(log.reason).toBe('Very weak, needs to sit');
      expect(log.actorId).toBe('staff-mutoni');
    });

    it('finds tickets by number or phone', async () => {
      const h = await as('reception');
      expect((await api.get('/api/search?q=021').set(h)).body.map((t: { number: string }) => t.number)).toEqual(['OPD-021']);
      const byPhone = await api.get('/api/search?q=0788 100 020').set(h);
      expect(byPhone.body.map((t: { number: string }) => t.number)).toEqual(['OPD-020']);
    });

    it('cancels with a reason only', async () => {
      const h = await as('reception');
      const t = await prisma.ticket.findFirstOrThrow({ where: { number: 'OPD-023' } });
      expect((await api.post(`/api/tickets/${t.id}/cancel`).set(h).send({})).status).toBe(400);
      const res = await api.post(`/api/tickets/${t.id}/cancel`).set(h).send({ reason: 'Patient went home' });
      expect(res.body.status).toBe('CANCELLED');
      expect((await api.post(`/api/tickets/${t.id}/cancel`).set(h).send({ reason: 'Patient went home' })).status).toBe(409);
    });
  });

  describe('calling', () => {
    beforeEach(() => reseed());

    it('allows no-show only after the grace period', async () => {
      const doctor = await as('uwase');
      await api.post('/api/me/call-next').set(doctor); // finishes OPD-018, calls OPD-022
      const current = await prisma.ticket.findFirstOrThrow({ where: { number: 'OPD-022' } });
      expect(current.status).toBe('CALLED');
      const early = await api.post('/api/me/no-show').set(doctor);
      expect(early.status).toBe(409);
      expect(early.body.error).toMatch(/10 minutes/);
      // Reception is held to the same rule.
      expect((await api.post(`/api/tickets/${current.id}/no-show`).set(await as('reception'))).status).toBe(409);

      await calledMinutesAgo(current.id, 10);
      const res = await api.post('/api/me/no-show').set(doctor);
      expect(res.status).toBe(200);
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: current.id } })).status).toBe('NO_SHOW');
      expect(res.body.current).toBeNull();
    });

    it('never gives the same patient to two doctors calling at once', async () => {
      const [a, b] = await Promise.all([api.post('/api/me/call-next').set(await as('uwase')), api.post('/api/me/call-next').set(await as('habimana'))]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.body.called.number).not.toBe(b.body.called.number);
      expect([a.body.called.number, b.body.called.number].sort()).toEqual(['OPD-020', 'OPD-022']);
    });

    it('needs a called patient before starting, and finishing before the next call', async () => {
      const doctor = await as('uwase');
      await api.post('/api/me/finish').set(doctor); // OPD-018 done
      expect((await api.post('/api/me/start').set(doctor)).status).toBe(409);
      await api.post('/api/me/call-next').set(doctor);
      const second = await api.post('/api/me/call-next').set(doctor);
      expect(second.status).toBe(409);
      expect(second.body.error).toMatch(/already called/);
    });

    it("counts today's patients for the doctor", async () => {
      const doctor = await as('uwase');
      const before = (await api.get('/api/me/queue').set(doctor)).body.todayCount;
      await api.post('/api/me/finish').set(doctor);
      expect((await api.get('/api/me/queue').set(doctor)).body.todayCount).toBe(before + 1);
    });
  });

  describe('staff status', () => {
    beforeAll(() => reseed());

    it('tells waiting patients by SMS only when no one is left to serve them', async () => {
      const h = await as('reception');
      const waitChanged = () => prisma.smsMessage.count({ where: { template: 'WAIT_CHANGED' } });
      await api.patch('/api/staff/staff-habimana/status').set(h).send({ status: 'ON_BREAK' });
      expect(await waitChanged()).toBe(0); // Dr. Uwase is still serving
      const opd = await dept('OPD');
      expect((await api.get('/api/departments').set(h)).body.find((d: { id: string }) => d.id === opd.id).availableStaff).toBe(1);

      await api.patch('/api/staff/staff-uwase/status').set(h).send({ status: 'AWAY' });
      // OPD-020, 022 and 023 have phones.
      expect(await waitChanged()).toBe(3);
      const sms = await prisma.smsMessage.findFirstOrThrow({ where: { template: 'WAIT_CHANGED' } });
      expect(sms.body).toContain('nta muganga uhari ubu');
      const t = await prisma.ticket.findFirstOrThrow({ where: { number: 'OPD-020' } });
      const page = await api.get(`/api/public/tickets/${t.publicToken}`);
      expect(page.body.estimateMinutes).toBeNull();
      expect(page.body.staff).toEqual({ available: 0, onDuty: 3 });

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'STAFF_STATUS', entityId: 'staff-uwase' } });
      expect(audit.detail).toMatchObject({ from: 'IN_CONSULTATION', to: 'AWAY' });
    });
  });
});
