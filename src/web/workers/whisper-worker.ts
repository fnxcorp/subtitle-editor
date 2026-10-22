// Whisper in a Web Worker with Transformers.js. Models are downloaded once from
// Hugging Face and kept in the browser cache; the audio never leaves the computer.
// Messages: in { type: 'load', model, device } | { type: 'run', audio, language }
//           out { type: 'download' | 'ready' | 'result' | 'error', ... } (see WorkerReply in transcribe.ts)
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

type Asr = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;
type Request = { type: 'load'; model: string; device: 'webgpu' | 'wasm' } | { type: 'run'; audio: Float32Array; language: string };

// This file runs in a worker, but is type-checked with the DOM library: describe the bits we use
const worker = self as unknown as { postMessage(msg: unknown): void; onmessage: ((e: MessageEvent<Request>) => void) | null };

env.allowLocalModels = false;
let asr: Asr | null = null;

async function load(model: string, device: 'webgpu' | 'wasm'): Promise<'webgpu' | 'wasm'> {
  const progress_callback = (p: { status: string; file?: string; progress?: number }) => {
    if (p.status === 'progress') worker.postMessage({ type: 'download', file: p.file, progress: p.progress });
  };
  const id = `onnx-community/whisper-${model}`;
  if (device === 'webgpu') {
    try {
      asr = await pipeline('automatic-speech-recognition', id, {
        device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, progress_callback,
      }) as Asr;
      return 'webgpu';
    } catch (err) {
      console.warn('WebGPU unavailable, falling back to CPU', err);
    }
  }
  asr = await pipeline('automatic-speech-recognition', id, { device: 'wasm', dtype: 'q8', progress_callback }) as Asr;
  return 'wasm';
}

worker.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      const device = await load(data.model, data.device);
      worker.postMessage({ type: 'ready', device });
    } else if (data.type === 'run') {
      const opts: Record<string, unknown> = { task: 'transcribe', return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 };
      if (data.language) opts.language = data.language;
      const out = await asr!(data.audio, opts);
      const chunks = out.chunks && out.chunks.length ? out.chunks : [{ text: out.text || '', timestamp: [0, null] }];
      worker.postMessage({ type: 'result', chunks });
    }
  } catch (err) {
    worker.postMessage({ type: 'error', message: String((err as Error)?.message || err) });
  }
};
