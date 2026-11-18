import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { CallView, StaffStatus, TicketStatus } from '@umurongo/shared';
import { corsOrigins } from './env';
import { verifyToken } from './auth';

// Socket.IO only tells clients *that* something changed; clients then refetch with REST.
// Events never carry names or phone numbers.
//
// Rooms:
//   hospital:<id>    staff of that hospital only (needs a staff token for the same hospital)
//   department:<id>  public: "the line moved" (patient pages of that department)
//   tv:<hospitalId>  public: calls and staff status for the waiting-room TV
//   ticket:<token>   public: one patient's ticket, joined with the secret link token
let io: Server | null = null;

const PUBLIC_ROOM = /^(department|tv):[\w-]{1,64}$/;
const TICKET_ROOM = /^ticket:[A-Za-z0-9_-]{22}$/;
const HOSPITAL_ROOM = /^hospital:([\w-]{1,64})$/;

/** Decides whether a socket may join a room. Exported for tests. */
export function canJoin(room: string, staffHospitalId: string | null): boolean {
  if (PUBLIC_ROOM.test(room) || TICKET_ROOM.test(room)) return true;
  const m = HOSPITAL_ROOM.exec(room);
  return !!m && staffHospitalId === m[1];
}

function onConnection(socket: Socket) {
  const claims = verifyToken(socket.handshake.auth?.token as string | undefined);
  socket.on('join', (rooms: unknown) => {
    if (!Array.isArray(rooms)) return;
    for (const room of rooms.slice(0, 20)) {
      if (typeof room === 'string' && canJoin(room, claims?.hospitalId ?? null)) socket.join(room);
    }
  });
  socket.on('leave', (rooms: unknown) => {
    if (Array.isArray(rooms)) rooms.forEach((r) => typeof r === 'string' && socket.leave(r));
  });
}

export function attachRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: corsOrigins }, pingInterval: 20_000, pingTimeout: 15_000 });
  io.on('connection', onConnection);
  return io;
}

export const emit = {
  queueUpdated(hospitalId: string, departmentId: string) {
    io?.to([`department:${departmentId}`, `hospital:${hospitalId}`, `tv:${hospitalId}`]).emit('queue:update', { departmentId });
  },
  ticketUpdated(t: { id: string; publicToken: string; status: TicketStatus; hospitalId: string }) {
    io?.to(`ticket:${t.publicToken}`).emit('ticket:update', { status: t.status });
    io?.to(`hospital:${t.hospitalId}`).emit('ticket:update', { id: t.id, status: t.status });
  },
  staffStatus(hospitalId: string, staffId: string, status: StaffStatus) {
    io?.to([`hospital:${hospitalId}`, `tv:${hospitalId}`]).emit('staff:status', { staffId, status });
  },
  callNew(hospitalId: string, call: CallView) {
    io?.to([`hospital:${hospitalId}`, `tv:${hospitalId}`]).emit('call:new', call);
  },
  smsChanged(hospitalId: string) {
    io?.to(`hospital:${hospitalId}`).emit('sms:changed', {});
  },
  configChanged(hospitalId: string) {
    io?.to([`hospital:${hospitalId}`, `tv:${hospitalId}`]).emit('config:changed', {});
  },
  /** After /dev/reset: every client refetches everything. */
  reset() {
    io?.emit('demo:reset', {});
  },
};
