// Shared enums and API shapes used by both the API and the web app.
// Enums mirror Umurongo_backend/prisma/schema.prisma. Keep them in sync.
//
// Privacy rules encoded in these shapes (pilot 1):
// - No medical data, no National ID, no photos.
// - Patients are known only by a display name (first name or initials).
// - Phone numbers appear only in ReceptionEntry. Clinicians, counters, the TV and the
//   patient page never receive them.

export const STAFF_ROLES = ['RECEPTIONIST', 'CLINICIAN', 'COUNTER', 'HOSPITAL_ADMIN'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Roles that serve a queue from the "My queue" screen. */
export const SERVING_ROLES: StaffRole[] = ['CLINICIAN', 'COUNTER'];

export const STAFF_STATUSES = ['AVAILABLE', 'IN_CONSULTATION', 'IN_SURGERY', 'ON_BREAK', 'AWAY', 'OFF_DUTY'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const DEPARTMENT_KINDS = ['CONSULTATION', 'LAB', 'CASHIER', 'PHARMACY', 'IMAGING', 'OTHER'] as const;
export type DepartmentKind = (typeof DEPARTMENT_KINDS)[number];

export const PRIORITIES = ['NORMAL', 'PRIORITY', 'EMERGENCY'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Why a ticket has PRIORITY. NONE for normal and emergency tickets. */
export const PRIORITY_REASONS = ['NONE', 'PREGNANT', 'ELDERLY', 'DISABILITY', 'CHILD_UNDER_5'] as const;
export type PriorityReason = (typeof PRIORITY_REASONS)[number];

export const CHANNELS = ['WALK_IN', 'NEXT_STEP'] as const;
export type Channel = (typeof CHANNELS)[number];

export const TICKET_STATUSES = [
  'WAITING',
  'CHECKED_IN',
  'CALLED',
  'IN_CONSULTATION',
  'DONE',
  'REFERRED',
  'NO_SHOW',
  'CANCELLED',
  'CLOSED',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Tickets in these states still hold a place in a queue or a room. */
export const ACTIVE_TICKET_STATUSES: TicketStatus[] = ['WAITING', 'CHECKED_IN', 'CALLED', 'IN_CONSULTATION'];

export const LANGUAGES = ['RW', 'EN'] as const;
export type Language = (typeof LANGUAGES)[number];

export const SMS_STATUSES = ['SIMULATED', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED'] as const;
export type SmsStatus = (typeof SMS_STATUSES)[number];

export interface HealthResponse {
  ok: boolean;
  db: boolean;
  time: string;
}

// ─── Hospital and departments ───────────────────────────────────────────────

export interface QueueSettings {
  defaultConsultMinutes: number;
  getReadyAhead: number;
  graceMinutes: number;
}

export interface HospitalSettings extends QueueSettings {
  id: string;
  name: string;
  district: string;
  smsSenderId: string;
  feedbackSmsEnabled: boolean;
}

export interface DepartmentSummary {
  id: string;
  code: string;
  kind: DepartmentKind;
  nameEn: string;
  nameRw: string;
  prefix: string;
  avgMinutes: number;
  isOpen: boolean;
  opensAt: string;
  closesAt: string;
  locationEn: string;
  locationRw: string;
  waitingCount: number;
  servingCount: number;
  availableStaff: number;
  /** Estimated wait for someone registering now; null = no one available to serve. */
  estimateMinutes: number | null;
  nowServing: string | null;
}

/** Full department record for the admin screen. */
export interface DepartmentAdmin {
  id: string;
  code: string;
  kind: DepartmentKind;
  nameEn: string;
  nameRw: string;
  prefix: string;
  avgMinutes: number | null;
  isOpen: boolean;
  opensAt: string;
  closesAt: string;
  locationEn: string;
  locationRw: string;
  requirementsEn: string;
  requirementsRw: string;
  showOnTv: boolean;
  sortOrder: number;
}

export interface RoomView {
  id: string;
  name: string;
  departmentId: string | null;
  departmentCode: string | null;
  active: boolean;
  staffNames: string[];
}

// ─── Staff ──────────────────────────────────────────────────────────────────

export interface StaffPublic {
  id: string;
  fullName: string;
  title: string;
  role: StaffRole;
  status: StaffStatus;
  backAt: string | null;
  departmentId: string | null;
  departmentCode: string | null;
  departmentNameEn: string | null;
  roomName: string | null;
  /** Ticket the staff member is serving right now, if any. */
  currentTicketNumber: string | null;
}

export interface StaffMe extends StaffPublic {
  email: string;
  hospital: { id: string; name: string };
}

export interface StaffAdminView extends StaffPublic {
  email: string;
  active: boolean;
  roomId: string | null;
  /** True until the person has set a password from their invite link. */
  invitePending: boolean;
  lastLoginAt: string | null;
}

export interface LoginResponse {
  token: string;
  staff: StaffMe;
}

// ─── Queue (staff views) ────────────────────────────────────────────────────

/** A ticket as clinicians and counters see it. Never contains a phone number. */
export interface QueueEntry {
  id: string;
  number: string;
  status: TicketStatus;
  priority: Priority;
  priorityReason: PriorityReason;
  channel: Channel;
  displayName: string;
  language: Language;
  departmentId: string;
  departmentCode: string;
  note: string | null;
  sortKey: number;
  joinedAt: string;
  calledAt: string | null;
  startedAt: string | null;
  staffId: string | null;
  staffName: string | null;
  roomName: string | null;
  /** The ticket this one was referred from, e.g. "OPD-024". */
  fromNumber: string | null;
}

/** Reception only: adds the phone number and the patient link token (for reprinting). */
export interface ReceptionEntry extends QueueEntry {
  phone: string | null;
  publicToken: string;
}

export interface DepartmentQueue {
  department: DepartmentSummary;
  waiting: QueueEntry[] | ReceptionEntry[];
  serving: QueueEntry[] | ReceptionEntry[];
  staff: StaffPublic[];
  /** Minutes after a call before no-show is allowed (hospital setting). */
  graceMinutes: number;
}

export interface RegisterResult {
  ticket: ReceptionEntry;
  peopleAhead: number;
  estimateMinutes: number | null;
  patientUrl: string;
}

export interface MyQueueView {
  me: StaffPublic;
  current: QueueEntry | null;
  queue: QueueEntry[];
  todayCount: number;
  graceMinutes: number;
  /** Departments this counter can send a patient to next. */
  nextStepTargets: { id: string; code: string; nameEn: string; kind: DepartmentKind; isOpen: boolean }[];
}

// ─── Patient ticket page (public, by token) ─────────────────────────────────

export type JourneyStepKey = 'RECEPTION' | 'CONSULTATION' | 'NEXT_STEPS' | 'DONE';
export type JourneyStepState = 'done' | 'current' | 'upcoming';

export interface JourneyStep {
  key: JourneyStepKey;
  state: JourneyStepState;
  /** Tickets that belong to this step, e.g. LAB-004, PHA-012. */
  tickets: { number: string; nameEn: string; nameRw: string; status: TicketStatus }[];
}

export interface PublicTicketView {
  token: string;
  number: string;
  status: TicketStatus;
  displayName: string;
  language: Language;
  hospital: { id: string; name: string };
  department: {
    id: string;
    code: string;
    kind: DepartmentKind;
    nameEn: string;
    nameRw: string;
    locationEn: string;
    locationRw: string;
    requirementsEn: string[];
    requirementsRw: string[];
  };
  peopleAhead: number;
  estimateMinutes: number | null;
  /** 0 when the ticket was issued, 1 when it is the patient's turn. */
  progress: number;
  staff: { available: number; onDuty: number };
  room: string | null;
  staffName: string | null;
  calledAt: string | null;
  nextTicket: { token: string; number: string; nameEn: string; nameRw: string; locationEn: string; locationRw: string } | null;
  journey: JourneyStep[];
  smsEnabled: boolean;
  visitFinishedAt: string | null;
  serverTime: string;
}

// ─── Waiting-room TV ────────────────────────────────────────────────────────

export interface CallView {
  ticketNumber: string;
  room: string;
  staffName: string;
  at: string;
}

export interface TvView {
  hospital: { id: string; name: string };
  calls: CallView[];
  departments: { code: string; nameEn: string; nameRw: string; nowServing: string | null; next: string[]; waitingCount: number }[];
  staff: { id: string; fullName: string; status: StaffStatus; roomName: string | null; departmentCode: string | null }[];
  serverTime: string;
}

// ─── Audit, SMS, analytics ──────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  actorName: string | null;
  ticketNumber: string | null;
  reason: string | null;
  detail: string | null;
}

export interface SmsView {
  id: string;
  at: string;
  /** Masked for everyone except the dev panel in simulate mode, e.g. "+250 78* *** 456". */
  to: string;
  template: string;
  language: Language;
  body: string;
  status: SmsStatus;
  attempts: number;
  error: string | null;
  ticketNumber: string | null;
}

export interface StageStat {
  stage: 'WAIT' | 'SERVICE';
  departmentCode: string;
  departmentNameEn: string;
  medianMinutes: number | null;
  p90Minutes: number | null;
  count: number;
}

export interface AnalyticsView {
  from: string;
  to: string;
  totals: { tickets: number; visits: number; completedVisits: number; noShows: number; noShowRate: number | null };
  medianVisitMinutes: number | null;
  stages: StageStat[];
  perHour: { hour: number; count: number }[];
  feedback: { asked: number; yes: number; no: number; score: number | null };
  trend: { date: string; tickets: number; medianWaitMinutes: number | null; noShowRate: number | null }[];
}

export interface JobRunView {
  id: string;
  job: string;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  summary: string | null;
}
