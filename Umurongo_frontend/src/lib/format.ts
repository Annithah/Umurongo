// Formatting helpers. All times are shown in Kigali time.
const TZ = 'Africa/Kigali';

export function clock(d: string | Date | null | undefined, withSeconds = false): string {
  if (!d) return '-';
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}), timeZone: TZ });
}

export function longDate(d: Date = new Date(), locale = 'en-GB'): string {
  return d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
}

export function shortDate(d: string | Date): string {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: TZ });
}

/** Whole minutes between two moments (default: until now). */
export function minutesBetween(from: string | Date, to: string | Date = new Date()): number {
  return Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
}

/** "4 min", "1 h 05". */
export function duration(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  return `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`;
}

/** "m:ss" for countdowns and timers. */
export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function percent(x: number | null | undefined): string {
  return x === null || x === undefined ? '-' : `${Math.round(x * 100)}%`;
}
