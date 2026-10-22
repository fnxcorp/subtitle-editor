// Two-point sync: mark where two subtitles are really heard and fix offset and speed at once.
// With points A (orig → at) and B, every time becomes t * k + off.
import { indexOf, selected } from '../core/cues.ts';
import { fmt } from '../core/time.ts';
import { T } from '../core/i18n.ts';
import { $ } from '../ui/dom.ts';
import { toast } from '../ui/toast.ts';
import { hasVideo, getTime } from './playback.ts';
import { scaleAll } from './editing.ts';

interface SyncPoint { id: number; orig: number; at: number; n: number } // orig = subtitle start, at = where it's heard
export const sync: { a: SyncPoint | null; b: SyncPoint | null } = { a: null, b: null };

// Common frame-rate mismatches, to explain a detected scale
const FPS_RATIOS = [[23.976, 25], [25, 23.976], [24, 25], [25, 24], [23.976, 24], [24, 23.976], [29.97, 25], [25, 29.97], [30, 25], [25, 30]];

export function openSync() {
  $('#sync-card').hidden = false;
  renderSync();
}

export function setSyncPoint(which: 'a' | 'b') {
  const c = selected();
  if (!hasVideo()) return toast(T('toast.openVideo'), true);
  if (!c) return toast(T('sync.selectHeard'), true);
  sync[which] = { id: c.id, orig: c.start, at: getTime(), n: indexOf(c) + 1 };
  $('#sync-card').hidden = false;
  renderSync();
}

// { k, off } or null; with one point (or two very close ones) it is a plain offset
export function syncTransform(): { k: number; off: number } | null {
  const { a, b } = sync;
  const p = a || b;
  if (!p) return null;
  if (!a || !b || Math.abs(b.orig - a.orig) < 1) return { k: 1, off: p.at - p.orig };
  const k = (b.at - a.at) / (b.orig - a.orig);
  return { k, off: a.at - a.orig * k };
}

export function renderSync() {
  const info = (p: SyncPoint | null) => p ? `#${p.n}: ${fmt(p.orig)} → ${fmt(p.at)} (${p.at - p.orig >= 0 ? '+' : ''}${(p.at - p.orig).toFixed(3)} s)` : '';
  $('#sync-a-info').textContent = info(sync.a);
  $('#sync-b-info').textContent = info(sync.b);
  const tf = syncTransform();
  const out = $('#sync-result');
  $<HTMLButtonElement>('#sync-apply').disabled = !tf;
  if (!tf) { out.innerHTML = ''; return; }
  let html;
  if (Math.abs(tf.k - 1) < 1e-5) {
    html = T('sync.offset', { off: (tf.off >= 0 ? '+' : '') + tf.off.toFixed(3) });
    if (!(sync.a && sync.b)) html += ` <span class="muted">${T('sync.markB')}</span>`;
  } else {
    html = T('sync.scale', { k: tf.k.toFixed(5), off: (tf.off >= 0 ? '+' : '') + tf.off.toFixed(3) });
    const r = FPS_RATIOS.find(([f, t]) => Math.abs(tf.k - f / t) / (f / t) < 0.0015);
    if (r) html += ` <span class="muted">${T('sync.fpsRatio', { from: r[0], to: r[1] })}</span>`;
    if (tf.k < 0.9 || tf.k > 1.1) html += ` <span class="warn-text">${T('sync.tooBig')}</span>`;
  }
  out.innerHTML = html;
}

function applySync() {
  const tf = syncTransform();
  if (!tf) return;
  scaleAll(tf.k, tf.off);
  sync.a = sync.b = null;
  $('#sync-card').hidden = true;
  toast(T('sync.done'), { undo: true });
}

$('#sync-btn').addEventListener('click', () => ($('#sync-card').hidden ? openSync() : ($('#sync-card').hidden = true)));
$('#sync-close').addEventListener('click', () => { $('#sync-card').hidden = true; });
$('#sync-a').addEventListener('click', () => setSyncPoint('a'));
$('#sync-b').addEventListener('click', () => setSyncPoint('b'));
$('#sync-apply').addEventListener('click', applySync);
