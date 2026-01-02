/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { LOCALE_DATE_FORMATS, LOCALE_LABELS, translations, type Locale } from '../i18n/strings';

const STORAGE_KEY = 'edrsr-ai-locale';

type LocaleContextValue = {
  locale: Locale;
  dateLocale: string;
  labels: typeof LOCALE_LABELS;
  setLocale: (next: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function resolveLocale(): Locale {
  const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
  if (stored === 'uk' || stored === 'ru') return stored;
  const browser = typeof navigator !== 'undefined' ? navigator.language : '';
  if (browser?.toLowerCase().startsWith('ru')) return 'ru';
  return 'uk';
}

function getValue(obj: Record<string, unknown>, path: string): string | null {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current === 'string') return current;
  return null;
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(resolveLocale);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, locale);
    }
  }, [locale]);

  const value = useMemo<LocaleContextValue>(() => {
    const dictionary = translations[locale] as Record<string, unknown>;
    const dateLocale = LOCALE_DATE_FORMATS[locale] || 'uk-UA';
    const t = (key: string, params?: Record<string, string | number>) => {
      const template = getValue(dictionary, key) || getValue(translations.uk, key) || key;
      if (!params) return template;
      return Object.keys(params).reduce((acc, paramKey) => {
        const val = String(params[paramKey]);
        return acc.replace(new RegExp(`{{${paramKey}}}`, 'g'), val);
      }, template);
    };
    return {
      locale,
      dateLocale,
      labels: LOCALE_LABELS,
      setLocale,
      t,
    };
  }, [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used inside LocaleProvider');
  return ctx;
}
