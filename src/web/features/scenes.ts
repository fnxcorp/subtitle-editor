// Shot change detection inside the browser. Plays a hidden copy of the video at 16× comparing
// thumbnails of consecutive frames, then refines frame by frame, by seeking, only the cuts that
// fall near a subtitle edge (the ones that matter for the quality checks and snapping).
import { state } from '../core/state.ts';
import { commit } from '../core/cues.ts';
import { fps } from '../core/time.ts';
import { T } from '../core/i18n.ts';
import { $ } from '../ui/dom.ts';
import { toast } from '../ui/toast.ts';
import { hasVideo } from './playback.ts';
import { requestDraw } from './timeline.ts';

interface Frame { g: Float32Array; hist: Float32Array }
interface Candidate { t0: number; t1: number; a: Frame; b: Frame; s: number }

const scenes = { running: false, cancel: false };
const TW = 32, TH = 18; // thumbnail size used for comparisons

// Cuts are cached per video in localStorage
const cutsKey = () => (state.video ? `subeditor:cuts:${state.video.name}:${state.video.size}` : null);
const once = (el: EventTarget, ev: string) => new Promise<void>(r => el.addEventListener(ev, () => r(), { once: true }));

export function loadCuts() {
  state.cuts = [];
  try {
    const k = cutsKey();
    const d = k && JSON.parse(localStorage.getItem(k) || 'null');
    if (Array.isArray(d)) state.cuts = d;
  } catch {}
  updateScenesBtn();
  requestDraw();
}

function saveCuts() {
  try { localStorage.setItem(cutsKey()!, JSON.stringify(state.cuts.map(t => +t.toFixed(4)))); } catch {}
}

export function clearCuts() {
  state.cuts = [];
  saveCuts();
  updateScenesBtn();
  commit();
}

function updateScenesBtn(text?: string) {
  const b = $('#scenes-btn');
  b.textContent = text || (state.cuts.length ? T('tools.cutsCount', { n: state.cuts.length }) : T('tools.cuts'));
  b.title = scenes.running ? T('tools.cancelTitle') : T('tools.cutsTitle');
}

// Returns a function that captures the current frame as a luma grid + histogram
function makeGrabber(v: HTMLVideoElement): () => Frame {
  const c = document.createElement('canvas');
  c.width = TW;
  c.height = TH;
  const cx = c.getContext('2d', { willReadFrequently: true })!;
  return () => {
    cx.drawImage(v, 0, 0, TW, TH);
    const d = cx.getImageData(0, 0, TW, TH).data;
    const g = new Float32Array(TW * TH), hist = new Float32Array(16);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const y = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      g[j] = y;
      hist[Math.min(15, (y * 16) | 0)]++;
    }
    return { g, hist };
  };
}

// Pixel difference (motion) and histogram difference (content change)
function frameDiff(a: Frame, b: Frame) {
  let s = 0, h = 0;
  for (let i = 0; i < a.g.length; i++) s += Math.abs(a.g[i] - b.g[i]);
  for (let i = 0; i < 16; i++) h += Math.abs(a.hist[i] - b.hist[i]);
  return { pix: s / a.g.length, hist: h / (2 * a.g.length) };
}

// avg is the running average of pixel differences, so busy scenes need a bigger jump
const isCutDiff = (d: { pix: number; hist: number }, avg: number) => d.pix > Math.max(0.09, avg * 3.5) && d.hist > 0.18;

async function seekProbe(v: HTMLVideoElement, t: number) {
  v.currentTime = t;
  await once(v, 'seeked');
}

// Binary search between the last frame of the previous shot and the first of the new one
async function refineCut(v: HTMLVideoElement, grab: () => Frame, c: Candidate): Promise<{ t: number; s: number } | null> {
  const f = fps();
  let lo = c.t0, hi = c.t1, gLo = c.a, gHi = c.b;
  for (let i = 0; i < 7 && hi - lo > 0.5 / f; i++) {
    const mid = (lo + hi) / 2;
    await seekProbe(v, mid);
    const g = grab();
    if (frameDiff(g, gLo).pix < frameDiff(g, gHi).pix) { lo = mid; gLo = g; } else { hi = mid; gHi = g; }
  }
  // In a real cut the jump between adjacent frames is sharp; otherwise it was motion
  const d = frameDiff(gLo, gHi);
  if (!(d.pix > 0.12 || (d.pix > 0.08 && d.hist > 0.2))) return null;
  return { t: Math.floor(hi * f + 1e-6) / f, s: d.pix };
}

// Click again while running to cancel
export async function detectScenes() {
  if (scenes.running) { scenes.cancel = true; return; }
  if (!state.video || !hasVideo()) return toast(T('toast.openVideo'), true);
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return toast(T('toast.noFrames'), true);
  scenes.running = true;
  scenes.cancel = false;
  updateScenesBtn(T('tools.cutsProgress', { n: 0 }));
  toast(T('toast.detecting'));

  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.className = 'scene-probe'; // must be in the page (nearly invisible) or frame callbacks don't fire
  v.src = state.video.url;
  document.body.appendChild(v);
  try {
    await once(v, 'loadeddata');
    const grab = makeGrabber(v);
    const dur = v.duration;
    const cands: Candidate[] = [];
    let prev: Frame | null = null, prevT = 0, avg = 0.02;
    v.playbackRate = 16;
    let scanning = true;
    await new Promise<void>((resolve, reject) => {
      const finish = () => { scanning = false; resolve(); };
      const onFrame: VideoFrameRequestCallback = (now, meta) => {
        if (!scanning) return;
        if (scenes.cancel) { v.pause(); return finish(); }
        const cur = grab(), t = meta.mediaTime;
        if (prev) {
          const d = frameDiff(prev, cur);
          if (isCutDiff(d, avg)) cands.push({ t0: prevT, t1: t, a: prev, b: cur, s: d.pix });
          else avg = avg * 0.9 + d.pix * 0.1;
        }
        prev = cur;
        prevT = t;
        updateScenesBtn(T('tools.cutsProgress', { n: Math.round(t / dur * 100) }));
        v.requestVideoFrameCallback(onFrame);
      };
      v.requestVideoFrameCallback(onFrame);
      v.addEventListener('ended', finish, { once: true });
      v.addEventListener('error', () => reject(new Error(T('toast.readFail'))), { once: true });
      v.play().catch(reject);
    });
    if (scenes.cancel) return toast(T('toast.cutsCancelled'));
    v.pause();

    const edges = state.cues.flatMap(c => [c.start, c.end]).sort((a, b) => a - b);
    const nearEdge = (t: number) => {
      let lo = 0, hi = edges.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (edges[m] < t) lo = m + 1; else hi = m; }
      return [edges[lo], edges[lo - 1]].some(x => x !== undefined && Math.abs(x - t) < 1.5);
    };
    const toRefine = cands.filter(c => nearEdge(c.t1)).length;
    const cuts: { t: number; s: number }[] = [];
    let k = 0;
    for (const c of cands) {
      if (scenes.cancel) return toast(T('toast.cutsCancelled'));
      if (!nearEdge(c.t1)) { cuts.push({ t: c.t1, s: c.s }); continue; }
      updateScenesBtn(T('tools.refining', { n: Math.round(++k / toRefine * 100) }));
      const r = await refineCut(v, grab, c);
      if (r) cuts.push(r);
    }
    // A shot rarely lasts under 0.4 s: in bursts (flashes, motion) keep the clearest jump
    cuts.sort((a, b) => a.t - b.t);
    const merged: { t: number; s: number }[] = [];
    for (const c of cuts) {
      const last = merged[merged.length - 1];
      if (last && c.t - last.t < 0.4) { if (c.s > last.s) merged[merged.length - 1] = c; } else merged.push(c);
    }
    state.cuts = merged.map(c => Math.round(c.t * 1000) / 1000);
    saveCuts();
    commit();
    toast(T('toast.cutsFound', { n: state.cuts.length }));
  } catch (err) {
    console.error(err);
    toast(T('toast.cutsFailed', { msg: (err as Error).message }), true);
  } finally {
    v.remove();
    scenes.running = false;
    updateScenesBtn();
  }
}

$('#scenes-btn').addEventListener('click', detectScenes);
