// Socket.IO: who may join which room, and that events reach the right screens.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { io as connect, type Socket } from 'socket.io-client';
import { createApp } from '../src/app';
import { attachRealtime, canJoin } from '../src/realtime';
import { signStaff } from '../src/auth';
import { as, describeDb, prisma, reseed } from './helpers';
import request from 'supertest';

describe('room rules', () => {
  const token = 'k3J9xQ2mZp7Lr0aW5bYc1d';
  it('lets anyone follow a ticket, a department line or a TV', () => {
    expect(canJoin(`ticket:${token}`, null)).toBe(true);
    expect(canJoin('department:dept-opd', null)).toBe(true);
    expect(canJoin('tv:masaka', null)).toBe(true);
  });

  it('keeps the staff room for staff of that hospital', () => {
    expect(canJoin('hospital:masaka', null)).toBe(false);
    expect(canJoin('hospital:masaka', 'other-hospital')).toBe(false);
    expect(canJoin('hospital:masaka', 'masaka')).toBe(true);
  });

  it('rejects malformed rooms', () => {
    expect(canJoin('ticket:short', null)).toBe(false);
    expect(canJoin('patient:123', null)).toBe(false);
    expect(canJoin('tv:../../etc', null)).toBe(false);
  });
});

describeDb('live events', () => {
  const httpServer = createServer(createApp());
  attachRealtime(httpServer);
  let url = '';
  const sockets: Socket[] = [];

  beforeAll(async () => {
    await reseed();
    await new Promise<void>((r) => httpServer.listen(0, r));
    url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    sockets.forEach((s) => s.close());
    httpServer.close();
  });

  function client(rooms: string[], token?: string) {
    const s = connect(url, { auth: { token }, transports: ['websocket'], forceNew: true });
    sockets.push(s);
    return new Promise<Socket>((resolve) => s.on('connect', () => {
      s.emit('join', rooms);
      setTimeout(() => resolve(s), 100);
    }));
  }
  const next = <T,>(s: Socket, event: string) => new Promise<T>((r) => s.once(event, r));
  /** The first event that matches, e.g. the update for one ticket (call next also finishes the previous patient). */
  const until = <T,>(s: Socket, event: string, match: (p: T) => boolean) =>
    new Promise<T>((r) => {
      const fn = (p: T) => {
        if (!match(p)) return;
        s.off(event, fn);
        r(p);
      };
      s.on(event, fn);
    });

  it('sends call:new to the TV and ticket:update to the patient, without personal data', async () => {
    const t = await prisma.ticket.findFirstOrThrow({ where: { number: 'OPD-022' } });
    const tv = await client(['tv:masaka']);
    const patient = await client([`ticket:${t.publicToken}`, `department:${t.departmentId}`]);
    const anonymousStaffRoom = await client(['hospital:masaka']);
    const reception = await client(['hospital:masaka'], signStaff({ id: 'staff-mutoni', role: 'RECEPTIONIST', hospitalId: 'masaka' }));

    let leaked = false;
    anonymousStaffRoom.on('ticket:update', () => (leaked = true));
    const call = next<{ ticketNumber: string; room: string }>(tv, 'call:new');
    const mine = until<{ status: string }>(patient, 'ticket:update', (p) => p.status === 'CALLED');
    const line = next<{ departmentId: string }>(patient, 'queue:update');
    const staffSide = until<{ id: string; status: string }>(reception, 'ticket:update', (p) => p.id === t.id);

    // Use a separate HTTP client on the same server so the sockets and the request share one process.
    const res = await request(httpServer).post('/api/me/call-next').set(await as('uwase'));
    expect(res.status).toBe(200);

    expect(await call).toMatchObject({ ticketNumber: 'OPD-022', room: 'Room 3' });
    expect(await mine).toEqual({ status: 'CALLED' });
    expect(await line).toEqual({ departmentId: t.departmentId });
    expect(await staffSide).toEqual({ id: t.id, status: 'CALLED' });
    await new Promise((r) => setTimeout(r, 100));
    expect(leaked).toBe(false);
  });

  it('sends staff:status to the TV when a doctor goes on break', async () => {
    const tv = await client(['tv:masaka']);
    const event = next<{ staffId: string; status: string }>(tv, 'staff:status');
    await request(httpServer).patch('/api/staff/staff-habimana/status').set(await as('reception')).send({ status: 'ON_BREAK' });
    expect(await event).toEqual({ staffId: 'staff-habimana', status: 'ON_BREAK' });
  });
});
