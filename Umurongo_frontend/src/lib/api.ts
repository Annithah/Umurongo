// Typed API client. In development VITE_API_URL is empty and Vite proxies /api to the API.
import type {
  AnalyticsView,
  AuditEntry,
  DepartmentAdmin,
  DepartmentQueue,
  DepartmentSummary,
  HospitalSettings,
  JobRunView,
  Language,
  LoginResponse,
  MyQueueView,
  Priority,
  PriorityReason,
  PublicTicketView,
  ReceptionEntry,
  RegisterResult,
  RoomView,
  SmsView,
  StaffAdminView,
  StaffMe,
  StaffPublic,
  StaffRole,
  StaffStatus,
  TvView,
} from '@umurongo/shared';

export const API_URL: string = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Staff session ──────────────────────────────────────────────────────────
// Kept in sessionStorage: one session per browser tab, gone when the tab is closed.
// Hospital laptops are shared, so nothing about the session outlives the tab.

const SESSION_KEY = 'umurongo.staffSession';
type Listener = () => void;
const listeners = new Set<Listener>();
let cached: string | null | undefined;

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Expiry (ms) from a JWT, or null if it cannot be read. */
export function tokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

let expiryTimer: ReturnType<typeof setTimeout> | null = null;

export const session = {
  get(): string | null {
    if (cached === undefined) cached = storage()?.getItem(SESSION_KEY) ?? null;
    if (cached) {
      const exp = tokenExpiry(cached);
      if (exp !== null && exp <= Date.now()) session.set(null);
    }
    return cached;
  },
  set(token: string | null) {
    cached = token;
    const s = storage();
    if (token) s?.setItem(SESSION_KEY, token);
    else s?.removeItem(SESSION_KEY);
    if (expiryTimer) clearTimeout(expiryTimer);
    const exp = token ? tokenExpiry(token) : null;
    // Sign out on the dot when the 8-hour session ends, not on the next failed request.
    if (exp) expiryTimer = setTimeout(() => session.set(null), Math.max(0, Math.min(exp - Date.now(), 2 ** 31 - 1)));
    listeners.forEach((l) => l());
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

// ─── Requests ───────────────────────────────────────────────────────────────

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function request<T>(path: string, { method = 'GET', body, auth = true }: { method?: Method; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = auth ? session.get() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check the connection.');
  }
  const data = await res.json().catch(() => ({}));
  // An expired or revoked session signs the person out; the app then shows the sign-in screen.
  if (res.status === 401 && token) session.set(null);
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return 'Something went wrong';
}

const q = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `?${s}` : '';
};

// ─── Endpoints ──────────────────────────────────────────────────────────────

export interface WalkInInput {
  departmentId: string;
  displayName: string;
  phone: string;
  language: Language;
  priority: Priority;
  priorityReason: PriorityReason;
  note?: string;
}

export interface StaffInput {
  fullName: string;
  email: string;
  role: StaffRole;
  title: string;
  departmentId: string | null;
  roomId: string | null;
  active: boolean;
}

export type SmsTemplatePreview = { template: string; language: Language; text: string; length: number; worstLength: number; fits: boolean };
export type DevSms = { simulated: boolean; messages: { id: string; at: string; to: string; template: string; language: Language; body: string; status: string; ticketNumber: string | null }[] };

export const api = {
  // Public (no sign-in)
  publicTicket: (token: string) => request<PublicTicketView>(`/public/tickets/${encodeURIComponent(token)}`, { auth: false }),
  tv: (hospitalId: string) => request<TvView>(`/public/tv/${encodeURIComponent(hospitalId)}`, { auth: false }),
  hospitals: () => request<{ id: string; name: string }[]>('/public/hospitals', { auth: false }),

  // Auth
  login: (email: string, password: string) => request<LoginResponse>('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  invite: (token: string) => request<{ fullName: string; email: string; hospitalName: string }>(`/auth/invite/${token}`, { auth: false }),
  acceptInvite: (token: string, password: string) => request<LoginResponse>(`/auth/invite/${token}`, { method: 'POST', body: { password }, auth: false }),
  me: () => request<StaffMe>('/staff/me'),

  // Shared staff views
  departments: () => request<DepartmentSummary[]>('/departments'),
  queue: (departmentId: string) => request<DepartmentQueue>(`/queues/${departmentId}`),
  staff: () => request<StaffPublic[]>('/staff'),
  setStatus: (staffId: string, status: StaffStatus, backAt?: string | null) =>
    request<StaffPublic>(`/staff/${staffId}/status`, { method: 'PATCH', body: { status, backAt: backAt ?? null } }),

  // Reception
  register: (body: WalkInInput) => request<RegisterResult>('/walk-ins', { method: 'POST', body }),
  search: (text: string) => request<ReceptionEntry[]>(`/search${q({ q: text })}`),
  ticket: (id: string) => request<ReceptionEntry & { patientUrl: string }>(`/tickets/${id}`),
  reorder: (id: string, direction: 'UP' | 'DOWN', reason: string) => request<{ ok: true }>(`/tickets/${id}/reorder`, { method: 'POST', body: { direction, reason } }),
  setPriority: (id: string, priority: Priority, priorityReason: PriorityReason, reason: string) =>
    request<ReceptionEntry>(`/tickets/${id}/priority`, { method: 'POST', body: { priority, priorityReason, reason } }),
  cancel: (id: string, reason: string) => request<ReceptionEntry>(`/tickets/${id}/cancel`, { method: 'POST', body: { reason } }),
  noShow: (id: string) => request<ReceptionEntry>(`/tickets/${id}/no-show`, { method: 'POST' }),
  callAgain: (id: string) => request<{ ok: true }>(`/tickets/${id}/call-again`, { method: 'POST' }),

  // My queue (clinicians and counters)
  myQueue: () => request<MyQueueView>('/me/queue'),
  callNext: () => request<MyQueueView & { called: MyQueueView['current'] }>('/me/call-next', { method: 'POST' }),
  start: () => request<MyQueueView>('/me/start', { method: 'POST' }),
  finish: () => request<MyQueueView>('/me/finish', { method: 'POST' }),
  refer: (departmentId: string, note?: string) => request<MyQueueView>('/me/refer', { method: 'POST', body: { departmentId, note } }),
  myNoShow: () => request<MyQueueView>('/me/no-show', { method: 'POST' }),
  myCallAgain: () => request<MyQueueView>('/me/call-again', { method: 'POST' }),

  // Admin
  settings: () => request<HospitalSettings & { retentionDays: number }>('/admin/settings'),
  saveSettings: (body: Omit<HospitalSettings, 'id'> & { retentionDays: number }) => request<HospitalSettings>('/admin/settings', { method: 'PUT', body }),
  adminDepartments: () => request<DepartmentAdmin[]>('/admin/departments'),
  saveDepartment: (d: Omit<DepartmentAdmin, 'id'>, id?: string) =>
    request<DepartmentAdmin>(id ? `/admin/departments/${id}` : '/admin/departments', { method: id ? 'PUT' : 'POST', body: d }),
  rooms: () => request<RoomView[]>('/admin/rooms'),
  saveRoom: (r: { name: string; departmentId: string | null; active: boolean }, id?: string) =>
    request<RoomView>(id ? `/admin/rooms/${id}` : '/admin/rooms', { method: id ? 'PUT' : 'POST', body: r }),
  adminStaff: () => request<StaffAdminView[]>('/admin/staff'),
  createStaff: (s: StaffInput) => request<{ staff: StaffAdminView; inviteUrl: string; expiresInDays: number }>('/admin/staff', { method: 'POST', body: s }),
  updateStaff: (id: string, s: StaffInput) => request<StaffAdminView>(`/admin/staff/${id}`, { method: 'PUT', body: s }),
  renewInvite: (id: string) => request<{ inviteUrl: string; expiresInDays: number }>(`/admin/staff/${id}/invite`, { method: 'POST' }),
  smsTemplates: () => request<{ senderId: string; mode: string; templates: SmsTemplatePreview[] }>('/admin/sms/templates'),
  smsOutbox: () => request<SmsView[]>('/admin/sms'),
  jobs: () => request<JobRunView[]>('/admin/jobs'),
  runJob: (name: string) => request<{ ok: boolean }>(`/admin/jobs/${name}/run`, { method: 'POST' }),
  audit: (params: { ticket?: string; action?: string; before?: string } = {}) => request<AuditEntry[]>(`/admin/audit${q(params)}`),
  analytics: (params: { from?: string; to?: string; departmentId?: string }) => request<AnalyticsView>(`/admin/analytics${q(params)}`),

  /** Downloads the CSV with the session token (a plain link could not send it). */
  async analyticsCsv(params: { from?: string; to?: string; departmentId?: string }): Promise<{ blob: Blob; filename: string }> {
    const token = session.get();
    const res = await fetch(`${API_URL}/api/admin/analytics.csv${q(params)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new ApiError(res.status, 'Could not export the CSV');
    const filename = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'umurongo.csv';
    return { blob: await res.blob(), filename };
  },

  // Demo helpers
  devSms: () => request<DevSms>('/dev/sms'),
  devReply: (phone: string, text: string) => request<{ matched: boolean; answer: string | null }>('/dev/sms/reply', { method: 'POST', body: { phone, text } }),
  devAdvance: () => request<{ log: string[] }>('/dev/advance', { method: 'POST' }),
  devReset: () => request<{ ok: true }>('/dev/reset', { method: 'POST' }),
};
