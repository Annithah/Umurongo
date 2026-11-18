// TV reconnect rule: after a dropped connection, announce a call made while offline, but never
// chime through a backlog of old calls.
import { describe, expect, it } from 'vitest';
import type { CallView } from '@umurongo/shared';
import { callToAnnounce, fitScale, messageIndex } from './tvLogic';

const now = new Date('2026-11-18T08:00:00Z');
const call = (ticketNumber: string, minutesAgo: number): CallView => ({
  ticketNumber,
  room: 'Room 3',
  staffName: 'Dr. Claudine Uwase',
  at: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
});

describe('callToAnnounce', () => {
  it('announces a call newer than the last one announced', () => {
    const calls = [call('OPD-025', 0), call('OPD-024', 3)];
    expect(callToAnnounce(calls, call('OPD-024', 3).at, now)?.ticketNumber).toBe('OPD-025');
  });

  it('does not announce the same call twice (event, then the refetch after it)', () => {
    const calls = [call('OPD-025', 0)];
    expect(callToAnnounce(calls, calls[0].at, now)).toBeNull();
  });

  it('after a reconnect announces only the newest missed call, if recent', () => {
    const missed = [call('OPD-027', 1), call('OPD-026', 2), call('OPD-025', 4)];
    expect(callToAnnounce(missed, call('OPD-024', 6).at, now)?.ticketNumber).toBe('OPD-027');
  });

  it('stays quiet about calls older than 5 minutes (TV was off or offline for long)', () => {
    expect(callToAnnounce([call('OPD-030', 20)], call('OPD-029', 40).at, now)).toBeNull();
  });

  it('handles an empty list', () => {
    expect(callToAnnounce([], null, now)).toBeNull();
  });
});

describe('TV layout helpers', () => {
  it('rotates messages every 10 seconds', () => {
    expect(messageIndex(5, 0)).toBe(0);
    expect(messageIndex(5, 9_999)).toBe(0);
    expect(messageIndex(5, 10_000)).toBe(1);
    expect(messageIndex(5, 50_000)).toBe(0);
    expect(messageIndex(0, 50_000)).toBe(0);
  });

  it('scales the 1920x1080 design to the screen without cropping', () => {
    expect(fitScale(1920, 1080)).toBe(1);
    expect(fitScale(1280, 720)).toBeCloseTo(0.6667, 3);
    expect(fitScale(3840, 2160)).toBe(2);
    expect(fitScale(1920, 1200)).toBe(1); // 16:10: width decides
  });
});
