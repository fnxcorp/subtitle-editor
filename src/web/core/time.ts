// Timecodes and frames.
import { settings } from './settings.ts';
import { state } from './state.ts';

export const p2 = (n: number): string => String(n).padStart(2, '0');

// 3725.5 → "01:02:05,500" (SRT); sep '.' for WebVTT and display
export function fmt(t: number, sep = ','): string {
  if (!isFinite(t) || t < 0) t = 0;
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${p2(h)}:${p2(m)}:${p2(s)}${sep}${String(ms % 1000).padStart(3, '0')}`;
}

// "01:02:05,5" / "2:05.5" / "00:01:02" → seconds (NaN if invalid)
export function parseTime(str: string): number {
  const m = String(str).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?$/);
  if (!m) return NaN;
  return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? +m[4].padEnd(3, '0') / 1000 : 0);
}

export const fps = () => settings.fps || state.fpsDetected || 25;
export const gapSec = () => settings.minGapFrames / fps();
export const frameOf = (t: number): number => Math.floor(t * fps() + 1e-6);
