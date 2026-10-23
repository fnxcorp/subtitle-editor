// Opening subtitles, translations and videos (picker, drag & drop, desktop app) and exporting.
import { state } from '../core/state.ts';
import { pushHistory, sortCues, commit } from '../core/cues.ts';
import { parseSubs, toSRT, toVTT } from '../core/subtitles.ts';
import { joinTexts } from '../core/text.ts';
import { T } from '../core/i18n.ts';
import { $, video, listEl } from '../ui/dom.ts';
import { toast } from '../ui/toast.ts';
import { toggleMenu } from '../ui/menus.ts';
import { updateIssues } from './quality.ts';
import { saveLocal, flushSave, serverInfo, originalDirty, markOriginalSaved } from './saving.ts';
import { buildWaveform } from './waveform.ts';
import { loadCuts } from './scenes.ts';
import type { DiskFile, Field, VideoSource } from '../core/types.ts';

type DiskSource = Omit<DiskFile, 'vtt'> | null;
const diskFile = (source: DiskSource, name: string): DiskFile | null => source && { ...source, vtt: /\.vtt$/i.test(name) };

// UTF-8 first; old SRT files are often Latin-1
function decodeText(buf: ArrayBuffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

export function loadSubsText(text: string, name: string, source: DiskSource = null) {
  const cues = parseSubs(text);
  if (!cues.length) return toast(T('toast.noValid', { name }), true);
  if (state.cues.length) pushHistory();
  state.cues = cues;
  sortCues();
  state.selectedId = null;
  state.selection = new Set();
  state.original = diskFile(source, name);
  state.originalTr = null;
  state.srtName = name.replace(/\.(srt|vtt|txt)$/i, '') + '.srt';
  $('#srt-name').textContent = name;
  listEl.scrollTop = 0;
  commit();
  markOriginalSaved();
  flushSave();
  toast(T('toast.loaded', { n: cues.length }), { undo: state.undo.length > 0 });
}

// Matches a translation to the existing subtitles by overlapping time
export function loadTranslationText(text: string, name: string, source: DiskSource = null) {
  const tr = parseSubs(text);
  if (!tr.length) return toast(T('toast.noValid', { name }), true);
  if (!state.cues.length) return loadSubsText(text, name, source);
  pushHistory();
  state.originalTr = diskFile(source, name);
  const clean = !originalDirty();
  state.cues.forEach(c => { c.tr = ''; });
  let matched = 0;
  for (const t of tr) {
    let best = null, bestOv = 0;
    for (const c of state.cues) {
      const ov = Math.min(c.end, t.end) - Math.max(c.start, t.start);
      if (ov > bestOv) { bestOv = ov; best = c; }
      if (c.start > t.end) break;
    }
    if (best) { best.tr = joinTexts(best.tr, t.text, '\n'); matched++; }
  }
  commit();
  if (clean) markOriginalSaved();
  toast(T('toast.trLoaded', { matched, n: tr.length }), { undo: true });
}

async function loadSubs(file: File, asTranslation = false, handle: FileSystemFileHandle | null = null) {
  const url = await window.desktop?.register(file);
  const text = decodeText(await (url ? (await fetch(url)).arrayBuffer() : file.arrayBuffer()));
  const source = url ? { token: url.split('/')[2] } : handle ? { handle } : null;
  if (asTranslation) loadTranslationText(text, file.name, source); else loadSubsText(text, file.name, source);
}

async function loadMedia(f: File) {
  const url = await window.desktop?.register(f);
  if (url) setVideo({ name: f.name, size: f.size, url, token: url.split('/')[2] });
  else setVideo({ name: f.name, size: f.size, url: URL.createObjectURL(f), file: f });
}

// v: { name, size, url, file? (browser File), token? (desktop: file served by server.js) }
export function setVideo(v: VideoSource) {
  if (state.video?.file && state.video.url) URL.revokeObjectURL(state.video.url);
  state.video = v;
  state.videoLoaded = false;
  state.peaks = null;
  state.fpsDetected = 0;
  video.src = v.url;
  $('#video-name').textContent = v.name;
  $('#drop-hint').hidden = true;
  loadCuts();
  saveLocal();
  if (v.size < 800e6 || (v.token && serverInfo.ffmpeg)) buildWaveform();
  else toast(T('toast.bigVideo'));
}

const isSubFile = (f: File) => /\.(srt|vtt|txt)$/i.test(f.name);
const isMediaFile = (f: File) => /^(video|audio)\//.test(f.type) || /\.(mp4|m4v|mov|mkv|webm|ogv|mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name);

export function handleFiles(files: FileList | File[], asTranslation = false, handles: (FileSystemFileHandle | null)[] = []) {
  for (const [i, f] of [...files].entries()) {
    if (isSubFile(f)) loadSubs(f, asTranslation, handles[i]);
    else if (isMediaFile(f)) loadMedia(f);
    else toast(T('toast.badFormat', { name: f.name }), true);
  }
}

// Files opened by the desktop app arrive as URLs served by server.js (/media/<token>/<name>)
export function openDesktopFile(f: DesktopFile) {
  if (f.kind === 'subs') {
    fetch(f.url).then(r => r.arrayBuffer()).then(buf => loadSubsText(decodeText(buf), f.name, { token: f.url.split('/')[2] }));
  } else {
    setVideo({ name: f.name, size: f.size, url: f.url, token: f.url.split('/')[2] });
  }
}

// Uses the browser's "Save as" dialog when available, otherwise a download
export async function exportFile(kind: 'srt' | 'vtt' = 'srt', field: Field = 'text') {
  if (!state.cues.length) return toast(T('toast.nothingExport'), true);
  const text = kind === 'vtt' ? toVTT(field) : toSRT(field);
  const name = state.srtName.replace(/\.srt$/i, '') + (field === 'tr' ? '.translation' : '') + '.' + kind;
  const warn = () => {
    const n = updateIssues();
    return n ? T('toast.exportWarn', { n }) : '';
  };
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: T('toast.subsKind', { kind: kind.toUpperCase() }), accept: { 'text/plain': ['.' + kind] } }],
      });
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
      return toast(T('toast.exported', { name: handle.name }) + warn(), updateIssues() > 0);
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(T('toast.downloaded', { name }) + warn(), updateIssues() > 0);
}

/* ---------- Controls ---------- */

// File inputs: open the chosen files, then clear the input so the same file can be chosen again
const onFileInput = (sel: string, asTranslation = false) => $<HTMLInputElement>(sel).addEventListener('change', e => {
  const input = e.target as HTMLInputElement;
  if (input.files) handleFiles(input.files, asTranslation);
  input.value = '';
});
onFileInput('#srt-input');
onFileInput('#video-input');
onFileInput('#tr-input', true);

// Chrome/Edge: the picker returns a file handle, so Ctrl+S can write the opened file back
const pickSubs = (sel: string, asTranslation = false) => $(sel).addEventListener('click', async e => {
  if (!window.showOpenFilePicker || window.desktop) return;
  e.preventDefault();
  try {
    const [handle] = await window.showOpenFilePicker({ types: [{ description: T('toast.subsKind', { kind: 'SRT / VTT' }), accept: { 'text/plain': ['.srt', '.vtt', '.txt'] } }] });
    loadSubs(await handle.getFile(), asTranslation, handle);
  } catch {} // picker cancelled
});
pickSubs('#srt-input');
pickSubs('#tr-input', true);

const wrap = $('#video-wrap');
window.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('dragover'); });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) wrap.classList.remove('dragover'); });
window.addEventListener('drop', async e => {
  e.preventDefault();
  wrap.classList.remove('dragover');
  if (!e.dataTransfer) return;
  const files = [...e.dataTransfer.files];
  // File handles (Chrome/Edge) must be requested before the first await, while the drop data is alive
  const pending = [...e.dataTransfer.items].filter(i => i.kind === 'file').map(i => i.getAsFileSystemHandle?.().catch(() => null) ?? null);
  const handles = await Promise.all(pending);
  handleFiles(files, false, handles.map(h => (h?.kind === 'file' ? h as FileSystemFileHandle : null)));
});

$('#export-btn').addEventListener('click', e => { e.stopPropagation(); toggleMenu($('#export-menu')); });
$('#export-menu').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  toggleMenu($('#export-menu'), false);
  exportFile(b.dataset.kind as 'srt' | 'vtt', b.dataset.field as Field);
});
