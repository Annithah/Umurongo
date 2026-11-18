// Waiting-time analytics from the stage timestamps on Ticket. Maths is in packages/shared.
import {
  addDays,
  dailyTrend,
  feedbackScore,
  kigaliDate,
  kigaliMidnight,
  medianVisitMinutes,
  noShowRate,
  serviceMinutes,
  stageStats,
  ticketsPerHour,
  toCsv,
  waitMinutes,
  type AnalyticsTicket,
  type AnalyticsView,
} from '@umurongo/shared';
import { prisma } from '../db';
import { HttpError } from '../http';

export const MAX_RANGE_DAYS = 92;
const TREND_DAYS = 30;

export function parseRange(from?: string, to?: string, now = new Date()) {
  const end = to ?? kigaliDate(now);
  const start = from ?? addDays(end, -(TREND_DAYS - 1));
  if (start > end) throw new HttpError(400, '"from" must be on or before "to"');
  const days = Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) throw new HttpError(400, `Choose at most ${MAX_RANGE_DAYS} days`);
  return { start, end, days, gte: kigaliMidnight(start), lt: kigaliMidnight(addDays(end, 1)) };
}

async function loadTickets(hospitalId: string, gte: Date, lt: Date, departmentId?: string): Promise<AnalyticsTicket[]> {
  const rows = await prisma.ticket.findMany({
    where: { hospitalId, joinedAt: { gte, lt }, ...(departmentId ? { departmentId } : {}) },
    select: {
      visitId: true,
      status: true,
      joinedAt: true,
      calledAt: true,
      startedAt: true,
      finishedAt: true,
      number: true,
      priority: true,
      department: { select: { code: true, nameEn: true, sortOrder: true } },
    },
    orderBy: { joinedAt: 'asc' },
  });
  return rows.map((r) => ({ ...r, departmentCode: r.department.code, departmentNameEn: r.department.nameEn }));
}

export async function buildAnalytics(hospitalId: string, range: ReturnType<typeof parseRange>, departmentId?: string): Promise<AnalyticsView> {
  const tickets = await loadTickets(hospitalId, range.gte, range.lt, departmentId);
  const trendStart = addDays(range.end, -(TREND_DAYS - 1));
  const trendTickets = trendStart >= range.start ? tickets.filter((t) => kigaliDate(t.joinedAt) >= trendStart) : await loadTickets(hospitalId, kigaliMidnight(trendStart), range.lt, departmentId);

  const visitIds = [...new Set(tickets.map((t) => t.visitId))];
  const visits = await prisma.visit.findMany({
    where: { id: { in: visitIds } },
    select: { startedAt: true, finishedAt: true, feedbackRequestedAt: true, feedbackAnswer: true },
  });
  const asked = visits.filter((v) => v.feedbackRequestedAt).length;
  const yes = visits.filter((v) => v.feedbackAnswer === 'YES').length;
  const no = visits.filter((v) => v.feedbackAnswer === 'NO').length;

  return {
    from: range.start,
    to: range.end,
    totals: {
      tickets: tickets.length,
      visits: visits.length,
      completedVisits: visits.filter((v) => v.finishedAt).length,
      noShows: tickets.filter((t) => t.status === 'NO_SHOW').length,
      noShowRate: noShowRate(tickets),
    },
    medianVisitMinutes: medianVisitMinutes(visits),
    stages: stageStats(tickets),
    perHour: ticketsPerHour(tickets),
    feedback: { asked, yes, no, score: feedbackScore(yes, no) },
    trend: dailyTrend(trendTickets, trendStart, TREND_DAYS),
  };
}

/** One row per ticket, no names or phone numbers. */
export async function analyticsCsv(hospitalId: string, range: ReturnType<typeof parseRange>, departmentId?: string) {
  const rows = await prisma.ticket.findMany({
    where: { hospitalId, joinedAt: { gte: range.gte, lt: range.lt }, ...(departmentId ? { departmentId } : {}) },
    select: { number: true, status: true, priority: true, channel: true, joinedAt: true, calledAt: true, startedAt: true, finishedAt: true, visitId: true, department: { select: { code: true, nameEn: true } } },
    orderBy: { joinedAt: 'asc' },
  });
  const iso = (d: Date | null) => (d ? d.toISOString() : '');
  const header = ['date', 'ticket', 'department', 'priority', 'channel', 'status', 'joined_at', 'called_at', 'started_at', 'finished_at', 'wait_minutes', 'service_minutes'];
  const body = rows.map((r) => {
    const t: AnalyticsTicket = { ...r, departmentCode: r.department.code, departmentNameEn: r.department.nameEn };
    const w = waitMinutes(t);
    const s = serviceMinutes(t);
    return [kigaliDate(r.joinedAt), r.number, r.department.code, r.priority, r.channel, r.status, iso(r.joinedAt), iso(r.calledAt), iso(r.startedAt), iso(r.finishedAt), w === null ? '' : w.toFixed(1), s === null ? '' : s.toFixed(1)];
  });
  return toCsv([header, ...body]);
}
