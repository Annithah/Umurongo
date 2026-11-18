// Tests for time rules, analytics and the visit journey.
import { describe, expect, it } from 'vitest';
import {
  addDays,
  clockToMinutes,
  isDueForDailyClose,
  isValidClock,
  isWithinHours,
  kigaliDate,
  kigaliHour,
  kigaliMidnight,
  nextOpening,
} from './time';
import {
  dailyTrend,
  feedbackScore,
  median,
  medianVisitMinutes,
  noShowRate,
  percentile,
  serviceMinutes,
  stageStats,
  ticketsPerHour,
  toCsv,
  waitMinutes,
  type AnalyticsTicket,
} from './analytics';
import { buildJourney, type JourneyTicket } from './journey';

// 2026-11-18 08:30 in Kigali is 06:30 UTC.
const at = (kigali: string) => new Date(new Date(`${kigali}Z`).getTime() - 2 * 3600_000);

describe('Kigali time and opening hours', () => {
  it('converts to Kigali dates and hours', () => {
    expect(kigaliDate(new Date('2026-11-17T22:30:00Z'))).toBe('2026-11-18');
    expect(kigaliHour(at('2026-11-18T08:30:00'))).toBe(8);
    expect(kigaliMidnight('2026-11-18').toISOString()).toBe('2026-11-17T22:00:00.000Z');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });

  it('validates clock times', () => {
    expect(isValidClock('07:00')).toBe(true);
    expect(isValidClock('24:00')).toBe(true);
    expect(isValidClock('24:30')).toBe(false);
    expect(isValidClock('7:00')).toBe(false);
    expect(clockToMinutes('19:30')).toBe(1170);
  });

  it('knows when a department is within its hours', () => {
    expect(isWithinHours('07:00', '19:00', at('2026-11-18T06:59:00'))).toBe(false);
    expect(isWithinHours('07:00', '19:00', at('2026-11-18T07:00:00'))).toBe(true);
    expect(isWithinHours('07:00', '19:00', at('2026-11-18T19:00:00'))).toBe(false);
    expect(isWithinHours('00:00', '24:00', at('2026-11-18T03:00:00'))).toBe(true);
  });

  it('closes the day once, after closing time', () => {
    const evening = at('2026-11-18T19:05:00');
    expect(isDueForDailyClose('19:00', '07:00', null, at('2026-11-18T18:59:00'))).toBe(false);
    expect(isDueForDailyClose('19:00', '07:00', '2026-11-17', evening)).toBe(true);
    expect(isDueForDailyClose('19:00', '07:00', '2026-11-18', evening)).toBe(false);
    expect(isDueForDailyClose('24:00', '00:00', null, evening)).toBe(false);
  });

  it('tells patients when the department opens next', () => {
    expect(nextOpening('07:00', at('2026-11-18T19:05:00'))).toEqual({ day: 'tomorrow', time: '07:00' });
    expect(nextOpening('07:00', at('2026-11-18T05:00:00'))).toEqual({ day: 'today', time: '07:00' });
  });
});

const ticket = (extra: Partial<AnalyticsTicket>): AnalyticsTicket => ({
  visitId: 'v',
  departmentCode: 'OPD',
  departmentNameEn: 'OPD',
  status: 'DONE',
  joinedAt: at('2026-11-18T08:00:00'),
  calledAt: null,
  startedAt: null,
  finishedAt: null,
  ...extra,
});
const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

describe('analytics', () => {
  it('computes medians and percentiles', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([10, 20, 30, 40, 50], 90)).toBe(46);
  });

  it('measures waiting and service time from stage timestamps', () => {
    const j = at('2026-11-18T08:00:00');
    const done = ticket({ calledAt: plus(j, 30), startedAt: plus(j, 32), finishedAt: plus(j, 44) });
    expect(waitMinutes(done)).toBe(30);
    expect(serviceMinutes(done)).toBe(12);
    expect(serviceMinutes(ticket({ status: 'NO_SHOW', calledAt: plus(j, 5), finishedAt: plus(j, 16) }))).toBeNull();
    expect(waitMinutes(ticket({ status: 'CHECKED_IN' }))).toBeNull();
  });

  it('groups stage statistics per department', () => {
    const j = at('2026-11-18T08:00:00');
    const tickets = [10, 20, 60].map((w) => ticket({ calledAt: plus(j, w), finishedAt: plus(j, w + 10) }));
    tickets.push(ticket({ departmentCode: 'LAB', departmentNameEn: 'Lab', calledAt: plus(j, 4), finishedAt: plus(j, 9) }));
    const stats = stageStats(tickets);
    expect(stats.find((s) => s.departmentCode === 'OPD' && s.stage === 'WAIT')).toMatchObject({ medianMinutes: 20, count: 3 });
    expect(stats.find((s) => s.departmentCode === 'OPD' && s.stage === 'SERVICE')).toMatchObject({ medianMinutes: 10 });
    expect(stats.find((s) => s.departmentCode === 'LAB' && s.stage === 'WAIT')).toMatchObject({ medianMinutes: 4, count: 1 });
  });

  it('counts tickets per Kigali hour and the no-show rate', () => {
    const tickets = [
      ticket({ joinedAt: at('2026-11-18T08:10:00'), calledAt: at('2026-11-18T08:20:00') }),
      ticket({ joinedAt: at('2026-11-18T08:50:00'), status: 'NO_SHOW', calledAt: at('2026-11-18T09:00:00') }),
      ticket({ joinedAt: at('2026-11-18T14:00:00'), status: 'CHECKED_IN' }),
    ];
    const hours = ticketsPerHour(tickets);
    expect(hours).toHaveLength(24);
    expect(hours[8].count).toBe(2);
    expect(hours[14].count).toBe(1);
    expect(noShowRate(tickets)).toBe(0.5);
    expect(noShowRate([ticket({ status: 'CHECKED_IN' })])).toBeNull();
  });

  it('builds a daily trend with empty days', () => {
    const trend = dailyTrend([ticket({ joinedAt: at('2026-11-17T09:00:00'), calledAt: at('2026-11-17T09:12:00') })], '2026-11-16', 3);
    expect(trend.map((d) => d.tickets)).toEqual([0, 1, 0]);
    expect(trend[1]).toMatchObject({ date: '2026-11-17', medianWaitMinutes: 12, noShowRate: 0 });
  });

  it('scores feedback and total visit time', () => {
    expect(feedbackScore(0, 0)).toBeNull();
    expect(feedbackScore(3, 1)).toBe(0.75);
    const s = at('2026-11-18T08:00:00');
    expect(medianVisitMinutes([{ startedAt: s, finishedAt: plus(s, 90) }, { startedAt: s, finishedAt: null }])).toBe(90);
  });

  it('writes CSV that spreadsheets cannot run as formulas', () => {
    expect(toCsv([['a', 1, null], ['say "hi"', '=SUM(A1)', '-5']])).toBe(
      '"a","1",""\r\n"say ""hi""","\'=SUM(A1)","\'-5"\r\n',
    );
    expect(toCsv([[-5]])).toBe('"-5"\r\n');
  });
});

describe('journey', () => {
  const step = (kind: JourneyTicket['kind'], status: JourneyTicket['status'], minute: number, number = `${kind}-${minute}`): JourneyTicket => ({
    number,
    kind,
    nameEn: kind,
    nameRw: kind,
    status,
    joinedAt: new Date(Date.UTC(2026, 10, 18, 8, minute)),
  });
  const states = (j: ReturnType<typeof buildJourney>) => j.map((s) => s.state);

  it('highlights consultation while the patient waits for the doctor', () => {
    expect(states(buildJourney([step('CONSULTATION', 'CHECKED_IN', 0)], false))).toEqual(['done', 'current', 'upcoming', 'upcoming']);
  });

  it('moves to next steps after a referral and lists the tickets', () => {
    const j = buildJourney([step('CONSULTATION', 'REFERRED', 0), step('LAB', 'REFERRED', 30), step('PHARMACY', 'CHECKED_IN', 50)], false);
    expect(states(j)).toEqual(['done', 'done', 'current', 'upcoming']);
    expect(j[2].tickets.map((t) => t.number)).toEqual(['LAB-30', 'PHARMACY-50']);
  });

  it('ends on Done when the visit is finished', () => {
    const j = buildJourney([step('CONSULTATION', 'REFERRED', 0), step('PHARMACY', 'DONE', 40)], true);
    expect(states(j)).toEqual(['done', 'done', 'done', 'current']);
  });

  it('stays on the last step when a ticket ended without being served', () => {
    expect(states(buildJourney([step('CONSULTATION', 'NO_SHOW', 0)], true))).toEqual(['done', 'done', 'done', 'current']);
    expect(states(buildJourney([step('CONSULTATION', 'NO_SHOW', 0)], false))).toEqual(['done', 'current', 'upcoming', 'upcoming']);
  });
});

import { formatRwandaPhone, isValidDisplayName, maskPhone, normalizeRwandaPhone } from './phone';

describe('phones and display names', () => {
  it('normalises Rwandan mobile numbers to E.164', () => {
    expect(normalizeRwandaPhone('0788 123 456')).toBe('+250788123456');
    expect(normalizeRwandaPhone('250722000111')).toBe('+250722000111');
    expect(normalizeRwandaPhone('+250 (73) 300-0111')).toBe('+250733000111');
    expect(normalizeRwandaPhone('0711 123 456')).toBeNull();
    expect(normalizeRwandaPhone('12345')).toBeNull();
  });

  it('masks and formats numbers', () => {
    expect(maskPhone('+250788123456')).toBe('+250 78* *** 456');
    expect(formatRwandaPhone('+250788123456')).toBe('0788 123 456');
    expect(maskPhone(null)).toBe('');
  });

  it('accepts first names and initials, not full names', () => {
    for (const ok of ['Aline', 'J. B.', 'Jean-Paul', 'A.', "N'Diaye", 'Aline U.']) expect(isValidDisplayName(ok), ok).toBe(true);
    for (const bad of ['Aline Uwimana', '', '123', 'A'.repeat(21), 'Jean Bosco Niyonzima']) expect(isValidDisplayName(bad), bad).toBe(false);
  });
});
