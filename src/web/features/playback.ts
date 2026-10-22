// Video playback, transport controls and frame-rate detection.
import { state } from '../core/state.ts';
import { selected, commit } from '../core/cues.ts';
import { fmt, fps, frameOf } from '../core/time.ts';
import { T } from '../core/i18n.ts';
import { $, video } from '../ui/dom.ts';
import { toast } from '../ui/toast.ts';
import { ensureVisible, requestDraw } from './timeline.ts';
import { layoutPicture } from './overlay.ts';
import { setVideo } from './files.ts';
import { serverInfo } from './saving.ts';
import type { Cue } from '../core/types.ts';

export const hasVideo = () => state.videoLoaded;
export const getTime = () => (hasVideo() ? video.currentTime : state.fakeTime);

// Length of the timeline: the video, or a bit beyond the last subtitle
export function duration() {
  const d = hasVideo() && isFinite(video.duration) ? video.duration : 0;
  const last = state.cues.reduce((m, c) => Math.max(m, c.end), 0);
  return Math.max(d, last + 5, 10);
}

export function seek(t: number, { keepStop = false } = {}) {
  t = Math.max(0, Math.min(t, hasVideo() && isFinite(video.duration) ? video.duration : Infinity));
  if (hasVideo()) video.currentTime = t; else state.fakeTime = t;
  if (!keepStop) state.stopAt = null;
  ensureVisible(t);
  requestDraw();
}

export function togglePlay() {
  if (!hasVideo()) return toast(T('toast.openVideo'));
  if (video.paused) video.play(); else video.pause();
}

export function playCue(c: Cue) {
  if (!hasVideo()) return toast(T('toast.openVideo'));
  seek(c.start);
  state.stopAt = c.end;
  video.play();
}

export function stepFrame(dir: number) {
  if (hasVideo()) video.pause();
  seek((frameOf(getTime()) + dir) / fps() + 0.0005);
}

export function toggleLoop(on = !state.loop) {
  state.loop = on;
  $('#loop-btn').setAttribute('aria-pressed', String(on));
  const c = selected();
  if (on) {
    if (!c) { state.loop = false; $('#loop-btn').setAttribute('aria-pressed', 'false'); return toast(T('toast.selectLoop')); }
    const t = getTime();
    if (t < c.start || t >= c.end) seek(c.start);
    if (hasVideo() && video.paused) video.play();
  }
}

// Called every frame by the main loop: stop points and looping
export function playbackTick(t: number) {
  if (state.stopAt != null && t >= state.stopAt) {
    video.pause();
    state.stopAt = null;
  }
  const sel = selected();
  if (state.loop && sel && !video.paused && (t >= sel.end || t < sel.start - 0.5)) seek(sel.start);
}

/* ---------- Frame rate ---------- */

// Detects frames per second by measuring the interval between frames during playback
function detectFps() {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return;
  let last: number | null = null;
  const deltas: number[] = [];
  const cb: VideoFrameRequestCallback = (now, meta) => {
    if (last !== null && video.playbackRate === 1) {
      const d = meta.mediaTime - last;
      if (d > 0.008 && d < 0.1) deltas.push(d);
    }
    last = meta.mediaTime;
    if (deltas.length < 48) { video.requestVideoFrameCallback(cb); return; }
    deltas.sort((a, b) => a - b);
    const f = 1 / deltas[deltas.length >> 1];
    state.fpsDetected = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60].reduce((a, b) => (Math.abs(b - f) < Math.abs(a - f) ? b : a));
    updateFrameUi();
    commit();
  };
  video.requestVideoFrameCallback(cb);
}

export function updateFrameUi() {
  const el = $('#fps-detected');
  if (el) el.textContent = state.fpsDetected ? T('settings.detected', { fps: state.fpsDetected }) : T('settings.detectOnPlay');
}

/* ---------- Transport ---------- */

const seekBar = $<HTMLInputElement>('#seek');
let seeking = false;

export function updateTransport(t: number) {
  $('#time').textContent = fmt(t, '.');
  $('#frame').textContent = T('transport.frame', { f: frameOf(t), fps: fps() });
  if (!seeking) seekBar.value = String(Math.round(t / duration() * 1000));
}

video.addEventListener('loadedmetadata', () => {
  state.videoLoaded = true;
  if (state.fakeTime) video.currentTime = state.fakeTime;
  layoutPicture();
  detectFps();
  requestDraw();
});

// If the browser can't play the file and it was opened from disk (desktop app), try converting it with ffmpeg
video.addEventListener('error', async () => {
  if (!video.src) return;
  const v = state.video;
  if (v?.token && serverInfo.ffmpeg) {
    toast(T('toast.converting'));
    try {
      const r = await fetch(`/api/remux/${v.token}`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setVideo({ ...v, url: j.url, token: j.url.split('/')[2] });
      return toast(T('toast.converted'));
    } catch (err) {
      return toast(T('toast.convertFailed', { msg: (err as Error).message }), true);
    }
  }
  toast(T('toast.cantPlay') + T(window.desktop ? 'toast.cantPlayDesktop' : 'toast.cantPlayWeb'), true);
});

video.addEventListener('click', togglePlay);
video.addEventListener('play', () => { $('#play-btn').textContent = '⏸'; });
video.addEventListener('pause', () => { $('#play-btn').textContent = '▶'; });

$('#play-btn').addEventListener('click', togglePlay);
$('#back-btn').addEventListener('click', () => seek(getTime() - 1));
$('#fwd-btn').addEventListener('click', () => seek(getTime() + 1));
$('#frame-back').addEventListener('click', () => stepFrame(-1));
$('#frame-fwd').addEventListener('click', () => stepFrame(1));
$('#loop-btn').addEventListener('click', () => toggleLoop());
$<HTMLSelectElement>('#rate').addEventListener('change', e => { video.playbackRate = +(e.target as HTMLSelectElement).value; });
$<HTMLInputElement>('#volume').addEventListener('input', e => { video.volume = +(e.target as HTMLInputElement).value; });
seekBar.addEventListener('pointerdown', () => { seeking = true; });
seekBar.addEventListener('pointerup', () => { seeking = false; });
seekBar.addEventListener('input', () => seek(+seekBar.value / 1000 * duration()));

