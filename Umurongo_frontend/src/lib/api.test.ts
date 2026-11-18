import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, errorMessage, request, session, tokenExpiry } from './api';

function jwt(payload: object) {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}
const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

/** The error a request rejects with (fails the test if it resolves). */
async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('Expected the request to fail');
}

/** Reads a Blob as text (jsdom's Blob has no .text()). */
function blobText(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(b);
  });
}

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fn = vi.fn().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('API client', () => {
  beforeEach(() => session.set(null));
  afterEach(() => vi.unstubAllGlobals());

  it('calls /api with JSON and the staff token', async () => {
    const token = jwt({ staffId: 's1', exp: inAnHour() });
    session.set(token);
    const fetch = mockFetch(200, { ok: true });
    await api.reorder('t1', 'UP', 'Very weak');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/tickets/t1/reorder');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${token}`);
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ direction: 'UP', reason: 'Very weak' });
  });

  it('never sends the staff token to public routes', async () => {
    session.set(jwt({ exp: inAnHour() }));
    const fetch = mockFetch(200, { number: 'OPD-024' });
    await api.publicTicket('k3J9xQ2mZp7Lr0aW5bYc1d');
    expect(fetch.mock.calls[0][0]).toBe('/api/public/tickets/k3J9xQ2mZp7Lr0aW5bYc1d');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('builds query strings without empty values', async () => {
    session.set(jwt({ exp: inAnHour() }));
    const fetch = mockFetch(200, {});
    await api.analytics({ from: '2026-11-01', to: '2026-11-18', departmentId: undefined });
    expect(fetch.mock.calls[0][0]).toBe('/api/admin/analytics?from=2026-11-01&to=2026-11-18');
    await api.search('0788 123 456');
    expect(fetch.mock.calls[1][0]).toBe('/api/search?q=0788+123+456');
  });

  it('turns error responses into ApiError with the server message', async () => {
    mockFetch(409, { error: 'OPD-024 is already called. Start, mark no-show or finish first.' });
    const err = await failure(request('/me/call-next', { method: 'POST' }));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(errorMessage(err)).toBe('OPD-024 is already called. Start, mark no-show or finish first.');
  });

  it('copes with a non-JSON error body', async () => {
    mockFetch(502, '<html>Bad gateway</html>', { 'Content-Type': 'text/html' });
    const err = await failure(request('/departments'));
    expect(err.status).toBe(502);
    expect(err.message).toBe('Request failed (502)');
  });

  it('reports a network failure as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await failure(request('/departments'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/Cannot reach the server/);
  });

  it('signs out when the server says the session is no longer valid', async () => {
    session.set(jwt({ exp: inAnHour() }));
    const listener = vi.fn();
    const off = session.subscribe(listener);
    mockFetch(401, { error: 'Please sign in again' });
    await request('/me/queue').catch(() => undefined);
    expect(session.get()).toBeNull();
    expect(listener).toHaveBeenCalled();
    off();
  });

  it('keeps the session in sessionStorage only (per tab), never localStorage', () => {
    const token = jwt({ exp: inAnHour() });
    session.set(token);
    expect(window.sessionStorage.getItem('umurongo.staffSession')).toBe(token);
    expect(Object.keys(window.localStorage)).toHaveLength(0);
    session.set(null);
    expect(window.sessionStorage.getItem('umurongo.staffSession')).toBeNull();
  });

  it('drops an expired token and signs out exactly when the session ends', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-18T08:00:00Z'));
      const exp = Math.floor(Date.now() / 1000) + 60;
      session.set(jwt({ exp }));
      expect(tokenExpiry(session.get()!)).toBe(exp * 1000);
      vi.advanceTimersByTime(59_000);
      expect(session.get()).not.toBeNull();
      vi.advanceTimersByTime(2_000);
      expect(session.get()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('downloads the CSV with the token and the server file name', async () => {
    session.set(jwt({ exp: inAnHour() }));
    const fetch = vi.fn().mockResolvedValue(new Response('"date"\r\n', { status: 200, headers: { 'Content-Disposition': 'attachment; filename="umurongo-tickets-2026-11-01-to-2026-11-18.csv"' } }));
    vi.stubGlobal('fetch', fetch);
    const r = await api.analyticsCsv({ from: '2026-11-01', to: '2026-11-18' });
    expect(r.filename).toBe('umurongo-tickets-2026-11-01-to-2026-11-18.csv');
    expect(await blobText(r.blob)).toBe('"date"\r\n');
    expect(fetch.mock.calls[0][1].headers.Authorization).toMatch(/^Bearer /);
  });
});
