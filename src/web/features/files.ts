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
import { saveLocal, flushSave } from './saving.ts';
import { buildWaveform } from './waveform.ts';
import { loadCuts } from './scenes.ts';
import type { Field, VideoSource } from '../core/types.ts';

// UTF-8 first; old SRT files are often Latin-1
function decodeText(buf: ArrayBuffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

export function loadSubsText(text: string, name: string) {
  const cues = parseSubs(text);
  if (!cues.length) return toast(T('toast.noValid', { name }), true);
  if (state.cues.length) pushHistory();
  state.cues = cues;
  sortCues();
  state.selectedId = null;
  state.selection = new Set();
  state.srtName = name.replace(/\.(srt|vtt|txt)$/i, '') + '.srt';
  $('#srt-name').textContent = name;
  listEl.scrollTop = 0;
  commit();
  flushSave();
  toast(T('toast.loaded', { n: cues.length }), { undo: state.undo.length > 0 });
}

// Matches a translation to the existing subtitles by overlapping time
export function loadTranslationText(text: string, name: string) {
  const tr = parseSubs(text);
  if (!tr.length) return toast(T('toast.noValid', { name }), true);
  if (!state.cues.length) return loadSubsText(text, name);
  pushHistory();
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
  toast(T('toast.trLoaded', { matched, n: tr.length }), { undo: true });
}

async function loadSubs(file: File, asTranslation = false) {
  const text = decodeText(await file.arrayBuffer());
  if (asTranslation) loadTranslationText(text, file.name); else loadSubsText(text, file.name);
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
  if (v.size < 800e6) buildWaveform();
  else toast(T('toast.bigVideo'));
}

const isSubFile = (f: File) => /\.(srt|vtt|txt)$/i.test(f.name);
const isMediaFile = (f: File) => /^(video|audio)\//.test(f.type) || /\.(mp4|m4v|mov|mkv|webm|ogv|mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name);

export function handleFiles(files: FileList | File[], asTranslation = false) {
  for (const f of files) {
    if (isSubFile(f)) loadSubs(f, asTranslation);
    else if (isMediaFile(f)) setVideo({ name: f.name, size: f.size, url: URL.createObjectURL(f), file: f });
    else toast(T('toast.badFormat', { name: f.name }), true);
  }
}

// Files opened by the desktop app arrive as URLs served by server.js (/media/<token>/<name>)
export function openDesktopFile(f: DesktopFile) {
  if (f.kind === 'subs') {
    fetch(f.url).then(r => r.arrayBuffer()).then(buf => loadSubsText(decodeText(buf), f.name));
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

const wrap = $('#video-wrap');
window.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('dragover'); });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) wrap.classList.remove('dragover'); });
window.addEventListener('drop', e => {
  e.preventDefault();
  wrap.classList.remove('dragover');
  if (e.dataTransfer) handleFiles(e.dataTransfer.files);
});

$('#export-btn').addEventListener('click', e => { e.stopPropagation(); toggleMenu($('#export-menu')); });
$('#export-menu').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  toggleMenu($('#export-menu'), false);
  exportFile(b.dataset.kind as 'srt' | 'vtt', b.dataset.field as Field);
});
