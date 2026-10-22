// SRT / WebVTT parsing and export.
import { MIN_DUR, state } from './state.ts';
import { settings } from './settings.ts';
import { fmt, fps, parseTime } from './time.ts';
import { cueText } from './text.ts';
import { newCue } from './cues.ts';
import type { Cue, Field } from './types.ts';

const TIMING_RE = /((?:\d+:)?\d{1,2}:\d{1,2}(?:[,.]\d{1,3})?)\s*-->\s*((?:\d+:)?\d{1,2}:\d{1,2}(?:[,.]\d{1,3})?)/;

// Tolerant parser: SRT or WebVTT, BOM, CRLF, missing blank lines, {\an8} / line:5% for top position
export function parseSubs(text: string): Cue[] {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const out: Cue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TIMING_RE);
    if (!m) continue;
    const vttLine = lines[i].match(/\bline:\s*(\d{1,3})%/);
    const body: string[] = [];
    while (i + 1 < lines.length && lines[i + 1].trim() !== '') {
      if (/^\d+$/.test(lines[i + 1].trim()) && TIMING_RE.test(lines[i + 2] || '')) break;
      if (TIMING_RE.test(lines[i + 1])) break;
      body.push(lines[++i]);
    }
    let txt = body.join('\n');
    const extra: Partial<Cue> = {};
    const an = txt.match(/^\{\\an(\d)\}/);
    if (an) {
      if ('789'.includes(an[1])) extra.top = true;
      txt = txt.replace(/^\{\\an\d\}/, '');
    }
    if (vttLine && +vttLine[1] < 50) extra.top = true;
    const start = parseTime(m[1]), end = parseTime(m[2]);
    if (isFinite(start) && isFinite(end)) out.push(newCue(start, Math.max(end, start + MIN_DUR), txt, extra));
  }
  return out;
}

const exportTime = (t: number) => (settings.frameExport ? Math.round(t * fps()) / fps() : t);

export function toSRT(field: Field = 'text', cues: Cue[] = state.cues): string {
  return cues.map((c, i) =>
    `${i + 1}\n${fmt(exportTime(c.start))} --> ${fmt(exportTime(c.end))}\n${c.top ? '{\\an8}' : ''}${cueText(c, field)}\n`).join('\n');
}

export function toVTT(field: Field = 'text', cues: Cue[] = state.cues): string {
  return 'WEBVTT\n\n' + cues.map(c =>
    `${fmt(exportTime(c.start), '.')} --> ${fmt(exportTime(c.end), '.')}${c.top ? ' line:5%' : ''}\n${cueText(c, field)}\n`).join('\n');
}
