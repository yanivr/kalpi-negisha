import he, { type Dict } from './he';
import ar from './ar';
import ru from './ru';
import am from './am';

export const LOCALES = ['he', 'ar', 'ru', 'am'] as const;
export type Locale = (typeof LOCALES)[number];
export const DICTS: Record<Locale, Dict> = { he, ar, ru, am };
export type { Dict };
export type TextKey = { [K in keyof Dict]: Dict[K] extends string ? K : never }[keyof Dict];

export function isLocale(x: string | undefined | null): x is Locale {
  return !!x && (LOCALES as readonly string[]).includes(x);
}

/** Simple, safe interpolation: values are inserted as text (React escapes them); unknown placeholders stay visible. */
export function format(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function formatDateTime(iso: string | null, locale: Locale): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(DICTS[locale].htmlLang, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jerusalem',
    calendar: 'gregory',
    numberingSystem: 'latn',
  }).format(d);
}

export function formatDate(iso: string | null, locale: Locale): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(DICTS[locale].htmlLang, {
    dateStyle: 'medium',
    timeZone: 'Asia/Jerusalem',
    calendar: 'gregory',
    numberingSystem: 'latn',
  }).format(d);
}

export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(DICTS[locale].htmlLang, { numberingSystem: 'latn' }).format(n);
}
