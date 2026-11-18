// Rwandan mobile numbers: MTN 078/079, Airtel 072/073. Stored as E.164, e.g. +250788123456.
const RW_MOBILE = /^(?:\+?250|0)?(7[2389]\d{7})$/;

/** Normalises "0788 123 456", "250788123456" or "+250 788-123-456" to "+250788123456". Null if invalid. */
export function normalizeRwandaPhone(input: string): string | null {
  const m = RW_MOBILE.exec(input.replace(/[\s().-]/g, ''));
  return m ? `+250${m[1]}` : null;
}

/** "+250788123456" -> "+250 78* *** 456". For lists where the full number is not needed. */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const d = e164.replace(/\D/g, '');
  if (d.length < 6) return '***';
  return `+${d.slice(0, 3)} ${d.slice(3, 5)}* *** ${d.slice(-3)}`;
}

/** "+250788123456" -> "0788 123 456", the way Rwandans write it. */
export function formatRwandaPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+250(7\d{2})(\d{3})(\d{3})$/.exec(e164);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : e164;
}

/** Rule: display name = first name or initials. Letters, spaces, dots, hyphens and apostrophes, 1-20 characters. */
export const DISPLAY_NAME_PATTERN = /^[\p{L}][\p{L} .'-]{0,19}$/u;

export function isValidDisplayName(name: string): boolean {
  const n = name.trim();
  // Two or more words longer than an initial look like a full name: ask for the first name only.
  const longWords = n.split(/\s+/).filter((w) => w.replace(/\./g, '').length > 1);
  return DISPLAY_NAME_PATTERN.test(n) && longWords.length <= 1;
}
