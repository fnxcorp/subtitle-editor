// Saving: autosave goes to localStorage and the working copy on disk (through server.js);
// only an explicit save (Ctrl+S) writes the original files (subtitles and translation), when
// they were opened from disk (desktop app) or with a file handle (Chrome/Edge).
import { state } from '../core/state.ts';
import { newCue } from '../core/cues.ts';
import { toSRT, toVTT } from '../core/subtitles.ts';
import { escapeHtml, hasTranslation } from '../core/text.ts';
import { I18N, T } from '../core/i18n.ts';
import { $ } from '../ui/dom.ts';
import { toast } from '../ui/toast.ts';
import { handleFiles } from './files.ts';
import type { DiskFile, Field, SavedSession } from '../core/types.ts';

const STORAGE_KEY = 'subeditor:v1';

// version counts changes; saved is the last version written. server: null = unknown, false = no server
export const save: {
  version: number;                         // counts changes
  saved: number;                           // last version written
  timer: ReturnType<typeof setTimeout> | undefined;
  server: boolean | null;                  // null = unknown yet, false = no local server
  path: string;                            // working copy on disk
  at: Date | null;                         // last successful save
  inflight: boolean;
  originalSaved: number;                   // version last written to the original files
} = { version: 0, saved: 0, timer: undefined, server: null, path: '', at: null, inflight: false, originalSaved: 0 };

// Filled from /api/info at startup
export const serverInfo: { copiesDir?: string; ffmpeg?: boolean; whisper?: boolean } = {};

const TITLE = document.title;

function sessionData(): SavedSession {
  return {
    cues: state.cues, srtName: state.srtName,
    videoName: state.video?.name || state.lastSession?.videoName || '',
    videoSize: state.video?.size || state.lastSession?.videoSize || 0,
  };
}

export function saveLocal() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData())); } catch {}
}

function copyPayload() {
  return JSON.stringify({ name: state.srtName, srt: toSRT('text'), tr: hasTranslation() ? toSRT('tr') : null });
}

export function scheduleSave() {
  save.version++;
  updateSaveStatus();
  clearTimeout(save.timer);
  save.timer = setTimeout(flushSave, 1200);
}

export async function flushSave() {
  clearTimeout(save.timer);
  saveLocal();
  const v = save.version;
  if (!state.cues.length || save.server === false) { save.saved = v; return updateSaveStatus(); }
  if (save.inflight) { save.timer = setTimeout(flushSave, 500); return; }
  save.inflight = true;
  try {
    const res = await fetch('/api/copy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: copyPayload() });
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    save.server = true;
    save.path = j.path;
    save.at = new Date();
    save.saved = v;
  } catch {
    save.server = false;
    save.saved = v;
    toast(T('save.failed'), true);
  } finally {
    save.inflight = false;
    updateSaveStatus();
  }
}

// Edits not yet written to the original files with Ctrl+S
export const originalDirty = () => !!(state.original || state.originalTr) && save.version !== save.originalSaved;
export function markOriginalSaved(v = save.version) {
  save.originalSaved = v;
  updateSaveStatus();
}

async function writeDisk(f: DiskFile, field: Field): Promise<string> {
  const text = f.vtt ? toVTT(field) : toSRT(field);
  if (f.handle) {
    if (f.handle.requestPermission && await f.handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('permission denied');
    const w = await f.handle.createWritable();
    await w.write(text);
    await w.close();
    return f.handle.name;
  }
  const res = await fetch('/api/save-original', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: f.token, text }) });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()).path;
}

// Ctrl+S: working copy first, then the original files (subtitles and translation) when known
export async function saveNow() {
  await flushSave();
  const targets: [DiskFile, Field][] = [];
  if (state.original) targets.push([state.original, 'text']);
  if (state.originalTr && hasTranslation()) targets.push([state.originalTr, 'tr']);
  if (!targets.length || !state.cues.length) { if (save.server) toast(T('save.saved', { path: save.path })); return; }
  const v = save.version;
  try {
    const paths: string[] = [];
    for (const [f, field] of targets) paths.push(await writeDisk(f, field));
    markOriginalSaved(v);
    toast(T('save.savedOriginal', { path: paths.join(' · ') }));
  } catch {
    toast(T('save.originalFailed'), true);
  }
}

export function updateSaveStatus() {
  const el = $('#save-status');
  const pending = save.version !== save.saved;
  document.title = (originalDirty() ? '• ' : '') + TITLE;
  el.className = 'save-status ' + (pending ? 'pending' : save.server ? 'ok' : 'local');
  if (pending) {
    el.textContent = T('save.unsaved');
    el.title = T('save.saving');
  } else if (save.server && save.at) {
    el.textContent = T('save.copy', { time: save.at.toLocaleTimeString(I18N.lang, { hour: '2-digit', minute: '2-digit' }) });
    el.title = T('save.copyTitle', { path: save.path });
  } else if (save.server === false) {
    el.textContent = T('save.local');
    el.title = T('save.localTitle');
  } else {
    el.textContent = '—';
    el.title = '';
  }
}

export const revealCopies = () => fetch('/api/reveal', { method: 'POST' });

// Restores the last session from localStorage and offers to reopen its video
export function restoreSession() {
  try {
    const d = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as SavedSession | null;
    if (!d) return;
    state.lastSession = d;
    if (Array.isArray(d.cues) && d.cues.length) {
      state.cues = d.cues.map(c => newCue(c.start, c.end, c.text, { ...(c.tr ? { tr: c.tr } : {}), ...(c.top ? { top: true } : {}) }));
      state.srtName = d.srtName || state.srtName;
      $('#srt-name').textContent = state.srtName;
      toast(T('toast.restored', { n: state.cues.length }));
    }
    if (d.videoName) {
      const el = $('#last-video');
      el.hidden = false;
      el.innerHTML = `${T('video.lastVideo', { name: escapeHtml(d.videoName) })} <label class="btn primary">${T('video.openAgain')}<input type="file" accept="video/*,audio/*,.mkv,.mov" hidden></label>`;
      $<HTMLInputElement>('input', el).addEventListener('change', e => { const f = (e.target as HTMLInputElement).files; if (f) handleFiles(f); });
    }
  } catch {}
}

// Asks the server where copies go; without a server the app still works, saving only in the browser
export async function connectServer() {
  try {
    Object.assign(serverInfo, await (await fetch('/api/info')).json());
    save.server = true;
    $('#copies-dir').textContent = serverInfo.copiesDir ?? '—';
    if (window.desktop && !serverInfo.ffmpeg) {
      try {
        if (!localStorage.getItem('subeditor:ffmpegHint')) { toast(T('toast.noFfmpeg')); localStorage.setItem('subeditor:ffmpegHint', '1'); }
      } catch {}
    }
  } catch {
    save.server = false;
  }
  updateSaveStatus();
  if (state.cues.length) flushSave();
}

window.addEventListener('beforeunload', e => {
  saveLocal();
  if (originalDirty()) { e.preventDefault(); e.returnValue = ''; } // the desktop app asks in will-prevent-unload
  if (save.version !== save.saved && state.cues.length) {
    const ok = save.server !== false && navigator.sendBeacon?.('/api/copy', new Blob([copyPayload()], { type: 'application/json' }));
    if (!ok) { e.preventDefault(); e.returnValue = ''; }
  }
});

$('#save-status').addEventListener('click', () => { if (save.server) revealCopies(); });
