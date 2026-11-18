// Patient-facing language: Kinyarwanda by default, English on request.
// All strings live in packages/shared/src/i18n (rw.ts is the single Kinyarwanda file).
// Staff screens are English only and do not use this.
import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { en, rw, type Language, type Messages } from '@umurongo/shared';

const KEY = 'umurongo.lang';

function stored(): Language | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'EN' || v === 'RW' ? v : null;
  } catch {
    return null;
  }
}

export const dictionaries: Record<Language, Messages> = { RW: rw, EN: en };

interface I18n {
  lang: Language;
  t: Messages;
  setLang: (l: Language) => void;
  /** Picks the Kinyarwanda or English field of a record, e.g. pick(dept, 'name'). */
  pick: <K extends string>(o: Record<`${K}Rw` | `${K}En`, string>, key: K) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Language }) {
  const [lang, setLangState] = useState<Language>(() => stored() ?? initial ?? 'RW');
  const setLang = useCallback((l: Language) => {
    setLangState(l);
    try {
      window.localStorage.setItem(KEY, l);
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
    document.documentElement.lang = l === 'RW' ? 'rw' : 'en';
  }, []);
  const value = useMemo<I18n>(
    () => ({
      lang,
      t: dictionaries[lang],
      setLang,
      pick: (o, key) => (lang === 'RW' ? o[`${key}Rw` as `${typeof key}Rw`] : o[`${key}En` as `${typeof key}En`]),
    }),
    [lang, setLang],
  );
  return createElement(Ctx.Provider, { value }, children);
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}
