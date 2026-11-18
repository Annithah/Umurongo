// Zod schemas shared by the routes. Every request body, query and path parameter is validated.
import { z } from 'zod';
import {
  DEPARTMENT_KINDS,
  LANGUAGES,
  PRIORITIES,
  PRIORITY_REASONS,
  SMS_FIELD_LIMITS,
  STAFF_ROLES,
  STAFF_STATUSES,
  isGsm7,
  isValidClock,
  isValidDisplayName,
  normalizeRwandaPhone,
  toGsm7,
} from '@umurongo/shared';
import { PUBLIC_TOKEN } from '../tokens';

export const id = z.string().min(1).max(64).regex(/^[\w-]+$/, 'Invalid id');
export const idParam = z.object({ id });
export const tokenParam = z.object({ token: z.string().regex(PUBLIC_TOKEN, 'Invalid link') });

export const reason = z.string().trim().min(3, 'Please give a reason (at least 3 characters)').max(200);

export const displayName = z
  .string()
  .trim()
  .refine(isValidDisplayName, 'Use a first name or initials only (max 20 characters), e.g. "Aline" or "J. B."');

export const phone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (!v) return null;
    const n = normalizeRwandaPhone(v);
    if (!n) ctx.addIssue({ code: 'custom', message: 'Enter a Rwandan mobile number, e.g. 0788 123 456' });
    return n;
  });

export const language = z.enum(LANGUAGES);
export const priority = z.enum(PRIORITIES);
export const priorityReason = z.enum(PRIORITY_REASONS);
export const staffStatus = z.enum(STAFF_STATUSES);
export const staffRole = z.enum(STAFF_ROLES);

/** Rule: PRIORITY needs a reason (pregnant, elderly 65+, disability, child under 5); NORMAL and EMERGENCY have none. */
export const priorityPair = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({ ...shape, priority: priority.default('NORMAL'), priorityReason: priorityReason.default('NONE') })
    .refine((v) => (v.priority === 'PRIORITY') === (v.priorityReason !== 'NONE'), {
      message: 'Choose a reason for Priority (and none for Normal or Emergency)',
      path: ['priorityReason'],
    });

export const walkInBody = priorityPair({
  departmentId: id,
  displayName,
  phone: phone.optional().default(''),
  language: language.default('RW'),
  note: z.string().trim().max(200).optional(),
});

export const statusBody = z.object({
  status: staffStatus,
  backAt: z.string().datetime().nullish(),
});

/** Text that appears in SMS must be GSM-7 and short enough (see SMS_FIELD_LIMITS in packages/shared). */
const smsText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max, `${label}: at most ${max} characters so SMS fit in one message`)
    .transform(toGsm7)
    .refine(isGsm7, `${label}: use plain letters (no emoji or special symbols) so SMS stay cheap`);

const clock = z.string().refine(isValidClock, 'Use HH:MM, e.g. 07:00');

export const departmentBody = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}$/, 'Code: 2 to 4 letters'),
    prefix: z.string().trim().toUpperCase().regex(/^[A-Z]{1,4}$/, 'Prefix: 1 to 4 letters'),
    kind: z.enum(DEPARTMENT_KINDS),
    nameEn: smsText(SMS_FIELD_LIMITS.departmentName, 'English name'),
    nameRw: smsText(SMS_FIELD_LIMITS.departmentName, 'Kinyarwanda name'),
    avgMinutes: z.number().int().min(1).max(240).nullable(),
    isOpen: z.boolean(),
    opensAt: clock,
    closesAt: clock,
    locationEn: z.string().trim().max(80),
    locationRw: z.string().trim().max(80),
    requirementsEn: z.string().trim().max(1000),
    requirementsRw: z.string().trim().max(1000),
    showOnTv: z.boolean(),
    sortOrder: z.number().int().min(0).max(999),
  })
  .refine((d) => d.opensAt === d.closesAt || d.opensAt < d.closesAt || d.closesAt === '24:00', {
    message: 'Closing time must be after opening time',
    path: ['closesAt'],
  });

export const roomBody = z.object({
  name: smsText(SMS_FIELD_LIMITS.roomName, 'Room name'),
  departmentId: id.nullable(),
  active: z.boolean().default(true),
});

export const staffBody = z.object({
  fullName: z.string().trim().min(2).max(60),
  email: z.string().trim().toLowerCase().email().max(120),
  role: staffRole,
  title: z.string().trim().max(60).default(''),
  departmentId: id.nullable(),
  roomId: id.nullable(),
  active: z.boolean().default(true),
});

export const settingsBody = z.object({
  name: smsText(SMS_FIELD_LIMITS.hospitalName, 'Hospital name'),
  district: z.string().trim().min(1).max(60),
  smsSenderId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9 ]{1,11}$/, 'Sender ID: up to 11 letters or digits'),
  feedbackSmsEnabled: z.boolean(),
  defaultConsultMinutes: z.number().int().min(1).max(240),
  getReadyAhead: z.number().int().min(1).max(20),
  graceMinutes: z.number().int().min(1).max(60),
  retentionDays: z.number().int().min(1).max(365),
});

export const password = z.string().min(10, 'Use at least 10 characters').max(200);
