/* i18next set-up: English and European Portuguese, saved choice, and helpers for registry names. */
import i18next from 'i18next';
import { en, pt, type Key } from './strings';

export type Lang = 'en' | 'pt-PT';
const saved = (() => { try { return localStorage.getItem('mye-lang') as Lang | null; } catch { return null; } })();
const guess: Lang = saved ?? (navigator.language?.toLowerCase().startsWith('pt') ? 'pt-PT' : 'en');

i18next.init({ lng: guess, fallbackLng: 'en', resources: { en: { translation: en }, 'pt-PT': { translation: pt } }, interpolation: { escapeValue: false }, initImmediate: false } as any);

export const t = (k: Key, vars?: Record<string, string | number>) => i18next.t(k, vars as any) as string;
export const lang = () => i18next.language as Lang;
const listeners = new Set<() => void>();
export function setLang(l: Lang) { i18next.changeLanguage(l); try { localStorage.setItem('mye-lang', l); } catch { /* private mode */ } document.documentElement.lang = l; listeners.forEach(f => f()); }
export const onLang = (f: () => void) => { listeners.add(f); return () => listeners.delete(f); };
/** names of blocks, items, biomes and animals live in the registries as { en, pt } */
export const nm = (o: { en: string; pt: string } | undefined) => (o ? (lang() === 'pt-PT' ? o.pt : o.en) : '?');
document.documentElement.lang = guess;
