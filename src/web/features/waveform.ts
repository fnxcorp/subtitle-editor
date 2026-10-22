// Audio decoding and the waveform shown on the timeline.
import { state } from '../core/state.ts';
import { T } from '../core/i18n.ts';
import { $ } from '../ui/dom.ts';
import { toast } from '../ui/toast.ts';
import { requestDraw } from './timeline.ts';

function videoArrayBuffer(): Promise<ArrayBuffer> {
  const v = state.video!;
  return v.file ? v.file.arrayBuffer() : fetch(v.url).then(r => r.arrayBuffer());
}

// Decodes the current video's audio. A low sample rate greatly reduces the memory needed
export async function decodeAudio(sampleRate: number): Promise<AudioBuffer> {
  const buf = await videoArrayBuffer();
  return new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(buf);
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
    toast(T('toast.noAudio'), true);
  } finally {
    btn.disabled = false;
    btn.textContent = T('tools.waveform');
  }
}

$('#wave-btn').addEventListener('click', buildWaveform);
