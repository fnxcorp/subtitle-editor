// Live timing: while the video plays, hold Space during each line (press = start, release = end).
import { MIN_DUR, state } from '../core/state.ts';
import { indexOf, selected, pushHistory, sortCues, commit } from '../core/cues.ts';
import { gapSec } from '../core/time.ts';
import { plainText, safeHtml } from '../core/text.ts';
import { T } from '../core/i18n.ts';
import { $, video } from '../ui/dom.ts';
import { toast } from '../ui/toast.ts';
import { hasVideo, getTime, seek } from './playback.ts';
import { select, refreshRowTimes } from './list.ts';
import { requestDraw } from './timeline.ts';

export function startLive() {
  if (!hasVideo()) return toast(T('toast.openVideo'), true);
  if (!state.cues.length) return toast(T('live.noSubs'), true);
  let i = indexOf(selected());
  if (i < 0) {
    const t = getTime();
    i = state.cues.findIndex(c => c.end > t);
    if (i < 0) i = 0;
  }
  state.live = { idx: i, holding: null };
  (document.activeElement as HTMLElement | null)?.blur();
  $('#live-banner').hidden = false;
  $('#live-btn').setAttribute('aria-pressed', 'true');
  select(state.cues[i].id, { scroll: true });
  renderLive();
  if (video.paused) video.play();
}

export function stopLive() {
  if (!state.live) return;
  if (state.live.holding) liveRelease();
  state.live = null;
  $('#live-banner').hidden = true;
  $('#live-banner').classList.remove('holding');
  $('#live-btn').setAttribute('aria-pressed', 'false');
}

export const toggleLive = () => (state.live ? stopLive() : startLive());

function renderLive() {
  const L = state.live!;
  const c = state.cues[L.idx], n = state.cues[L.idx + 1];
  $('#live-text').innerHTML = c ? (c.text.trim() ? safeHtml(c.text) : `<i>${T('cue.empty')}</i>`) : '';
  $('#live-next').textContent = n ? T('live.next', { text: plainText(n.text).replace(/\n/g, ' ') }) : T('live.last');
}

// Space pressed: this subtitle starts now (and the previous one ends just before)
function livePress() {
  const L = state.live!;
  const c = state.cues[L.idx];
  if (!c) return;
  pushHistory();
  const t = getTime(), g = gapSec();
  const prev = state.cues[L.idx - 1];
  if (prev && prev.end > t - g) { prev.end = Math.max(prev.start + MIN_DUR, t - g); refreshRowTimes(prev); }
  c.start = t;
  c.end = t + MIN_DUR;
  L.holding = c;
  $('#live-banner').classList.add('holding');
  refreshRowTimes(c);
}

// Called every frame by the main loop: the held subtitle grows with the playhead
export function liveTick(t: number) {
  const c = state.live?.holding;
  if (c) { c.end = Math.max(t, c.start + MIN_DUR); requestDraw(); }
}

// Space released: this subtitle ends now; move on to the next one
function liveRelease() {
  const L = state.live!, c = L.holding;
  if (!c) return;
  c.end = Math.max(getTime(), c.start + MIN_DUR);
  L.holding = null;
  $('#live-banner').classList.remove('holding');
  sortCues();
  L.idx = indexOf(c) + 1;
  commit();
  if (L.idx >= state.cues.length) {
    stopLive();
    video.pause();
    return toast(T('live.end'), { undo: true });
  }
  select(state.cues[L.idx].id, { scroll: true });
  renderLive();
}

function moveLive(d: number) {
  const L = state.live!;
  L.idx = Math.max(0, Math.min(state.cues.length - 1, L.idx + d));
  const c = state.cues[L.idx];
  select(c.id, { scroll: true });
  if (d < 0) seek(Math.max(0, c.start - 2));
  renderLive();
}

// Returns true if the key belongs to live timing (called before any other shortcut)
export function handleLiveKey(e: KeyboardEvent): boolean {
  if (!state.live) return false;
  if (e.code === 'Space') {
    e.preventDefault();
    if (e.type === 'keydown' && !e.repeat && !state.live.holding) livePress();
    if (e.type === 'keyup') liveRelease();
    return true;
  }
  if (e.type !== 'keydown') return false;
  if (e.key === 'Escape') { e.preventDefault(); stopLive(); video.pause(); return true; }
  if (e.key === 'ArrowDown') { e.preventDefault(); moveLive(1); return true; }
  if (e.key === 'ArrowUp') { e.preventDefault(); moveLive(-1); return true; }
  return false;
}

$('#live-btn').addEventListener('click', toggleLive);
