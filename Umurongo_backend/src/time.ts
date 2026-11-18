// Rwanda is UTC+2 all year (no daylight saving), so we can compute local dates with a fixed offset.
const KIGALI_OFFSET_MS = 2 * 60 * 60 * 1000;

/** Today's date in Kigali, as a Date at 00:00 UTC (what Prisma stores in a @db.Date column). */
export function kigaliToday(now = new Date()): Date {
  const local = new Date(now.getTime() + KIGALI_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/** A clock time today in Kigali, e.g. kigaliTimeToday(14, 0) → today 14:00 Kigali. */
export function kigaliTimeToday(hours: number, minutes = 0, now = new Date()): Date {
  return new Date(kigaliToday(now).getTime() + (hours * 60 + minutes) * 60_000 - KIGALI_OFFSET_MS);
}
