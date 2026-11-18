import { describe, expect, it } from 'vitest';
import {
  SMS_MAX_LENGTH,
  SMS_TEMPLATES,
  gsm7Length,
  isGsm7,
  parseFeedbackReply,
  renderSms,
  sampleSmsVars,
  toGsm7,
  waitPhrase,
} from './messages';
import { en } from './i18n/en';
import { rw } from './i18n/rw';
import type { Language } from './types';

const LANGS: Language[] = ['RW', 'EN'];

/** The longest value each language can put in {wait} and {day}. */
function longest(language: Language) {
  const d = language === 'RW' ? rw : en;
  const wait = [waitPhrase(language, 999), waitPhrase(language, null)].sort((a, b) => b.length - a.length)[0];
  const day = [d.days.today, d.days.tomorrow].sort((a, b) => b.length - a.length)[0];
  return { wait, day };
}

describe('SMS templates', () => {
  for (const language of LANGS) {
    for (const template of SMS_TEMPLATES) {
      it(`${template} (${language}) fits in one GSM-7 SMS with every field at its limit`, () => {
        const sms = renderSms(template, language, { ...sampleSmsVars(true), ...longest(language) });
        expect(sms.gsm7, sms.text).toBe(true);
        expect(sms.length, sms.text).toBeLessThanOrEqual(SMS_MAX_LENGTH);
        expect(sms.fits).toBe(true);
      });
    }
  }

  it('renders the variables into the text', () => {
    const sms = renderSms('CALLED', 'EN', { number: 'OPD-024', room: 'Room 3' });
    expect(sms.text).toBe('Umurongo: It is your turn! OPD-024, please go to Room 3 now.');
    expect(renderSms('JOINED', 'RW', { ...sampleSmsVars(), wait: waitPhrase('RW', 25) }).text).toContain('hafi iminota 25');
  });

  it('says when no doctor is available instead of a number', () => {
    expect(waitPhrase('EN', null)).toBe('no doctor available right now');
    expect(waitPhrase('RW', null)).toBe('nta muganga uhari ubu');
  });

  it('turns smart punctuation into GSM-7 and flags real Unicode', () => {
    expect(toGsm7('Ubuvuzi bw’amenyo – Room “3”…')).toBe('Ubuvuzi bw\'amenyo - Room "3"...');
    expect(isGsm7('Itike OPD-024')).toBe(true);
    expect(isGsm7('Ubuvuzi bw’amenyo')).toBe(false);
    expect(gsm7Length('a€b')).toBe(4);
    const unicode = renderSms('CALLED', 'EN', { number: 'OPD-001', room: 'Salle 😊' });
    expect(unicode.gsm7).toBe(false);
    expect(unicode.fits).toBe(false);
  });

  it('reads feedback replies', () => {
    expect(parseFeedbackReply(' 1 ')).toBe('YES');
    expect(parseFeedbackReply('Yego cyane')).toBe('YES');
    expect(parseFeedbackReply('2')).toBe('NO');
    expect(parseFeedbackReply('oya')).toBe('NO');
    expect(parseFeedbackReply('maybe')).toBeNull();
    expect(parseFeedbackReply('')).toBeNull();
  });
});

describe('translations', () => {
  const keys = (o: object, prefix = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    );

  it('Kinyarwanda has every English key', () => {
    expect(keys(rw).sort()).toEqual(keys(en).sort());
    expect(rw.tv.messages).toHaveLength(en.tv.messages.length);
  });

  it('has no em dashes or curly apostrophes', () => {
    const all = JSON.stringify([en, rw]) + Object.values(en.sms).concat(Object.values(rw.sms)).map(String).join();
    expect(all).not.toMatch(/[\u2014\u2019]/);
  });
});
