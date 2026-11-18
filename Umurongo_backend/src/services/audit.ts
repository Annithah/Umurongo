import type { Prisma } from '@prisma/client';
import { prisma } from '../db';

/** Writes one audit-log row. Every queue action, status change and admin change goes through here. */
export async function audit(input: {
  hospitalId: string;
  actorId?: string | null;
  action: string;
  ticketId?: string | null;
  entityType?: string;
  entityId?: string;
  reason?: string | null;
  detail?: Prisma.InputJsonValue;
}) {
  await prisma.auditLog.create({
    data: {
      hospitalId: input.hospitalId,
      actorId: input.actorId ?? null,
      action: input.action,
      ticketId: input.ticketId ?? null,
      entityType: input.entityType ?? (input.ticketId ? 'Ticket' : null),
      entityId: input.entityId ?? input.ticketId ?? null,
      reason: input.reason ?? null,
      detail: input.detail,
    },
  });
}
