// Automatic transcription with Whisper (see ../workers/whisper-worker.js). Audio is processed in
// blocks of about 5 minutes cut at silences, to show progress and allow cancelling.
import { MIN_DUR, state } from '../core/state.ts';
import { settings } from '../core/settings.ts';
import { newCue, pushHistory, sortCues, commit } from '../core/cues.ts';
import { fmt, gapSec } from '../core/time.ts';
import { balanceText } from '../core/balance.ts';
import { T } from '../core/i18n.ts';
import { $ } from '../ui/dom.ts';
import { toast } from '../ui/toast.ts';
import { getTime } from './playback.ts';
import { decodeAudio } from './waveform.ts';
import type { Cue } from '../core/types.ts';

interface Segment { start: number; end: number; text: string }
type WorkerReply =
  | { type: 'download'; file?: string; progress?: number }
  | { type: 'ready'; device: 'webgpu' | 'wasm' }
  | { type: 'result'; chunks: { text?: string; timestamp?: [number | null, number | null] }[] }
  | { type: 'error'; message: string };

const tx: { worker: Worker | null; running: boolean; cancel: boolean; reject: ((err: Error) => void) | null } =
  { worker: null, running: false, cancel: false, reject: null };
const SR = 16000;
const WINDOW_S = 300;

// Phrases Whisper tends to hallucinate on silence or music (Spanish and English)
const HALLUCINATIONS = /amara\.org|subt[ií]tulos (realizados|por|creados)|suscr[ií]bete|gracias por ver|thanks for watching|please subscribe/i;

function setTxStatus(text: string, pct?: number) {
  $('#tx-progress').hidden = false;
  $('#tx-status').textContent = text;
  if (pct != null) $('#tx-bar').style.width = `${Math.max(0, Math.min(100, pct))}%`;
  $('#transcribe-btn').textContent = tx.running && pct != null ? T('tx.progress', { n: Math.round(pct) }) : T('header.transcribe');
}

function workerCall<R extends WorkerReply>(msg: unknown, transfer: Transferable[] = []): Promise<R> {
  return new Promise((resolve, reject) => {
    const w = tx.worker!;
    tx.reject = reject;
    const cleanup = () => { w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr); tx.reject = null; };
    const onMsg = ({ data }: MessageEvent<WorkerReply>) => {
      if (data.type === 'download') {
        return setTxStatus(T('tx.downloading', { file: data.file || '' }), data.progress);
      }
      cleanup();
      if (data.type === 'error') reject(new Error(data.message)); else resolve(data as R);
    };
    const onErr = (e: ErrorEvent) => { cleanup(); reject(new Error(e.message || T('tx.failed'))); };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    w.postMessage(msg, transfer);
  });
}

async function pickDevice(): Promise<'webgpu' | 'wasm'> {
  try { if (navigator.gpu && await navigator.gpu.requestAdapter()) return 'webgpu'; } catch {}
  return 'wasm';
}

// Finds the quietest 0.1 s block near t so words aren't cut
function quietBoundary(pcm: Float32Array, t: number, radius = 3): number {
  const blk = SR / 10;
  let best = t, bestE = Infinity;
  for (let s = Math.max(0, t - radius); s < t + radius; s += 0.1) {
    const a = Math.floor(s * SR);
    let e = 0;
    for (let i = a; i < a + blk && i < pcm.length; i++) e += pcm[i] * pcm[i];
    if (e < bestE) { bestE = e; best = s + 0.05; }
  }
  return best;
}

function cleanSegments(segs: Segment[], keepSounds: boolean): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    let text = s.text.replace(/\s+/g, ' ').trim()
      .replace(/(\[[^\]]+\]|\([^)]+\))(\s*\1)+/gi, '$1'); // "[music] [music]" → "[music]"
    if (!keepSounds) text = text.replace(/\[[^\]]*\]|\([^)]*\)|♪+/g, '').replace(/\s{2,}/g, ' ').trim();
    if (!text || HALLUCINATIONS.test(text)) continue;
    const prev = out[out.length - 1];
    if (prev && prev.text === text && s.start - prev.end < 1) { prev.end = s.end; continue; } // repetitions
    out.push({ ...s, text });
  }
  return out;
}

// Splits long segments and turns them into subtitles that follow the rules
function segmentsToCues(segs: Segment[]): Cue[] {
  const maxLen = settings.maxChars * settings.maxLines;
  const pieces: Segment[] = [];
  for (const s of segs) {
    const dur = s.end - s.start;
    // Split by text length; if it fits, only shorten the duration (Whisper often includes silence or music)
    const n = Math.max(1, Math.ceil(s.text.length / maxLen));
    if (n === 1) {
      const end = dur > settings.maxDur ? s.start + Math.min(settings.maxDur, Math.max(2, s.text.length / 10)) : s.end;
      pieces.push({ ...s, end });
      continue;
    }
    const words = s.text.split(' ');
    const target = s.text.length / n;
    let cur: string[] = [], len = 0, t = s.start;
    words.forEach((w, k) => {
      cur.push(w);
      len += w.length + 1;
      const last = k === words.length - 1;
      const atPunct = /[,.;:?!…]$/.test(w);
      if (last || len >= target * 1.1 || (atPunct && len >= target * 0.6)) {
        const txt = cur.join(' ');
        const end = last ? s.end : t + dur * (txt.length / s.text.length);
        pieces.push({ start: t, end, text: txt });
        t = end;
        cur = [];
        len = 0;
      }
    });
  }
  const g = gapSec();
  const cues = pieces.map(p => newCue(p.start, Math.max(p.end, p.start + 0.3), balanceText(p.text)));
  cues.forEach((c, i) => {
    const next = cues[i + 1];
    if (c.end - c.start < settings.minDur) c.end = c.start + settings.minDur;
    if (next && c.end > next.start - g) c.end = Math.max(c.start + MIN_DUR, next.start - g);
  });
  return cues;
}

function applyTranscription(cues: Cue[], mode: string, startAt: number) {
  if (!cues.length) return toast(T('tx.noSpeech'), true);
  pushHistory();
  let added = cues;
  if (mode === 'gaps') {
    added = cues.filter(n => !state.cues.some(c => Math.min(c.end, n.end) - Math.max(c.start, n.start) > 0.2));
    state.cues.push(...added);
  } else {
    state.cues = state.cues.filter(c => c.end <= startAt).concat(cues);
  }
  sortCues();
  if (state.srtName === 'subtitles.srt' && state.video) state.srtName = state.video.name.replace(/\.[^.]+$/, '') + '.srt';
  $('#srt-name').textContent = state.srtName;
  commit();
  toast(T('tx.created', { n: added.length }), { undo: true });
}

export async function runTranscription() {
  if (!state.video) return toast(T('toast.openVideo'), true);
  const value = (sel: string) => $<HTMLSelectElement>(sel).value;
  const model = value('#tx-model'), language = value('#tx-lang'), mode = value('#tx-mode');
  const startAt = $<HTMLInputElement>('#tx-from-now').checked ? getTime() : 0;
  tx.running = true;
  tx.cancel = false;
  $<HTMLButtonElement>('#tx-start').disabled = true;
  $('#tx-cancel').hidden = false;
  try {
    setTxStatus(T('tx.extracting'), 0);
    const audio = await decodeAudio(SR);
    let pcm = audio.getChannelData(0);
    if (audio.numberOfChannels > 1) {
      const n = audio.numberOfChannels, mix = new Float32Array(audio.length);
      for (let c = 0; c < n; c++) { const d = audio.getChannelData(c); for (let i = 0; i < d.length; i++) mix[i] += d[i] / n; }
      pcm = mix;
    }
    if (tx.cancel) throw new Error('cancelled');
    tx.worker = new Worker(new URL('../workers/whisper-worker.js', import.meta.url), { type: 'module' });
    setTxStatus(T('tx.preparing'), 0);
    const { device } = await workerCall<Extract<WorkerReply, { type: 'ready' }>>({ type: 'load', model, device: await pickDevice() });
    const total = pcm.length / SR;
    const segs: Segment[] = [];
    let pos = startAt;
    while (pos < total - 0.5) {
      if (tx.cancel) throw new Error('cancelled');
      let end = Math.min(total, pos + WINDOW_S);
      if (end < total) end = quietBoundary(pcm, end);
      const slice = pcm.slice(Math.floor(pos * SR), Math.floor(end * SR));
      setTxStatus(T('tx.chunk', { from: fmt(pos).slice(0, 8), to: fmt(end).slice(0, 8), total: fmt(total).slice(0, 8), device: device === 'webgpu' ? 'GPU' : T('tx.cpu') }),
        (pos - startAt) / (total - startAt) * 100);
      const res = await workerCall<Extract<WorkerReply, { type: 'result' }>>({ type: 'run', audio: slice, language }, [slice.buffer]);
      for (const ch of res.chunks) {
        const [s, e] = ch.timestamp || [0, null];
        const st = pos + (s ?? 0);
        const en = pos + (e ?? Math.min(end - pos, (s ?? 0) + 5));
        segs.push({ start: st, end: Math.max(en, st + 0.3), text: ch.text || '' });
      }
      pos = end;
    }
    setTxStatus(T('tx.creating'), 100);
    applyTranscription(segmentsToCues(cleanSegments(segs, $<HTMLInputElement>('#tx-sounds').checked)), mode, startAt);
    $<HTMLDialogElement>('#transcribe').close();
  } catch (e) {
    const err = e as Error;
    if (err.message === 'cancelled') {
      toast(T('tx.cancelled'));
      setTxStatus(T('tx.cancelledStatus'));
    } else {
      console.error(err);
      toast(T('tx.error', { msg: err.message }), true);
      setTxStatus(T('tx.errorStatus', { msg: err.message }));
    }
  } finally {
    tx.worker?.terminate();
    tx.worker = null;
    tx.running = false;
    $<HTMLButtonElement>('#tx-start').disabled = false;
    $('#tx-cancel').hidden = true;
    $('#transcribe-btn').textContent = T('header.transcribe');
  }
}

export function openTranscribe() {
  if (!state.video) return toast(T('toast.openVideo'), true);
  if (!tx.running) $('#tx-progress').hidden = true;
  $<HTMLDialogElement>('#transcribe').showModal();
}

$('#transcribe-btn').addEventListener('click', openTranscribe);
$('#tx-close').addEventListener('click', () => $<HTMLDialogElement>('#transcribe').close()); // keeps running in the background
$('#tx-start').addEventListener('click', runTranscription);
$('#tx-cancel').addEventListener('click', () => {
  tx.cancel = true;
  tx.worker?.terminate();
  tx.reject?.(new Error('cancelled'));
});
