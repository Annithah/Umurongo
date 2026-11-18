// TV rules kept out of React so they can be unit-tested.
import type { CallView } from '@umurongo/shared';

/**
 * Which call should flash (and chime)?
 * - A call newer than the last one we announced: yes.
 * - After a reconnect, calls made while offline: only the newest one, and only if it is recent,
 *   so the TV does not chime through a backlog of old calls.
 */
export function callToAnnounce(calls: CallView[], lastAnnouncedAt: string | null, now: Date = new Date(), maxAgeMs = 5 * 60_000): CallView | null {
  const newest = calls[0];
  if (!newest) return null;
  if (lastAnnouncedAt && new Date(newest.at).getTime() <= new Date(lastAnnouncedAt).getTime()) return null;
  if (now.getTime() - new Date(newest.at).getTime() > maxAgeMs) return null;
  return newest;
}

/** Index of the rotating message to show, changing every `everyMs`. */
export function messageIndex(count: number, now: number, everyMs = 10_000): number {
  return count ? Math.floor(now / everyMs) % count : 0;
}

/** Scale that fits a 1920x1080 design into the window without cropping. */
export function fitScale(width: number, height: number, designW = 1920, designH = 1080): number {
  return Math.min(width / designW, height / designH);
}
