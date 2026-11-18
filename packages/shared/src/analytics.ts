// Waiting-time analytics computed from the stage timestamps stored on each ticket.
// Pure functions: the API loads tickets and passes them in; tests use fixed data.
import type { StageStat, TicketStatus } from './types';
import { kigaliDate, kigaliHour } from './time';

export interface AnalyticsTicket {
  visitId: string;
  departmentCode: string;
  departmentNameEn: string;
  status: TicketStatus;
  joinedAt: Date;
  calledAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export function median(values: number[]): number | null {
  return percentile(values, 50);
}

/** Linear-interpolated percentile (p in 0..100). Null for an empty list. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

const minutes = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 60_000;
const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/** Minutes from joining the line to being called. Null if never called. */
export function waitMinutes(t: AnalyticsTicket): number | null {
  return t.calledAt ? Math.max(0, minutes(t.joinedAt, t.calledAt)) : null;
}

/** Minutes being served (start, or call, to finish). Null unless the ticket was served. */
export function serviceMinutes(t: AnalyticsTicket): number | null {
  if (!t.finishedAt || !['DONE', 'REFERRED'].includes(t.status)) return null;
  const from = t.startedAt ?? t.calledAt;
  return from ? Math.max(0, minutes(from, t.finishedAt)) : null;
}

/** Median and 90th percentile of waiting and service time per department. */
export function stageStats(tickets: AnalyticsTicket[]): StageStat[] {
  const groups = new Map<string, AnalyticsTicket[]>();
  for (const t of tickets) groups.set(t.departmentCode, [...(groups.get(t.departmentCode) ?? []), t]);
  const out: StageStat[] = [];
  for (const [code, list] of groups) {
    const name = list[0].departmentNameEn;
    for (const [stage, fn] of [
      ['WAIT', waitMinutes],
      ['SERVICE', serviceMinutes],
    ] as const) {
      const values = list.map(fn).filter((v): v is number => v !== null);
      out.push({
        stage,
        departmentCode: code,
        departmentNameEn: name,
        medianMinutes: round1(median(values)),
        p90Minutes: round1(percentile(values, 90)),
        count: values.length,
      });
    }
  }
  return out;
}

/** Tickets created per hour of the day (Kigali), 0-23. */
export function ticketsPerHour(tickets: AnalyticsTicket[]): { hour: number; count: number }[] {
  const counts = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  for (const t of tickets) counts[kigaliHour(t.joinedAt)].count++;
  return counts;
}

/** Rule: no-show rate = no-shows / tickets that were called. Null when nobody was called. */
export function noShowRate(tickets: AnalyticsTicket[]): number | null {
  const called = tickets.filter((t) => t.calledAt);
  if (!called.length) return null;
  return called.filter((t) => t.status === 'NO_SHOW').length / called.length;
}

/** Median total visit time (first ticket joined to last ticket finished) for completed visits. */
export function medianVisitMinutes(visits: { startedAt: Date; finishedAt: Date | null }[]): number | null {
  return round1(median(visits.filter((v) => v.finishedAt).map((v) => minutes(v.startedAt, v.finishedAt!))));
}

/** Per-day series for the trend chart. Days without tickets are included with zeros. */
export function dailyTrend(tickets: AnalyticsTicket[], from: string, days: number) {
  const byDay = new Map<string, AnalyticsTicket[]>();
  for (const t of tickets) {
    const d = kigaliDate(t.joinedAt);
    byDay.set(d, [...(byDay.get(d) ?? []), t]);
  }
  const out: { date: string; tickets: number; medianWaitMinutes: number | null; noShowRate: number | null }[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    const date = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    const list = byDay.get(date) ?? [];
    out.push({
      date,
      tickets: list.length,
      medianWaitMinutes: round1(median(list.map(waitMinutes).filter((v): v is number => v !== null))),
      noShowRate: noShowRate(list),
    });
  }
  return out;
}

/** Feedback score = share of "yes" answers. Null when no one answered. */
export function feedbackScore(yes: number, no: number): number | null {
  return yes + no === 0 ? null : yes / (yes + no);
}

/**
 * CSV for spreadsheets. Quotes every field and neutralises values starting with = + - @
 * so a cell can never run as a formula when opened in Excel (CSV injection).
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '""';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
