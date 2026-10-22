// Line balancing: re-wraps a subtitle into lines of similar length.
import { settings } from './settings.ts';
import { plainText } from './text.ts';

// Words a line should not end with (Spanish and English)
const WEAK_WORDS = new Set(('a al ante bajo con contra de del desde e el en entre hacia hasta la las le les lo los me mi mis ' +
  'ni no o para por que se si sin su sus te tu tus u un una unos unas y muy más ' +
  'the an of to and or in on at for with by my your his her its our their is as if but so than that this these those from into').split(' '));

export function balanceText(text: string, maxChars: number = settings.maxChars): string {
  if (!text || !text.trim()) return text;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  // Dialogue (each line starts with a dash): leave as is
  if (lines.length > 1 && lines.every(l => /^[-–—]/.test(plainText(l)))) return lines.join('\n');
  const flat = lines.join(' ').replace(/\s{2,}/g, ' ');
  if (plainText(flat).length <= maxChars) return flat;
  const words = flat.split(' ');
  let best: { score: number; text: string } | null = null;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(' '), b = words.slice(k).join(' ');
    const la = plainText(a).length, lb = plainText(b).length;
    let score = Math.abs(la - lb);
    if (la > maxChars) score += (la - maxChars) * 10;
    if (lb > maxChars) score += (lb - maxChars) * 10;
    const last = plainText(words[k - 1]);
    if (WEAK_WORDS.has(last.toLowerCase().replace(/[^\p{L}]/gu, ''))) score += 12;
    if (/[,.;:?!…)»"]$/.test(last)) score -= 8;
    if (la > lb) score += 2; // prefer a slightly shorter first line (pyramid shape)
    if (!best || score < best.score) best = { score, text: `${a}\n${b}` };
  }
  return best ? best.text : flat;
}
