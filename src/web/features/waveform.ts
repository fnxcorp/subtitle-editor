// Audio decoding and the waveform shown on the timeline.
import { state } from '../core/state.ts';
import { T } from '../core/i18n.ts';
import { $ } from '../ui/dom.ts';
import { toast } from '../ui/toast.ts';
import { requestDraw } from './timeline.ts';
import { serverInfo } from './saving.ts';

function videoArrayBuffer(): Promise<ArrayBuffer> {
  const v = state.video!;
  // Reading it whole would crash the page (out of memory) before decoding even starts
  if (v.size > 1.5e9) return Promise.reject(new Error('file too large to decode in the browser'));
  return v.file ? v.file.arrayBuffer() : fetch(v.url).then(r => r.arrayBuffer());
}

// Decodes the current video's audio. A low sample rate greatly reduces the memory needed
// Files opened from disk go through ffmpeg when available: it handles any codec and any size
// (the browser path reads the whole file into memory, which fails for multi-GB videos)
export async function decodeAudio(sampleRate: number): Promise<AudioBuffer> {
  const token = state.video?.token;
  if (token && serverInfo.ffmpeg) return decodeWithFfmpeg(token, sampleRate);
  return new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(await videoArrayBuffer());
}

async function decodeWithFfmpeg(token: string, sampleRate: number): Promise<AudioBuffer> {
  const res = await fetch(`/api/audio/${token}?rate=${sampleRate}`);
  if (!res.ok) throw new Error(`ffmpeg audio: ${res.status}`);
  const pcm = new Float32Array(await res.arrayBuffer());
  if (!pcm.length) throw new Error('ffmpeg audio: no audio stream');
  const audio = new AudioBuffer({ length: pcm.length, sampleRate, numberOfChannels: 1 });
  audio.copyToChannel(pcm, 0);
  return audio;
}

export async function buildWaveform() {
  const v = state.video;
  if (!v) return toast(T('toast.openVideo'));
  const btn = $<HTMLButtonElement>('#wave-btn');
  btn.disabled = true;
  btn.textContent = T('tools.analyzing');
  try {
    const audio = await decodeAudio(8000);
    const step = audio.sampleRate / state.peaksRate;
    const n = Math.ceil(audio.length / step);
    const chans = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    const peaks = new Float32Array(n);
    let max = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * step), b = Math.min(audio.length, Math.floor((i + 1) * step));
      let m = 0;
      for (const ch of chans) for (let j = a; j < b; j++) { const x = Math.abs(ch[j]); if (x > m) m = x; }
      peaks[i] = m;
      if (m > max) max = m;
    }
    if (max > 0) for (let i = 0; i < n; i++) peaks[i] = Math.sqrt(peaks[i] / max);
    if (v === state.video) { state.peaks = peaks; requestDraw(); }
  } catch (err) {
    console.error(err);
    toast(T('toast.noAudio') + (v.token ? '' : T('toast.noAudioWeb')), true);
  } finally {
    btn.disabled = false;
    btn.textContent = T('tools.waveform');
  }
}

$('#wave-btn').addEventListener('click', buildWaveform);
