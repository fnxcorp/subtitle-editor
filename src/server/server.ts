// Minimal local server, no dependencies. Editing happens in the browser; the server only
// serves the UI, stores the working copies (it never touches the original file) and, in the
// desktop app, streams the videos opened from disk.
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
        return json(res, 200, { copiesDir, ffmpeg: await checkFfmpeg() });
      }
      if (p === '/api/copy' && req.method === 'POST') {
        const data = JSON.parse(await readBody(req));
        if (typeof data.srt !== 'string') return json(res, 400, { error: 'srt required' });
        const file = saveCopy(copiesDir, data);
        return json(res, 200, { path: file, savedAt: Date.now() });
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
