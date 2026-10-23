// Minimal local server, no dependencies. Editing happens in the browser; the server only
// serves the UI, stores the working copies (autosave), writes the original file only on an explicit
// save (Ctrl+S) and, in the desktop app, streams the files opened from disk.
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { exec, execFile, spawn } from 'node:child_process';

// Compiled to build/src/server/server.js, so the project root is three levels up
const ROOT = path.resolve(__dirname, '..', '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
};
const BACKUP_EVERY_MS = 5 * 60 * 1000;
const BACKUPS_KEPT = 30;

const WHISPER_MODELS = path.join(os.homedir(), '.cache', 'subtitle-editor', 'whisper');
const WHISPER_MODEL = /^(tiny|base|small|medium|large-v3-turbo)$/;

// Apps started from Finder get a minimal PATH without Homebrew, where ffmpeg and whisper-cli live
for (const dir of ['/opt/homebrew/bin', '/usr/local/bin']) {
  if (process.platform !== 'win32' && !process.env.PATH?.split(path.delimiter).includes(dir)) process.env.PATH += path.delimiter + dir;
}

const media = new Map<string, string>(); // token -> absolute path (only files opened from the desktop app)
let hasFfmpeg: boolean | null = null;

export function registerFile(file: string): string {
  const token = crypto.randomBytes(12).toString('hex');
  media.set(token, file);
  return `/media/${token}/${encodeURIComponent(path.basename(file))}`;
}

function safeBase(name: unknown): string {
  return String(name || 'subtitles').replace(/\.(srt|vtt|txt)$/i, '')
    // eslint-disable-next-line no-control-regex -- control characters are invalid in file names
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, '_').slice(0, 120) || 'subtitles';
}

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function readBody(req: http.IncomingMessage, limit = 30e6): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, code: number, data: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// Saves the working copy and, at most every 5 minutes, a snapshot in the history
function saveCopy(dir: string, { name, srt, tr }: { name?: string; srt: string; tr?: string | null }): string {
  const base = safeBase(name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${base}.working-copy.srt`);
  const histDir = path.join(dir, 'history', base);
  let lastBackup = 0;
  try { lastBackup = Math.max(0, ...fs.readdirSync(histDir).map(f => fs.statSync(path.join(histDir, f)).mtimeMs)); } catch {}
  if (fs.existsSync(file) && Date.now() - lastBackup > BACKUP_EVERY_MS) {
    fs.mkdirSync(histDir, { recursive: true });
    fs.copyFileSync(file, path.join(histDir, `${stamp()}.srt`));
    const old = fs.readdirSync(histDir).sort();
    old.slice(0, Math.max(0, old.length - BACKUPS_KEPT)).forEach(f => fs.unlinkSync(path.join(histDir, f)));
  }
  // Atomic write: write to a temp file, then rename
  const write = (target: string, text: string) => { fs.writeFileSync(target + '.tmp', text); fs.renameSync(target + '.tmp', target); };
  write(file, srt);
  if (tr) write(path.join(dir, `${base}.working-copy.translation.srt`), tr);
  return file;
}

// Explicit save over the original subtitle file (desktop only); keeps the untouched original once as a backup
function saveOriginal(dir: string, file: string, text: string) {
  const backup = path.join(dir, `${safeBase(path.basename(file))}.original${path.extname(file)}`);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  fs.writeFileSync(file + '.tmp', text);
  fs.renameSync(file + '.tmp', file);
}

function serveMedia(req: http.IncomingMessage, res: http.ServerResponse, file: string) {
  fs.stat(file, (err, st) => {
    if (err) { res.writeHead(404); return res.end(); }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? +range[1] : st.size - +range[2];
      let end = range[1] && range[2] ? +range[2] : st.size - 1;
      if (!range[1]) end = st.size - 1;
      if (start >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}` });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size });
      fs.createReadStream(file).pipe(res);
    }
  });
}

function which(names: string[]): string | null {
  const ext = process.platform === 'win32' ? '.exe' : '';
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const n of names) if (fs.existsSync(path.join(dir, n + ext))) return path.join(dir, n + ext);
  }
  return null;
}
const whisperBin = () => which(['whisper-cli', 'whisper-cpp']);

// Downloads a whisper.cpp model once (Hugging Face), reporting progress
async function whisperModel(model: string, progress: (pct: number) => void, signal: AbortSignal): Promise<string> {
  const file = path.join(WHISPER_MODELS, `ggml-${model}.bin`);
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(WHISPER_MODELS, { recursive: true });
  const res = await fetch(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`, { signal });
  if (!res.ok || !res.body) throw new Error(`model download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(file + '.part');
  let got = 0, last = 0;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      got += chunk.length;
      if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
      if (total && got - last > total / 100) { last = got; progress(got / total * 100); }
    }
  } finally {
    await new Promise(r => out.end(r));
  }
  fs.renameSync(file + '.part', file);
  return file;
}

function runProcess(cmd: string, args: string[], signal: AbortSignal, onStderr?: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], signal });
    let tail = '';
    p.stderr.on('data', (d: Buffer) => { const s = d.toString(); tail = (tail + s).slice(-500); s.split(/\r?\n/).forEach(l => onStderr?.(l)); });
    p.on('error', reject);
    p.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} failed: ${tail.trim().split('\n').pop()}`))));
  });
}

// whisper.cpp on a file opened from disk: ffmpeg → 16 kHz WAV → whisper-cli JSON → segments in seconds
async function whisperTranscribe(file: string, opts: { model: string; language: string; from: number }, send: (msg: object) => void, signal: AbortSignal) {
  const bin = whisperBin();
  if (!bin) throw new Error('whisper-cli is not installed (brew install whisper-cpp)');
  if (!(await checkFfmpeg())) throw new Error('ffmpeg is not installed');
  const model = await whisperModel(opts.model, pct => send({ download: pct }), signal);
  const tmp = path.join(os.tmpdir(), 'subtitle-editor', `whisper-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  try {
    send({ extracting: true });
    await runProcess('ffmpeg', ['-y', '-v', 'error', '-ss', String(opts.from), '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', tmp + '.wav'], signal);
    const threads = String(Math.max(1, os.availableParallelism() - 1));
    await runProcess(bin, ['-m', model, '-f', tmp + '.wav', '-l', opts.language || 'auto', '-t', threads, '-oj', '-of', tmp, '-pp'], signal, line => {
      const m = /progress\s*=\s*(\d+)%/.exec(line);
      if (m) send({ progress: +m[1] });
    });
    const out = JSON.parse(fs.readFileSync(tmp + '.json', 'utf8')) as { transcription?: { offsets: { from: number; to: number }; text: string }[] };
    return (out.transcription || []).map(s => ({ start: opts.from + s.offsets.from / 1000, end: opts.from + s.offsets.to / 1000, text: s.text }));
  } finally {
    for (const ext of ['.wav', '.json']) fs.rmSync(tmp + ext, { force: true });
  }
}

function checkFfmpeg(): Promise<boolean> {
  return new Promise(resolve => {
    if (hasFfmpeg !== null) { resolve(hasFfmpeg); return; }
    execFile('ffmpeg', ['-version'], err => resolve(hasFfmpeg = !err));
  });
}

// Converts a video the browser can't play (e.g. MKV) to MP4 in a temp folder
function remux(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const out = path.join(os.tmpdir(), 'subtitle-editor', `${path.parse(file).name}-${Date.now()}.mp4`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const args = ['-y', '-i', file, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out];
    const p = spawn('ffmpeg', args, { stdio: 'ignore' });
    p.on('error', reject);
    p.on('exit', code => {
      if (code === 0) return resolve(out);
      // If the video codec doesn't fit in MP4, re-encode to H.264
      const p2 = spawn('ffmpeg', ['-y', '-i', file, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { stdio: 'ignore' });
      p2.on('error', reject);
      p2.on('exit', c2 => (c2 === 0 ? resolve(out) : reject(new Error('ffmpeg failed'))));
    });
  });
}

// Keep using the legacy 'copias' folder if it exists, so existing copies aren't orphaned
function defaultCopiesDir() {
  const old = path.join(ROOT, 'copias');
  return fs.existsSync(old) ? old : path.join(ROOT, 'working-copies');
}

export function start({ port = Number(process.env.PORT) || 5173, copiesDir = process.env.SUBEDITOR_COPIES || defaultCopiesDir() }: { port?: number; copiesDir?: string } = {}): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let p = decodeURIComponent(url.pathname);

    // Write requests are only accepted from the app itself
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      const port = (server.address() as import('node:net').AddressInfo).port;
      if (origin && origin !== `http://localhost:${port}` && origin !== `http://127.0.0.1:${port}`) {
        res.writeHead(403); return res.end();
      }
    }

    try {
      if (p === '/api/info') {
        return json(res, 200, { copiesDir, ffmpeg: await checkFfmpeg(), whisper: !!whisperBin() });
      }
      if (p === '/api/copy' && req.method === 'POST') {
        const data = JSON.parse(await readBody(req));
        if (typeof data.srt !== 'string') return json(res, 400, { error: 'srt required' });
        const file = saveCopy(copiesDir, data);
        return json(res, 200, { path: file, savedAt: Date.now() });
      }
      if (p === '/api/save-original' && req.method === 'POST') {
        const data = JSON.parse(await readBody(req));
        const file = media.get(data.token);
        if (!file || !/\.(srt|vtt)$/i.test(file) || typeof data.text !== 'string') return json(res, 400, { error: 'not a subtitle file opened from disk' });
        saveOriginal(copiesDir, file, data.text);
        return json(res, 200, { path: file });
      }
      // Streams NDJSON: { download } / { extracting } / { progress } updates, then { segments } or { error }
      if (p.startsWith('/api/whisper/') && req.method === 'POST') {
        const file = media.get(p.split('/')[3]);
        const data = JSON.parse(await readBody(req));
        if (!file) return json(res, 404, { error: 'unknown file' });
        if (!WHISPER_MODEL.test(data.model) || !/^[a-z]{0,3}$/.test(data.language || '')) return json(res, 400, { error: 'bad model or language' });
        const abort = new AbortController();
        res.on('close', () => abort.abort());
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
        const send = (msg: object) => res.write(JSON.stringify(msg) + '\n');
        try {
          send({ segments: await whisperTranscribe(file, { model: data.model, language: data.language || '', from: Math.max(0, Number(data.from) || 0) }, send, abort.signal) });
        } catch (err) {
          send({ error: String((err as Error).message || err) });
        }
        return res.end();
      }
      if (p === '/api/reveal' && req.method === 'POST') {
        fs.mkdirSync(copiesDir, { recursive: true });
        const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
        execFile(cmd, [copiesDir]);
        return json(res, 200, { ok: true });
      }
      if (p.startsWith('/api/remux/') && req.method === 'POST') {
        const file = media.get(p.split('/')[3]);
        if (!file) return json(res, 404, { error: 'unknown file' });
        if (!(await checkFfmpeg())) return json(res, 400, { error: 'ffmpeg is not installed' });
        const out = await remux(file);
        return json(res, 200, { url: registerFile(out) });
      }
      // Mono float32 PCM through ffmpeg, for audio the browser can't decode (waveform, transcription)
      if (p.startsWith('/api/audio/')) {
        const file = media.get(p.split('/')[3]);
        if (!file) return json(res, 404, { error: 'unknown file' });
        if (!(await checkFfmpeg())) return json(res, 400, { error: 'ffmpeg is not installed' });
        const rate = String(Math.min(48000, Math.max(1000, Number(url.searchParams.get('rate')) || 16000)));
        const ff = spawn('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', rate, '-f', 'f32le', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        ff.stdout.pipe(res);
        req.on('close', () => ff.kill());
        return;
      }
      if (p.startsWith('/media/')) {
        const file = media.get(p.split('/')[2]);
        if (!file) { res.writeHead(404); return res.end(); }
        return serveMedia(req, res, file);
      }
    } catch (err) {
      return json(res, 500, { error: String((err as Error).message || err) });
    }

    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, url: `http://localhost:${(server.address() as import('node:net').AddressInfo).port}` });
    });
  });
}

if (require.main === module) {
  start().then(({ url }) => {
    console.log(`Subtitle Editor running at ${url}  (Ctrl+C to quit)`);
    if (process.env.NO_OPEN) return;
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
    exec(`${cmd} ${url}`);
  }).catch(err => {
    console.error(err.code === 'EADDRINUSE' ? 'Port already in use. Try: PORT=5174 npm start' : err);
    process.exit(1);
  });
}
