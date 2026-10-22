// Subtitle text helpers (no DOM).
import { settings } from './settings.ts';
import { state } from './state.ts';
import type { Cue, Field } from './types.ts';

// Strips <i>-style tags and {\an8}-style ASS overrides
export const plainText = (t: string | undefined): string => (t || '').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '');
export const cueText = (c: Cue, field: Field): string => (field === 'tr' ? c.tr || '' : c.text);
// The text being produced: the translation in translation mode, otherwise the original
export const visibleField = (): Field => (settings.translation ? 'tr' : 'text');
export const hasTranslation = () => state.cues.some(c => c.tr && c.tr.trim());

export function escapeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Subtitle text → safe HTML that keeps <i>, <b> and <u>
export function safeHtml(t: string): string {
  return escapeHtml(t.replace(/\{\\[^}]*\}/g, ''))
    .replace(/&lt;(\/?)(i|b|u)&gt;/gi, '<$1$2>')
    .replace(/\n/g, '<br>');
}

export function joinTexts(a: string | undefined, b: string | undefined, sep = ' '): string {
  a = (a || '').trimEnd();
  b = (b || '').trimStart();
  return a && b ? a + sep + b : a + b;
}

// Splits a text at the space closest to the given ratio (0..1)
export function splitTextAtRatio(text: string | undefined, ratio: number): [string, string] {
  if (!text) return ['', ''];
  const flat = text.replace(/\s*\n\s*/g, ' ');
  const target = flat.length * ratio;
  let best = -1;
  for (let i = 0; i < flat.length; i++) if (flat[i] === ' ' && (best < 0 || Math.abs(i - target) < Math.abs(best - target))) best = i;
  if (best < 0) return ratio < 0.5 ? ['', flat] : [flat, ''];
  return [flat.slice(0, best).trim(), flat.slice(best + 1).trim()];
}
