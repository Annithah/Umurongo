import { describe, expect, it } from 'vitest';
import {
  canCall,
  canCancel,
  estimateWaitMinutes,
  findReorderNeighbour,
  formatTicketNumber,
  isPastGrace,
  isServingStatus,
  queueProgress,
  secondsUntilNoShow,
  nextDailyCounter,
  peopleAhead,
  pickNextTicket,
  shouldSendGetReady,
  sortQueue,
  type QueueTicket,
} from './queue';

const t = (id: string, sortKey: number, extra: Partial<QueueTicket> = {}): QueueTicket => ({
  id,
  sortKey,
  priority: 'NORMAL',
  status: 'CHECKED_IN',
  ...extra,
});

describe('ticket numbers', () => {
  it('pads the counter to 3 digits', () => {
    expect(formatTicketNumber('OPD', 24)).toBe('OPD-024');
    expect(formatTicketNumber('LAB', 1)).toBe('LAB-001');
    expect(formatTicketNumber('OPD', 1234)).toBe('OPD-1234');
  });

  it('resets the counter on a new day', () => {
    expect(nextDailyCounter(23, '2026-10-29', '2026-10-29')).toBe(24);
    expect(nextDailyCounter(23, '2026-10-28', '2026-10-29')).toBe(1);
  });
});

describe('ordering', () => {
  it('puts EMERGENCY, then PRIORITY, then earliest first', () => {
    const line = sortQueue([
      t('a', 1),
      t('b', 2, { priority: 'PRIORITY' }),
      t('c', 3, { priority: 'EMERGENCY' }),
      t('d', 0),
    ]);
    expect(line.map((x) => x.id)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('ignores tickets that are no longer waiting', () => {
    const line = sortQueue([t('a', 1, { status: 'DONE' }), t('b', 2, { status: 'WAITING' }), t('c', 3, { status: 'CALLED' })]);
    expect(line.map((x) => x.id)).toEqual(['b']);
  });

  it('counts people ahead', () => {
    const tickets = [t('a', 1), t('b', 2), t('c', 3, { priority: 'PRIORITY' })];
    expect(peopleAhead(tickets, 'c')).toBe(0);
    expect(peopleAhead(tickets, 'b')).toBe(2);
    expect(peopleAhead(tickets, 'missing')).toBe(0);
  });
});

describe('call next', () => {
  it('only calls checked-in tickets', () => {
    expect(canCall('CHECKED_IN')).toBe(true);
    expect(canCall('WAITING')).toBe(false);
    const next = pickNextTicket([t('a', 1, { status: 'WAITING' }), t('b', 2)], 'dr1');
    expect(next?.id).toBe('b');
  });

  it('respects the preferred doctor', () => {
    const tickets = [t('a', 1, { preferredStaffId: 'dr2' }), t('b', 2), t('c', 3, { preferredStaffId: 'dr1' })];
    expect(pickNextTicket(tickets, 'dr1')?.id).toBe('b');
    expect(pickNextTicket(tickets, 'dr2')?.id).toBe('a');
    expect(pickNextTicket([t('a', 1, { preferredStaffId: 'dr2' })], 'dr1')).toBeUndefined();
  });

  it('only cancels waiting or checked-in tickets', () => {
    expect(canCancel('WAITING')).toBe(true);
    expect(canCancel('CHECKED_IN')).toBe(true);
    expect(canCancel('CALLED')).toBe(false);
    expect(canCancel('DONE')).toBe(false);
  });

  it('applies the 10 minute grace period', () => {
    const now = new Date('2026-10-29T10:00:00Z');
    expect(isPastGrace(new Date('2026-10-29T09:51:00Z'), now)).toBe(false);
    expect(isPastGrace(new Date('2026-10-29T09:50:00Z'), now)).toBe(true);
  });

  it('uses a configured grace period and counts down to it', () => {
    const now = new Date('2026-10-29T10:00:00Z');
    expect(isPastGrace(new Date('2026-10-29T09:55:00Z'), now, 5)).toBe(true);
    expect(secondsUntilNoShow(new Date('2026-10-29T09:55:00Z'), now)).toBe(300);
    expect(secondsUntilNoShow(new Date('2026-10-29T09:59:59.500Z'), now)).toBe(600);
    expect(secondsUntilNoShow(new Date('2026-10-29T09:40:00Z'), now)).toBe(0);
  });
});

describe('estimates', () => {
  it('follows the formula with a 2 minute minimum', () => {
    expect(estimateWaitMinutes(3, 12, 2)).toBe(22); // (3.6 * 12) / 2 = 21.6
    expect(estimateWaitMinutes(0, 3, 1)).toBe(2); // 1.8 → 2, minimum 2
    expect(estimateWaitMinutes(5, 12, 1)).toBe(67);
  });

  it('returns null when no staff is available', () => {
    expect(estimateWaitMinutes(3, 12, 0)).toBeNull();
  });

  it('sends "get ready" once at 3 or fewer ahead', () => {
    expect(shouldSendGetReady(4, false)).toBe(false);
    expect(shouldSendGetReady(3, false)).toBe(true);
    expect(shouldSendGetReady(1, true)).toBe(false);
    expect(shouldSendGetReady(5, false, 5)).toBe(true);
  });

  it('counts available and in-consultation staff as serving', () => {
    expect(isServingStatus('AVAILABLE')).toBe(true);
    expect(isServingStatus('IN_CONSULTATION')).toBe(true);
    for (const s of ['IN_SURGERY', 'ON_BREAK', 'AWAY', 'OFF_DUTY'] as const) expect(isServingStatus(s)).toBe(false);
  });

  it('measures progress along the line', () => {
    expect(queueProgress(4, 4)).toBe(0);
    expect(queueProgress(1, 4)).toBe(0.75);
    expect(queueProgress(0, 4)).toBe(1);
    expect(queueProgress(0, 0)).toBe(1);
    expect(queueProgress(6, 4)).toBe(0);
  });
});

describe('reorder', () => {
  const tickets = [t('p', 0, { priority: 'PRIORITY' }), t('a', 1), t('b', 2), t('c', 3)];

  it('swaps with the neighbour of the same priority', () => {
    expect(findReorderNeighbour(tickets, 'b', 'UP')?.id).toBe('a');
    expect(findReorderNeighbour(tickets, 'b', 'DOWN')?.id).toBe('c');
  });

  it('does not cross a priority band or the ends', () => {
    expect(findReorderNeighbour(tickets, 'a', 'UP')).toBeUndefined();
    expect(findReorderNeighbour(tickets, 'c', 'DOWN')).toBeUndefined();
    expect(findReorderNeighbour(tickets, 'p', 'DOWN')).toBeUndefined();
  });
});
