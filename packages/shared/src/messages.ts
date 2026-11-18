// Bilingual SMS templates. Every rendered SMS must fit in ONE GSM-7 segment (160 characters),
// so a patient never pays for, or receives, a message split in two.
import { en, type SmsVars } from './i18n/en';
import { rw } from './i18n/rw';
import type { Language } from './types';

export const SMS_TEMPLATES = ['JOINED', 'GET_READY', 'CALLED', 'NEXT_STEP', 'WAIT_CHANGED', 'FEEDBACK', 'DAY_CLOSED'] as const;
export type SmsTemplate = (typeof SMS_TEMPLATES)[number];

export const SMS_MAX_LENGTH = 160;

/**
 * Longest values the admin screens accept for the fields that appear in SMS.
 * The SMS tests render every template with values this long.
 */
export const SMS_FIELD_LIMITS = {
  ticketNumber: 8, // prefix up to 4 letters + "-" + 3 digits
  departmentName: 36,
  roomName: 24,
  hospitalName: 36,
  link: 48,
  count: 3, // people ahead, minutes
} as const;

const dict = { EN: en, RW: rw } as const;

// GSM 03.38 basic alphabet plus the extension table (extension characters count as 2).
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = '^{}\\[~]|€';

/** Replaces common "smart" characters with GSM-7 equivalents so the SMS is not sent as Unicode. */
export function toGsm7(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u00A0\u2009\u202F]/g, ' ')
    .replace(/\u00B7/g, '-');
}

export function isGsm7(text: string): boolean {
  for (const ch of text) if (!GSM_BASIC.includes(ch) && !GSM_EXTENDED.includes(ch)) return false;
  return true;
}

/** Length as the network counts it: GSM extension characters take two septets. */
export function gsm7Length(text: string): number {
  let n = 0;
  for (const ch of text) n += GSM_EXTENDED.includes(ch) ? 2 : 1;
  return n;
}

/** The wait fragment used inside templates, e.g. "hafi iminota 12" or "no doctor available right now". */
export function waitPhrase(language: Language, minutes: number | null): string {
  const m = dict[language].sms;
  return minutes === null ? m.waitNoStaff : m.waitMinutes(minutes);
}

export interface RenderedSms {
  text: string;
  length: number;
  gsm7: boolean;
  fits: boolean;
}

export function renderSms(template: SmsTemplate, language: Language, vars: SmsVars): RenderedSms {
  const text = toGsm7(dict[language].sms[template](vars));
  const gsm7 = isGsm7(text);
  const length = gsm7 ? gsm7Length(text) : text.length;
  return { text, length, gsm7, fits: gsm7 && length <= SMS_MAX_LENGTH };
}

export function feedbackThanks(language: Language): string {
  return toGsm7(dict[language].sms.FEEDBACK_THANKS);
}

/** Example values used by the admin preview and by the tests (worst case = every field at its limit). */
export function sampleSmsVars(worstCase = false): Required<SmsVars> {
  const L = SMS_FIELD_LIMITS;
  if (!worstCase) {
    return {
      number: 'OPD-024',
      ahead: 4,
      wait: 'about 25 min',
      room: 'Room 3',
      dept: 'General consultation',
      link: 'https://umurongo.rw/t/k3J9xQ2mZp7Lr0aW5bYc1d',
      hospital: 'Masaka Hospital',
      day: 'tomorrow',
      time: '07:00',
    };
  }
  return {
    number: 'ABCD-999',
    ahead: 999,
    wait: '',
    room: 'R'.repeat(L.roomName),
    dept: 'D'.repeat(L.departmentName),
    link: 'https://' + 'x'.repeat(L.link - 8),
    hospital: 'H'.repeat(L.hospitalName),
    day: 'tomorrow',
    time: '07:00',
  };
}

/** Parses a feedback reply ("1", " 2 ", "1 yego") into yes/no, or null when unclear. */
export function parseFeedbackReply(text: string): 'YES' | 'NO' | null {
  const first = text.trim().toLowerCase().split(/\s+/)[0] ?? '';
  if (['1', 'yego', 'yes', 'y'].includes(first)) return 'YES';
  if (['2', 'oya', 'no', 'n'].includes(first)) return 'NO';
  return null;
}
