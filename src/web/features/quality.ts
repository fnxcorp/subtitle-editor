// Quality checks: reading speed, line length, duration, gaps, overlaps and shot changes.
// Every check returns { type, level, msg, fix? }; applyFix() knows how to fix each `fix`.
import { MIN_DUR, state } from '../core/state.ts';
import { settings } from '../core/settings.ts';
import { fps, gapSec } from '../core/time.ts';
import { cueText, plainText, visibleField } from '../core/text.ts';
import { indexOf, selected, pushHistory, sortCues, commit } from '../core/cues.ts';
import { balanceText } from '../core/balance.ts';
import { T } from '../core/i18n.ts';
import { $ } from '../ui/dom.ts';
import { toast } from '../ui/toast.ts';
import { select } from './list.ts';
import { seek } from './playback.ts';
import { setView } from './review.ts';
import type { Cue, Field, FixKind, Issue } from '../core/types.ts';

// level: 0 = fine, 1 = fast (amber), 2 = unreadable (red)
export function readingStats(c: Cue, field: Field = visibleField()) {
  const dur = c.end - c.start;
  const chars = plainText(cueText(c, field)).replace(/\s+/g, ' ').trim().length;
  const cps = dur > 0 ? chars / dur : Infinity;
  const level = !chars ? 0 : cps > settings.maxCps * 1.25 ? 2 : cps > settings.maxCps ? 1 : 0;
  return { dur, chars, cps, level, needed: chars / settings.maxCps };
}

export function nearestCut(t: number): number | null {
  const cuts = state.cuts;
  if (!cuts.length) return null;
  let lo = 0, hi = cuts.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cuts[mid] < t) lo = mid + 1; else hi = mid; }
  const cands = [cuts[lo], cuts[lo - 1]].filter(x => x !== undefined);
  return cands.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
}

// Returns a subtitle's problems, with their automatic fix when there is one
export function cueIssues(i: number): Issue[] {
  const c = state.cues[i], next = state.cues[i + 1];
  const field = visibleField();
  const txt = plainText(cueText(c, field));
  const out: Issue[] = [];
  const g = gapSec();
  const f = fps();
  const dur = c.end - c.start;
  const room = next ? next.start - g - c.start : Infinity;

  if (!txt.trim()) {
    out.push({ type: 'empty', level: 1, msg: field === 'tr' ? T('issue.notTranslated') : T('issue.empty'), fix: field === 'tr' ? null : 'delete' });
  }
  const rs = readingStats(c);
  if (rs.level) {
    out.push({ type: 'speed', level: rs.level as 1 | 2,
      msg: T('issue.speed', { dur: dur.toFixed(2), cps: rs.cps.toFixed(1), max: settings.maxCps, needed: rs.needed.toFixed(1) }),
      fix: room > dur + 0.05 ? 'extend' : null });
  }
  const lines = txt.split('\n');
  const longest = Math.max(0, ...lines.map(l => l.length));
  const flatLen = txt.replace(/\s+/g, ' ').trim().length;
  if (lines.length > settings.maxLines) {
    out.push({ type: 'lines', level: 1, msg: T('issue.lines', { n: lines.length, max: settings.maxLines }), fix: flatLen <= settings.maxChars * settings.maxLines ? 'balance' : null });
  }
  if (longest > settings.maxChars) {
    out.push({ type: 'chars', level: 1, msg: T('issue.chars', { n: longest, max: settings.maxChars }), fix: flatLen <= settings.maxChars * settings.maxLines ? 'balance' : null });
  }
  if (dur < settings.minDur) {
    out.push({ type: 'short', level: 1, msg: T('issue.short', { dur: dur.toFixed(2), min: settings.minDur }), fix: room >= settings.minDur ? 'minDur' : null });
  }
  if (dur > settings.maxDur) {
    out.push({ type: 'long', level: 1, msg: T('issue.long', { dur: dur.toFixed(1), max: settings.maxDur }), fix: null });
  }
  if (next && c.end > next.start + 0.0005) {
    out.push({ type: 'overlap', level: 2, msg: T('issue.overlap'), fix: next.start - g - c.start >= MIN_DUR ? 'trimEnd' : null });
  } else if (next && settings.minGapFrames > 0 && next.start - c.end < g - 0.0005) {
    const frames = Math.round((next.start - c.end) * f);
    out.push({ type: 'gap', level: 1, msg: T('issue.gap', { n: frames, min: settings.minGapFrames }), fix: next.start - g - c.start >= MIN_DUR ? 'trimEnd' : null });
  }
  if (state.cuts.length) {
    const win = settings.cutFrames / f;
    const cs = nearestCut(c.start);
    if (cs !== null && Math.abs(cs - c.start) <= win && Math.abs(cs - c.start) > 0.5 / f && cs < c.end - settings.minDur) {
      const fr = Math.round((c.start - cs) * f);
      out.push({ type: 'cut', level: 1, msg: T(fr > 0 ? 'issue.cutStartAfter' : 'issue.cutStartBefore', { n: Math.abs(fr) }), fix: 'cutStart', at: cs });
    }
    const ce = nearestCut(c.end);
    const target = ce !== null ? ce - g : NaN; // NaN makes every comparison below false
    if (ce !== null && Math.abs(ce - c.end) <= win && Math.abs(target - c.end) > 0.5 / f && target > c.start + settings.minDur && (!next || target <= next.start - g + 1e-6)) {
      const fr = Math.round((c.end - ce) * f);
      out.push({ type: 'cut', level: 1, msg: T(fr > 0 ? 'issue.cutEndAfter' : 'issue.cutEndBefore', { n: Math.abs(fr) }), fix: 'cutEnd', at: ce });
    }
  }
  return out;
}

// Applies a fix without recording history (the caller decides)
export function applyFix(c: Cue, issue: Issue) {
  const i = indexOf(c), next = state.cues[i + 1], g = gapSec();
  const limit = next ? next.start - g : Infinity;
  switch (issue.fix) {
    case 'extend': c.end = Math.max(c.end, Math.min(c.start + readingStats(c).needed, limit)); break;
    case 'minDur': c.end = Math.max(c.end, Math.min(c.start + settings.minDur, limit)); break;
    case 'trimEnd': c.end = Math.max(c.start + MIN_DUR, limit); break;
    case 'balance':
      c.text = balanceText(c.text);
      if (c.tr) c.tr = balanceText(c.tr);
      break;
    case 'cutStart': c.start = issue.at!; break;
    case 'cutEnd': c.end = issue.at! - g; break;
    case 'delete': state.cues.splice(i, 1); break;
  }
}

export const FIX_LABEL: Record<FixKind, string> = {
  extend: T('fix.extend'), minDur: T('fix.extend'), trimEnd: T('fix.trimEnd'), balance: T('fix.balance'),
  cutStart: T('fix.cut'), cutEnd: T('fix.cut'), delete: T('fix.delete'),
};

// Fixes the most severe fixable problem of one subtitle
export function fixCue(c: Cue) {
  const issue = cueIssues(indexOf(c)).sort((a, b) => b.level - a.level).find(x => x.fix);
  if (!issue) return;
  pushHistory();
  applyFix(c, issue);
  sortCues();
  commit();
  if (issue.type === 'speed' && readingStats(c).level) toast(T('toast.stillFast'), true);
}

// Updates the header counters; returns how many subtitles have any warning
export function updateIssues() {
  let total = 0, speed = 0;
  state.cues.forEach((c, i) => {
    if (cueIssues(i).length) total++;
    if (readingStats(c).level) speed++;
  });
  const btn = $('#issues-btn');
  btn.hidden = speed === 0;
  btn.textContent = T('list.hardToRead', { n: speed });
  const tab = $('#tab-review');
  tab.textContent = total ? T('list.reviewCount', { n: total }) : T('list.reviewOk');
  tab.classList.toggle('has-issues', total > 0);
  return total;
}

export function nextIssue(onlySpeed = true) {
  if (!state.cues.length) return;
  const from = Math.max(-1, indexOf(selected()));
  for (let k = 1; k <= state.cues.length; k++) {
    const i = (from + k) % state.cues.length;
    const c = state.cues[i];
    if (onlySpeed ? readingStats(c).level : cueIssues(i).length) {
      setView('list');
      select(c.id, { scroll: true, focus: true, field: visibleField() });
      return seek(c.start);
    }
  }
  toast(T('toast.noWarnings'));
}

$('#issues-btn').addEventListener('click', () => nextIssue(true));
