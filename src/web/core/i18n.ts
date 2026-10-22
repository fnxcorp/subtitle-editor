// Translations. All visible text lives in public/locales/<lang>.json.
// To add a language: copy en.json, translate it and add its code to LANGS.
import { settings } from './settings.ts';

export const LANGS = ['en', 'es'];
type Dict = { [key: string]: string | Dict };
export type Vars = Record<string, string | number>;

export const I18N: { lang: string; dict: Dict; fallback: Dict } = { lang: 'en', dict: {}, fallback: {} };

// T('toast.merged', { n: 3 }) — { one, other } values are plurals picked with vars.n.
// Uppercase on purpose: many functions use a local `t` for time.
export function T(key: string, vars: Vars = {}): string {
  const get = (d: Dict) => key.split('.').reduce<string | Dict | undefined>((o, k) => (o == null || typeof o === 'string' ? undefined : o[k]), d);
  let v = get(I18N.dict) ?? get(I18N.fallback) ?? key;
  if (typeof v === 'object') v = v[new Intl.PluralRules(I18N.lang).select(Number(vars.n ?? 0))] ?? v.other;
  return String(v).replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

// Translates elements marked with data-i18n, data-i18n-html, data-i18n-title, data-i18n-placeholder
export function applyI18n(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { el.textContent = T(el.dataset.i18n!); });
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach(el => { el.innerHTML = T(el.dataset.i18nHtml!); });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => { el.title = T(el.dataset.i18nTitle!); });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach(el => { el.placeholder = T(el.dataset.i18nPlaceholder!); });
}

export async function loadLanguage(lang = settings.lang) {
  if (!LANGS.includes(lang)) lang = 'en';
  I18N.lang = lang;
  document.documentElement.lang = lang;
  const load = (l: string): Promise<Dict> => fetch(new URL(`../../locales/${l}.json`, import.meta.url)).then(r => r.json());
  // shortcut: if the JSON can't be loaded (e.g. opening index.html as a file) raw keys are shown; always start with npm start
  try { I18N.fallback = await load('en'); } catch {}
  try { I18N.dict = lang === 'en' ? I18N.fallback : await load(lang); } catch { I18N.dict = I18N.fallback; }
  applyI18n();
}
