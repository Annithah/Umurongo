// Kigali time helpers. Rwanda is UTC+2 all year (no daylight saving), so a fixed offset is exact.
export const KIGALI_OFFSET_MS = 2 * 60 * 60 * 1000;

const local = (d: Date) => new Date(d.getTime() + KIGALI_OFFSET_MS);

/** "YYYY-MM-DD" in Kigali. */
export function kigaliDate(d: Date = new Date()): string {
  return local(d).toISOString().slice(0, 10);
}

/** Hour of the day (0-23) in Kigali. */
export function kigaliHour(d: Date): number {
  return local(d).getUTCHours();
}

/** Minutes since midnight in Kigali. */
export function kigaliMinutes(d: Date): number {
  const l = local(d);
  return l.getUTCHours() * 60 + l.getUTCMinutes();
}

const HHMM = /^([01]\d|2[0-4]):([0-5]\d)$/;

export function isValidClock(value: string): boolean {
  const m = HHMM.exec(value);
  return !!m && (m[1] !== '24' || m[2] === '00');
}

/** "07:30" -> 450. */
export function clockToMinutes(value: string): number {
  const m = HHMM.exec(value);
  if (!m) throw new Error(`Invalid time "${value}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** A department is open around the clock when it opens at 00:00 and closes at 24:00 (or both are equal). */
export function isAroundTheClock(opensAt: string, closesAt: string): boolean {
  return opensAt === closesAt || (clockToMinutes(opensAt) === 0 && clockToMinutes(closesAt) === 24 * 60);
}

/** Rule: open when opensAt <= now < closesAt (Kigali). Departments open every day in pilot 1. */
export function isWithinHours(opensAt: string, closesAt: string, now: Date = new Date()): boolean {
  if (isAroundTheClock(opensAt, closesAt)) return true;
  const m = kigaliMinutes(now);
  return m >= clockToMinutes(opensAt) && m < clockToMinutes(closesAt);
}

/**
 * Rule (daily close): close the day once closing time has passed and today has not been closed yet.
 * lastClosedDate is the Kigali date ("YYYY-MM-DD") of the last close, or null.
 */
export function isDueForDailyClose(closesAt: string, opensAt: string, lastClosedDate: string | null, now: Date = new Date()): boolean {
  if (isAroundTheClock(opensAt, closesAt)) return false;
  return kigaliMinutes(now) >= clockToMinutes(closesAt) && lastClosedDate !== kigaliDate(now);
}

/** When the department opens next: later today (before opening time) or tomorrow. */
export function nextOpening(opensAt: string, now: Date = new Date()): { day: 'today' | 'tomorrow'; time: string } {
  return { day: kigaliMinutes(now) < clockToMinutes(opensAt) ? 'today' : 'tomorrow', time: opensAt };
}

/** UTC instant of 00:00 Kigali on the given Kigali date. */
export function kigaliMidnight(date: string): Date {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - KIGALI_OFFSET_MS);
}

/** Adds days to a "YYYY-MM-DD" date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
