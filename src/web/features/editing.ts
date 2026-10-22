// Editing operations on subtitles: timing, insert, split, merge, delete, shift, undo/redo.
// Every operation follows the same pattern: pushHistory() → change state.cues → commit().
import { MIN_DUR, state } from '../core/state.ts';
import { settings } from '../core/settings.ts';
import { gapSec } from '../core/time.ts';
import { joinTexts, plainText, splitTextAtRatio } from '../core/text.ts';
import { balanceText } from '../core/balance.ts';
import { newCue, indexOf, selected, selectedCues, pushHistory, restoreSnapshot, sortCues, commit } from '../core/cues.ts';
import { T } from '../core/i18n.ts';
import { $, $$ } from '../ui/dom.ts';
import { toast } from '../ui/toast.ts';
import { select, clearSelection, rowOf } from './list.ts';
import { getTime } from './playback.ts';
import type { Cue } from '../core/types.ts';

/* ---------- Undo / redo ---------- */

export function undo() {
  if (!state.undo.length) return toast(T('toast.nothingUndo'));
  state.redo.push(JSON.stringify(state.cues));
  restoreSnapshot(state.undo.pop()!);
  toast(T('toast.undone'));
}

export function redo() {
  if (!state.redo.length) return toast(T('toast.nothingRedo'));
  state.undo.push(JSON.stringify(state.cues));
  restoreSnapshot(state.redo.pop()!);
}

/* ---------- Timing ---------- */

export function setStart(c: Cue, t = getTime()) {
  pushHistory();
  if (settings.ripple) {
    // Sync point: move this subtitle and all the following ones
    const delta = t - c.start;
    for (const o of state.cues) {
      if (o === c || o.start > c.start) {
        o.start = Math.max(0, o.start + delta);
        o.end = Math.max(o.start + MIN_DUR, o.end + delta);
      }
    }
  } else if (t >= c.end - MIN_DUR) {
    const d = c.end - c.start;
    c.start = t;
    c.end = t + d;
  } else {
    c.start = t;
  }
  sortCues();
  commit();
}

export function setEnd(c: Cue, t = getTime()) {
  if (t <= c.start + MIN_DUR) return toast(T('toast.endAfterStart'), true);
  pushHistory();
  c.end = t;
  commit();
}

export function shiftCues(list: Cue[], delta: number) {
  if (!delta || !list.length) return;
  pushHistory();
  for (const c of list) {
    const d = c.end - c.start;
    c.start = Math.max(0, c.start + delta);
    c.end = c.start + d;
  }
  sortCues();
  commit();
  toast(T('toast.shifted', { n: list.length, delta: (delta > 0 ? '+' : '') + delta.toFixed(3) }), { undo: true });
}

function shiftAll(delta: number) {
  const sel = selected();
  const fromSel = $<HTMLSelectElement>('#offset-scope').value === 'from';
  if (fromSel && !sel) return toast(T('toast.selectFirst'), true);
  shiftCues(fromSel && sel ? state.cues.filter(c => c.start >= sel.start) : state.cues, delta);
}

// t → t * factor + offset for every subtitle (FPS conversion and two-point sync)
export function scaleAll(factor: number, offset = 0) {
  pushHistory();
  for (const c of state.cues) {
    c.start = Math.max(0, c.start * factor + offset);
    c.end = Math.max(c.start + MIN_DUR, c.end * factor + offset);
  }
  commit();
}

/* ---------- Insert ---------- */

export function insertAt(t: number) {
  const next = state.cues.find(c => c.start > t);
  const end = Math.max(t + 0.5, Math.min(t + 2, next ? next.start - gapSec() : Infinity));
  pushHistory();
  const c = newCue(t, end);
  state.cues.push(c);
  sortCues();
  commit();
  select(c.id, { scroll: true, focus: true });
}

export function insertNow() {
  const t = getTime();
  const inside = state.cues.find(c => t >= c.start && t < c.end);
  if (inside) insertAfter(inside); else insertAt(t);
}

export function insertAfter(c: Cue) {
  const next = state.cues[indexOf(c) + 1];
  const start = c.end + gapSec();
  let end = next ? Math.min(next.start - gapSec(), start + 2) : start + 2;
  if (end - start < 0.5) end = start + 2;
  pushHistory();
  const n = newCue(start, end);
  state.cues.push(n);
  sortCues();
  commit();
  select(n.id, { scroll: true, focus: true });
}

export function newProject() {
  pushHistory();
  state.cues = [];
  state.selectedId = null;
  state.selection = new Set();
  state.srtName = 'subtitles.srt';
  $('#srt-name').textContent = T('header.newName');
  commit();
  toast(T('toast.cleared'), { undo: true });
}

/* ---------- Split ---------- */

// Alt+D / ✂: splits at the playhead; the text is cut at the caret if typing, otherwise proportionally
export function splitCue(c: Cue) {
  const t = getTime();
  if (!(t > c.start + MIN_DUR && t < c.end - MIN_DUR)) return toast(T('toast.splitInside'), true);
  const ratio = (t - c.start) / (c.end - c.start);
  const ta = rowOf(c.id)?.querySelector<HTMLTextAreaElement>('[data-field="text"]');
  let a: string, b: string;
  if (ta && document.activeElement === ta && ta.selectionStart > 0 && ta.selectionStart < ta.value.length) {
    a = c.text.slice(0, ta.selectionStart).trim();
    b = c.text.slice(ta.selectionStart).trim();
  } else {
    [a, b] = splitTextAtRatio(c.text, ratio);
  }
  splitInto(c, t, a, b, ratio);
}

// Enter in the text: split at the caret; time is shared by characters and moved to the nearest pause
export function splitAtCaret(c: Cue, ta: HTMLTextAreaElement) {
  const a = c.text.slice(0, ta.selectionStart).trim();
  const b = c.text.slice(ta.selectionEnd).trim();
  if (!b) return insertAfter(c);
  if (!a) return;
  const lenA = plainText(a).replace(/\s+/g, ' ').length;
  const lenB = plainText(b).replace(/\s+/g, ' ').length;
  const dur = c.end - c.start;
  if (dur < MIN_DUR * 2) return toast(T('toast.tooShortSplit'), true);
  const lo = c.start + MIN_DUR, hi = c.end - MIN_DUR;
  const t = findQuietPoint(Math.min(hi, Math.max(lo, c.start + dur * lenA / (lenA + lenB))), lo, hi);
  splitInto(c, t, a, b, (t - c.start) / dur);
  rowOf(state.selectedId)?.querySelector<HTMLTextAreaElement>('[data-field="text"]')?.setSelectionRange(0, 0);
}

function splitInto(c: Cue, t: number, a: string, b: string, ratio: number) {
  pushHistory();
  const n = newCue(t, c.end, b);
  if (c.tr) [c.tr, n.tr] = splitTextAtRatio(c.tr, ratio);
  if (c.top) n.top = true;
  c.end = t - gapSec() > c.start + MIN_DUR ? t - gapSec() : t;
  c.text = a;
  state.cues.push(n);
  sortCues();
  commit();
  select(n.id, { scroll: true, focus: true });
}

// Finds the audio pause closest to t (needs the waveform)
export function findQuietPoint(t: number, lo: number, hi: number, radius = 0.6): number {
  if (!state.peaks) return t;
  const r = state.peaksRate, p = state.peaks;
  const a = Math.max(lo, t - radius), b = Math.min(hi, t + radius);
  if (b <= a) return t;
  const win = Math.max(1, Math.round(0.05 * r));
  let best = t, bestE = Infinity;
  for (let i = Math.floor(a * r); i <= Math.ceil(b * r); i++) {
    let e = 0;
    for (let j = i - win; j <= i + win; j++) e += p[j] || 0;
    e = e / (2 * win + 1) + Math.abs(i / r - t) / radius * 0.08; // slight preference for the proportional point
    if (e < bestE) { bestE = e; best = i / r; }
  }
  return Math.min(hi, Math.max(lo, best));
}

/* ---------- Merge / delete ---------- */

// Keyboard merge (Delete / Backspace in the text): joins with a space and keeps the caret at the join point
export function joinWithNext(c: Cue) {
  const next = state.cues[indexOf(c) + 1];
  if (!next) return;
  const a = c.text.trimEnd();
  const caret = a.length + (a && next.text.trim() ? 1 : 0);
  pushHistory();
  c.text = joinTexts(c.text, next.text);
  if (c.tr || next.tr) c.tr = joinTexts(c.tr, next.tr);
  c.end = Math.max(c.end, next.end);
  state.cues.splice(indexOf(next), 1);
  commit();
  select(c.id, { scroll: true, focus: true });
  rowOf(c.id)?.querySelector<HTMLTextAreaElement>('[data-field="text"]')?.setSelectionRange(caret, caret);
}

export function mergeNext(c: Cue) {
  const next = state.cues[indexOf(c) + 1];
  if (!next) return toast(T('toast.noNext'));
  mergeCues([c, next]);
}

export function mergeCues(list: Cue[]) {
  if (list.length < 2) return;
  list = [...list].sort((a, b) => a.start - b.start);
  pushHistory();
  const first = list[0];
  for (const o of list.slice(1)) {
    first.text = joinTexts(first.text, o.text, '\n');
    if (first.tr || o.tr) first.tr = joinTexts(first.tr, o.tr, '\n');
    first.end = Math.max(first.end, o.end);
    state.cues.splice(indexOf(o), 1);
  }
  state.selection = new Set([first.id]);
  state.selectedId = first.id;
  commit();
  toast(T('toast.merged', { n: list.length }), { undo: true });
}

export function deleteCues(list: Cue[]) {
  if (!list.length) return;
  const i = indexOf(list[0]);
  pushHistory();
  const ids = new Set(list.map(c => c.id));
  state.cues = state.cues.filter(c => !ids.has(c.id));
  const neighbor = state.cues[i] || state.cues[i - 1];
  state.selectedId = neighbor ? neighbor.id : null;
  state.selection = new Set(neighbor ? [neighbor.id] : []);
  commit();
  toast(T('toast.deleted', { n: list.length }), { undo: true });
}

/* ---------- Text layout ---------- */

export function balanceCues(list: Cue[]) {
  if (!list.length) return;
  pushHistory();
  let n = 0;
  for (const c of list) {
    const t = balanceText(c.text), tr = c.tr ? balanceText(c.tr) : c.tr;
    if (t !== c.text || tr !== c.tr) n++;
    c.text = t;
    if (c.tr) c.tr = tr;
  }
  commit();
  toast(n ? T('toast.balanced', { n }) : T('toast.alreadyBalanced'), { undo: n > 0 });
}

export function toggleTop(list: Cue[]) {
  if (!list.length) return;
  pushHistory();
  const on = !list.every(c => c.top);
  list.forEach(c => { if (on) c.top = true; else delete c.top; });
  commit();
}

/* ---------- Controls ---------- */

const secondsIn = (sel: string) => parseFloat($<HTMLInputElement>(sel).value.replace(',', '.'));

$('#new-btn').addEventListener('click', newProject);
$('#undo-btn').addEventListener('click', undo);
$('#redo-btn').addEventListener('click', redo);
$('#add-btn').addEventListener('click', insertNow);

$('#offset-plus').addEventListener('click', () => {
  const v = secondsIn('#offset');
  if (isFinite(v)) shiftAll(Math.abs(v)); else toast(T('toast.seconds'), true);
});
$('#offset-minus').addEventListener('click', () => {
  const v = secondsIn('#offset');
  if (isFinite(v)) shiftAll(-Math.abs(v)); else toast(T('toast.seconds'), true);
});

$$<HTMLOptionElement>('#fps-convert option[value*=":"]').forEach(o => {
  const [from, to] = o.value.split(':');
  o.textContent = T('tools.fpsOption', { from, to });
});
$<HTMLSelectElement>('#fps-convert').addEventListener('change', e => {
  const sel = e.target as HTMLSelectElement;
  if (!sel.value) return;
  const [from, to] = sel.value.split(':').map(Number);
  sel.value = '';
  if (!state.cues.length) return;
  scaleAll(from / to);
  toast(T('toast.fpsConverted', { from, to }), { undo: true });
});

// Bar shown when several subtitles are selected
$('#multi-bar').addEventListener('click', e => {
  const act = (e.target as HTMLElement).closest<HTMLElement>('[data-multi]')?.dataset.multi;
  if (!act) return;
  const list = selectedCues();
  const v = secondsIn('#multi-offset');
  if (act === 'shift-plus' || act === 'shift-minus') {
    if (!isFinite(v)) return toast(T('toast.seconds'), true);
    shiftCues(list, act === 'shift-plus' ? Math.abs(v) : -Math.abs(v));
  } else if (act === 'merge') mergeCues(list);
  else if (act === 'balance') balanceCues(list);
  else if (act === 'delete') deleteCues(list);
  else if (act === 'clear') clearSelection();
});
