// Queue rules for Umurongo. Pure functions only (no database), so they are easy to test
// and the API and the web app always agree. See SPEC.md section 6.
import type { Priority, StaffStatus, TicketStatus } from './types';

/** The minimal ticket shape the rules need. */
export interface QueueTicket {
  id: string;
  priority: Priority;
  status: TicketStatus;
  sortKey: number;
  preferredStaffId?: string | null;
}

// ─── Ticket numbers ─────────────────────────────────────────────────────────

/** Rule: ticket number = department prefix + daily counter with 3 digits, e.g. "OPD-024". */
export function formatTicketNumber(prefix: string, counter: number): string {
  return `${prefix}-${String(counter).padStart(3, '0')}`;
}

/**
 * Rule: the counter resets each day. Dates are compared as "YYYY-MM-DD" strings (Kigali time).
 * Returns the counter value to use for the new ticket.
 * (The API does the same thing atomically in SQL; this function documents and tests the rule.)
 */
export function nextDailyCounter(current: number, counterDate: string, today: string): number {
  return counterDate === today ? current + 1 : 1;
}

// ─── Ordering ───────────────────────────────────────────────────────────────

const PRIORITY_RANK: Record<Priority, number> = { EMERGENCY: 0, PRIORITY: 1, NORMAL: 2 };

/** Tickets that are still waiting for their turn (not yet called). */
export const WAITING_STATUSES: TicketStatus[] = ['WAITING', 'CHECKED_IN'];

/** Rule: order within a department is EMERGENCY, then PRIORITY, then sortKey ascending. */
export function compareTickets(a: QueueTicket, b: QueueTicket): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.sortKey - b.sortKey;
}

/** The waiting line of one department, in call order. */
export function sortQueue<T extends QueueTicket>(tickets: T[]): T[] {
  return tickets.filter((t) => WAITING_STATUSES.includes(t.status)).sort(compareTickets);
}

/** How many waiting tickets are in front of this one. Returns 0 if the ticket is not waiting. */
export function peopleAhead(tickets: QueueTicket[], ticketId: string): number {
  const line = sortQueue(tickets);
  const index = line.findIndex((t) => t.id === ticketId);
  return index < 0 ? 0 : index;
}

// ─── Calling ────────────────────────────────────────────────────────────────

/** Rule: only CHECKED_IN tickets can be called. */
export function canCall(status: TicketStatus): boolean {
  return status === 'CHECKED_IN';
}

/**
 * Rule: "Call next" for a doctor picks the first checked-in ticket of their department
 * whose preferredStaffId is empty or equals that doctor.
 */
export function pickNextTicket<T extends QueueTicket>(tickets: T[], staffId: string): T | undefined {
  return sortQueue(tickets).find(
    (t) => canCall(t.status) && (!t.preferredStaffId || t.preferredStaffId === staffId),
  );
}

/** Rule: only WAITING or CHECKED_IN tickets can be cancelled. */
export function canCancel(status: TicketStatus): boolean {
  return status === 'WAITING' || status === 'CHECKED_IN';
}

/** Rule (grace): a CALLED ticket not started within 10 minutes can be marked NO_SHOW or called again. */
export const GRACE_MINUTES = 10;

export function isPastGrace(calledAt: Date | string, now: Date = new Date(), graceMinutes = GRACE_MINUTES): boolean {
  return now.getTime() - new Date(calledAt).getTime() >= graceMinutes * 60_000;
}

/** Seconds left before a called ticket may be marked no-show (0 when it already may). */
export function secondsUntilNoShow(calledAt: Date | string, now: Date = new Date(), graceMinutes = GRACE_MINUTES): number {
  const left = new Date(calledAt).getTime() + graceMinutes * 60_000 - now.getTime();
  return Math.max(0, Math.ceil(left / 1000));
}

// ─── Estimates and notifications ────────────────────────────────────────────

/**
 * Rule: estimated wait (minutes) = max(2, round((peopleAhead + 0.6) * avgMinutes / availableStaffCount)).
 * The 0.6 accounts for the patient currently in consultation being partly done.
 * Returns null when no staff is AVAILABLE ("No doctor available right now").
 */
export function estimateWaitMinutes(ahead: number, avgMinutes: number, availableStaffCount: number): number | null {
  if (availableStaffCount <= 0) return null;
  return Math.max(2, Math.round(((ahead + 0.6) * avgMinutes) / availableStaffCount));
}

/** Rule: send the "Get ready" notification once, when 3 or fewer people are ahead. */
export const GET_READY_AHEAD = 3;

export function shouldSendGetReady(ahead: number, alreadySent: boolean, threshold = GET_READY_AHEAD): boolean {
  return !alreadySent && ahead <= threshold;
}

/**
 * Rule: staff who are AVAILABLE or IN_CONSULTATION are serving the queue and count for estimates.
 * In surgery, on break, away and off duty do not.
 */
export function isServingStatus(status: StaffStatus): boolean {
  return status === 'AVAILABLE' || status === 'IN_CONSULTATION';
}

/**
 * Progress along the line for the patient page: 0 when the ticket was issued, 1 at the front.
 * aheadAtJoin is the number of people ahead when the ticket was created.
 */
export function queueProgress(ahead: number, aheadAtJoin: number): number {
  if (aheadAtJoin <= 0) return ahead <= 0 ? 1 : 0;
  return Math.min(1, Math.max(0, (aheadAtJoin - ahead) / aheadAtJoin));
}

// ─── Reordering ─────────────────────────────────────────────────────────────

/**
 * Rule: reorder swaps the sortKey with the neighbour of the same priority.
 * Returns the neighbour to swap with, or undefined if the ticket is already first/last in its band.
 * (The API also requires a reason and writes a TicketEvent.)
 */
export function findReorderNeighbour<T extends QueueTicket>(
  tickets: T[],
  ticketId: string,
  direction: 'UP' | 'DOWN',
): T | undefined {
  const line = sortQueue(tickets);
  const index = line.findIndex((t) => t.id === ticketId);
  if (index < 0) return undefined;
  const neighbour = line[direction === 'UP' ? index - 1 : index + 1];
  return neighbour && neighbour.priority === line[index].priority ? neighbour : undefined;
}
