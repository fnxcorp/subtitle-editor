// The canvas timeline: drawing (waveform, ruler, cuts, blocks, playhead) and mouse editing
// (drag to move or resize, snapping, double-click to create, wheel to scroll/zoom).
import { MIN_DUR, state } from '../core/state.ts';
import { settings } from '../core/settings.ts';
import { selected, selectedCues, pushHistory, sortCues, commit } from '../core/cues.ts';
import { gapSec, p2 } from '../core/time.ts';
import { cueText, plainText } from '../core/text.ts';
import { $ } from '../ui/dom.ts';
import { readingStats } from './quality.ts';
import { getTime, seek, duration } from './playback.ts';
import { select, markRows, refreshRowTimes, rowOf } from './list.ts';
import { updateActive } from './overlay.ts';
import { insertAt } from './editing.ts';
import type { Cue } from '../core/types.ts';

const canvas = $<HTMLCanvasElement>('#timeline');
const ctx = canvas.getContext('2d')!;
const RULER = 20; // ruler height in px

const COL = {
  bg: '#0b0d11', ruler: '#141821', tick: '#2c3342', label: '#7d8597',
  wave: '#2f3b55', cue: 'rgba(91,140,255,0.28)', cueBorder: 'rgba(91,140,255,0.8)',
  sel: 'rgba(91,140,255,0.55)', selBorder: '#9db8ff', active: 'rgba(61,220,151,0.3)',
  activeBorder: 'rgba(61,220,151,0.9)', text: '#e6e8ee', playhead: '#ff5d5d',
  warn: 'rgba(255,181,71,0.42)', warnBorder: '#ffb547', danger: 'rgba(255,107,107,0.5)', dangerBorder: '#ff6b6b',
  cut: 'rgba(196,140,255,0.75)', snap: '#ffe066', loop: 'rgba(61,220,151,0.08)',
};

// The timeline is only redrawn on the next frame after something asks for it
let dirty = true;
export const requestDraw = () => { dirty = true; };
export function drawIfNeeded() {
  if (dirty) { drawTimeline(); dirty = false; }
}

function resizeCanvas() {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dirty = true;
}
new ResizeObserver(resizeCanvas).observe(canvas);

// The scrollbar's content spans the whole duration plus one screen, as far as the wheel can scroll
const bar = $('#timeline-scroll');
function syncScrollbar(W: number) {
  (bar.firstElementChild as HTMLElement).style.width = `${duration() * state.pps + W}px`;
  if (Math.abs(bar.scrollLeft - state.viewStart * state.pps) >= 1) bar.scrollLeft = state.viewStart * state.pps;
}
bar.addEventListener('scroll', () => {
  if (Math.abs(bar.scrollLeft - state.viewStart * state.pps) < 1) return; // our own sync from drawTimeline
  state.viewStart = bar.scrollLeft / state.pps;
  state.lastUserScroll = performance.now();
  dirty = true;
});

const viewSeconds = () => canvas.clientWidth / state.pps;

// Scrolls the timeline so t is visible
export function ensureVisible(t: number) {
  const span = viewSeconds();
  if (t < state.viewStart || t > state.viewStart + span) {
    state.viewStart = Math.max(0, t - span * 0.15);
    dirty = true;
  }
}

// pps = pixels per second; keeps anchorT under the pixel anchorX
export function setZoom(pps: number, anchorT: number, anchorX: number) {
  state.pps = Math.max(5, Math.min(800, pps));
  state.viewStart = Math.max(0, anchorT - anchorX / state.pps);
  $<HTMLInputElement>('#zoom').value = String(Math.round(Math.log(state.pps / 5) / Math.log(160) * 100));
  dirty = true;
}

export const zoomBy = (factor: number) => setZoom(state.pps * factor, getTime(), (getTime() - state.viewStart) * state.pps);

/* ---------- Drawing ---------- */

function fmtRuler(t: number, step: number): string {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const ss = step < 1 ? s.toFixed(1).padStart(4, '0') : p2(Math.floor(s));
  return h ? `${h}:${p2(m)}:${ss}` : `${m}:${ss}`;
}

function cueBox(c: Cue, H: number) {
  return { x0: (c.start - state.viewStart) * state.pps, x1: (c.end - state.viewStart) * state.pps, y: RULER + 8, h: H - RULER - 20 };
}

function drawTimeline() {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const { pps, viewStart: v0 } = state;
  const v1 = v0 + W / pps;
  syncScrollbar(W);
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, W, H);

  // Loop region
  const sel = selected();
  if (state.loop && sel) {
    ctx.fillStyle = COL.loop;
    ctx.fillRect((sel.start - v0) * pps, RULER, (sel.end - sel.start) * pps, H - RULER);
  }

  // Waveform
  if (state.peaks) {
    const peaks = state.peaks, rate = state.peaksRate;
    const mid = RULER + (H - RULER) / 2, amp = (H - RULER) / 2 - 6;
    ctx.fillStyle = COL.wave;
    for (let x = 0; x < W; x++) {
      const t0 = v0 + x / pps;
      const i0 = Math.floor(t0 * rate);
      const i1 = Math.max(i0 + 1, Math.floor((t0 + 1 / pps) * rate));
      let m = 0;
      for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
      if (m > 0) { const h = Math.max(0.5, m * amp); ctx.fillRect(x, mid - h, 1, h * 2); }
    }
  }

  // Ruler
  ctx.fillStyle = COL.ruler;
  ctx.fillRect(0, 0, W, RULER);
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
  const step = steps.find(s => s * pps >= 70) || 3600;
  ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'middle';
  for (let k = Math.floor(v0 / step); k * step <= v1; k++) {
    const t = k * step, x = Math.round((t - v0) * pps) + 0.5;
    ctx.fillStyle = COL.tick;
    ctx.fillRect(x, RULER - 6, 1, 6);
    ctx.fillRect(x, RULER, 1, H - RULER);
    ctx.fillStyle = COL.label;
    ctx.fillText(fmtRuler(t, step), x + 4, RULER / 2);
  }

  // Shot changes
  if (state.cuts.length) {
    ctx.fillStyle = COL.cut;
    for (const t of state.cuts) {
      if (t < v0 || t > v1) continue;
      const x = Math.round((t - v0) * pps);
      ctx.fillRect(x, RULER, 1, H - RULER);
      ctx.beginPath();
      ctx.moveTo(x - 3, RULER); ctx.lineTo(x + 4, RULER); ctx.lineTo(x + 0.5, RULER + 5);
      ctx.fill();
    }
  }

  // Blocks (selected ones on top)
  const visible = state.cues.filter(c => c.end >= v0 && c.start <= v1);
  visible.sort((a, b) => Number(state.selection.has(a.id)) - Number(state.selection.has(b.id)));
  ctx.font = '12px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'top';
  for (const c of visible) {
    const { x0, x1, y, h } = cueBox(c, H);
    const isSel = state.selection.has(c.id), isAct = state.activeIds.includes(c.id);
    const lvl = readingStats(c).level;
    ctx.fillStyle = lvl === 2 ? COL.danger : lvl === 1 ? COL.warn : isSel ? COL.sel : isAct ? COL.active : COL.cue;
    ctx.strokeStyle = isSel ? COL.selBorder : lvl === 2 ? COL.dangerBorder : lvl === 1 ? COL.warnBorder : isAct ? COL.activeBorder : COL.cueBorder;
    ctx.lineWidth = isSel ? 1.5 : 1;
    ctx.beginPath();
    ctx.roundRect(x0, y, Math.max(1, x1 - x0), h, 4);
    ctx.fill();
    ctx.stroke();
    if (c.id === state.selectedId && x1 - x0 > 14) {
      ctx.fillStyle = COL.selBorder;
      ctx.fillRect(x0 + 2, y + h / 2 - 8, 2, 16);
      ctx.fillRect(x1 - 4, y + h / 2 - 8, 2, 16);
    }
    if (x1 - x0 > 20) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 + 6, y, x1 - x0 - 12, h);
      ctx.clip();
      ctx.fillStyle = COL.text;
      if (lvl) ctx.fillText(lvl === 2 ? '⛔' : '⚠', x1 - 22, y + h - 18);
      plainText(cueText(c, settings.translation && c.tr ? 'tr' : 'text')).split('\n').forEach((line, i) => {
        if (6 + i * 15 < h - 10) ctx.fillText(line, x0 + 7, y + 6 + i * 15);
      });
      ctx.restore();
    }
  }

  // Snap guide
  if (state.snapLine != null) {
    const x = Math.round((state.snapLine - v0) * pps) + 0.5;
    ctx.strokeStyle = COL.snap;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, RULER); ctx.lineTo(x, H);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawOverview(W, H);

  // Playhead
  const px = Math.round((getTime() - v0) * pps) + 0.5;
  if (px >= 0 && px <= W) {
    ctx.fillStyle = COL.playhead;
    ctx.fillRect(px - 0.5, 0, 2, H);
    ctx.beginPath();
    ctx.moveTo(px - 5, 0); ctx.lineTo(px + 6, 0); ctx.lineTo(px + 0.5, 7);
    ctx.fill();
  }
}

// Whole-video overview under the scrollbar: subtitles, problems and shot changes at a glance
function drawOverview(W: number, H: number) {
  const k = W / duration(), y = H - 10;
  ctx.fillStyle = COL.ruler;
  ctx.fillRect(0, y, W, 10);
  ctx.fillStyle = COL.cut;
  for (const t of state.cuts) ctx.fillRect(Math.round(t * k), y, 1, 10);
  for (const c of state.cues) {
    const lvl = readingStats(c).level;
    ctx.fillStyle = lvl === 2 ? COL.dangerBorder : lvl === 1 ? COL.warnBorder : COL.cueBorder;
    ctx.fillRect(Math.floor(c.start * k), lvl ? y + 1 : y + 3, Math.max(1, (c.end - c.start) * k), lvl ? 8 : 4);
  }
}

/* ---------- Mouse editing ---------- */

function canvasPos(e: MouseEvent) {
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  return { x, y, t: state.viewStart + x / state.pps };
}

// Which block (and which part: start edge, end edge or body) is under the pointer
type DragMode = 'start' | 'end' | 'move';

function hitTest(x: number, y: number): { cue: Cue; mode: DragMode } | null {
  const H = canvas.clientHeight;
  if (y < RULER) return null;
  const order = [...state.cues].sort((a, b) => Number(state.selection.has(b.id)) - Number(state.selection.has(a.id)));
  for (const c of order) {
    const { x0, x1 } = cueBox(c, H);
    if (x < x0 - 4 || x > x1 + 4) continue;
    const edge = Math.min(8, (x1 - x0) / 3);
    if (Math.abs(x - x0) <= edge) return { cue: c, mode: 'start' };
    if (Math.abs(x - x1) <= edge) return { cue: c, mode: 'end' };
    if (x >= x0 && x <= x1) return { cue: c, mode: 'move' };
  }
  return null;
}

// Points an edge snaps to: playhead, shot changes and neighbouring edges (keeping the minimum gap)
export function snapCandidates(moving: Set<Cue>): number[] {
  const g = gapSec();
  const pts = [getTime(), ...state.cuts, ...state.cuts.map(t => t - g)];
  for (const o of state.cues) {
    if (moving.has(o)) continue;
    pts.push(o.start - g, o.end + g, o.start, o.end);
  }
  return pts;
}

function snapEdge(t: number, cands: number[], thr: number): number | null {
  let best: number | null = null;
  for (const p of cands) if (Math.abs(p - t) <= thr && (best === null || Math.abs(p - t) < Math.abs(best - t))) best = p;
  return best;
}

interface CueDrag {
  mode: DragMode;
  cue: Cue;
  x0: number;              // pointer x at mousedown
  s0: number;              // cue start / end at mousedown
  e0: number;
  moved: boolean;
  group?: [Cue, number, number][]; // cues that move, with their original start / end
  cands?: number[];        // snap candidates
  minStart?: number;       // limits that avoid creating overlaps
  maxEnd?: number;
  gs?: number;             // group start / end at mousedown
  ge?: number;
}
let drag: CueDrag | { mode: 'seek' } | null = null;
export const isDragging = () => !!drag;

canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  const { x, y, t } = canvasPos(e);
  const hit = hitTest(x, y);
  if (hit) {
    const c = hit.cue;
    if (e.shiftKey || e.metaKey || e.ctrlKey) { select(c.id, { mode: 'toggle' }); return; }
    if (!state.selection.has(c.id) || hit.mode !== 'move') select(c.id, { scroll: true });
    else { state.selectedId = c.id; markRows(); rowOf(c.id)?.scrollIntoView({ block: 'nearest' }); }
    drag = { mode: hit.mode, cue: c, x0: x, s0: c.start, e0: c.end, moved: false };
  } else {
    drag = { mode: 'seek' };
    seek(t);
  }
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup', endDrag, { once: true });
});

// Runs once, when the pointer actually starts moving
function prepareDrag(drag: CueDrag) {
  const c = drag.cue;
  pushHistory();
  drag.moved = true;
  // What moves: the whole selection, or this block (plus the following ones with “Ripple following”)
  let group = [c];
  if (drag.mode === 'move') {
    if (state.selection.size > 1 && state.selection.has(c.id)) group = selectedCues();
    else if (settings.ripple) group = state.cues.filter(o => o === c || o.start > drag.s0);
  }
  drag.group = group.map(o => [o, o.start, o.end]);
  const moving = new Set(group);
  drag.cands = snapCandidates(moving);
  // Limits to avoid creating overlaps (only if there were none already)
  const g = gapSec();
  const gs = Math.min(...group.map(o => o.start)), ge = Math.max(...group.map(o => o.end));
  const others = state.cues.filter(o => !moving.has(o));
  const prev = others.filter(o => o.end <= gs + 1e-3).reduce<Cue | null>((a, o) => (!a || o.end > a.end ? o : a), null);
  const next = others.filter(o => o.start >= ge - 1e-3).reduce<Cue | null>((a, o) => (!a || o.start < a.start ? o : a), null);
  drag.minStart = prev ? Math.min(prev.end + g, gs) : 0;
  drag.maxEnd = next ? Math.max(next.start - g, ge) : Infinity;
  drag.gs = gs;
  drag.ge = ge;
}

function onDrag(e: MouseEvent) {
  const { x, t } = canvasPos(e);
  if (!drag) return;
  if (drag.mode === 'seek') { seek(Math.max(0, t)); return; }
  if (!drag.moved) {
    if (Math.abs(x - drag.x0) < 3) return;
    prepareDrag(drag);
  }
  const gs = drag.gs!, ge = drag.ge!, cands = drag.cands!, minStart = drag.minStart!, maxEnd = drag.maxEnd!;
  const c = drag.cue;
  const free = e.altKey; // Alt: no snapping and no limits
  const thr = 8 / state.pps;
  const useSnap = settings.snap && !free;
  const dt = (x - drag.x0) / state.pps;
  state.snapLine = null;

  if (drag.mode === 'move') {
    let d = dt;
    if (useSnap) {
      const ns = snapEdge(gs + d, cands, thr);
      const ne = snapEdge(ge + d, cands, thr);
      const ds = ns !== null ? ns - gs : null, de = ne !== null ? ne - ge : null;
      if (ds !== null && (de === null || Math.abs(ds - d) <= Math.abs(de - d))) { d = ds; state.snapLine = ns; }
      else if (de !== null) { d = de; state.snapLine = ne; }
    }
    if (!free) {
      d = Math.max(d, minStart - gs);
      if (maxEnd !== Infinity) d = Math.min(d, maxEnd - ge);
    }
    d = Math.max(d, -gs);
    for (const [o, s, en] of drag.group!) { o.start = Math.max(0, s + d); o.end = Math.max(o.start + MIN_DUR, en + d); }
  } else if (drag.mode === 'start') {
    let ns = drag.s0 + dt;
    if (useSnap) { const sn = snapEdge(ns, cands, thr); if (sn !== null) { ns = sn; state.snapLine = sn; } }
    if (!free) ns = Math.max(ns, minStart);
    c.start = Math.max(0, Math.min(ns, c.end - MIN_DUR));
  } else {
    let ne = drag.e0 + dt;
    if (useSnap) { const sn = snapEdge(ne, cands, thr); if (sn !== null) { ne = sn; state.snapLine = sn; } }
    if (!free) ne = Math.min(ne, maxEnd);
    c.end = Math.max(ne, c.start + MIN_DUR);
  }
  drag.group!.forEach(([o]) => refreshRowTimes(o));
  updateActive(true);
  dirty = true;
}

function endDrag() {
  window.removeEventListener('mousemove', onDrag);
  if (drag && drag.mode !== 'seek' && drag.moved) { sortCues(); commit(); }
  drag = null;
  state.snapLine = null;
  dirty = true;
}

canvas.addEventListener('mousemove', e => {
  if (drag) return;
  const { x, y } = canvasPos(e);
  const hit = hitTest(x, y);
  canvas.style.cursor = !hit ? 'text' : hit.mode === 'move' ? 'grab' : 'ew-resize';
});

canvas.addEventListener('dblclick', e => {
  const { x, y, t } = canvasPos(e);
  const hit = hitTest(x, y);
  if (hit) select(hit.cue.id, { scroll: true, focus: true });
  else if (y >= RULER) insertAt(Math.max(0, t));
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const { x, t } = canvasPos(e);
  if (e.ctrlKey || e.metaKey) {
    setZoom(state.pps * Math.exp(-e.deltaY * 0.01), t, x);
  } else {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    state.viewStart = Math.max(0, Math.min(duration(), state.viewStart + d / state.pps));
    state.lastUserScroll = performance.now();
    dirty = true;
  }
}, { passive: false });

$<HTMLInputElement>('#zoom').addEventListener('input', e => {
  const W = canvas.clientWidth, t = getTime();
  const center = t >= state.viewStart && t <= state.viewStart + viewSeconds()
    ? { t, x: (t - state.viewStart) * state.pps }
    : { t: state.viewStart + viewSeconds() / 2, x: W / 2 };
  setZoom(5 * Math.pow(160, +(e.target as HTMLInputElement).value / 100), center.t, center.x);
});
