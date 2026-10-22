// The subtitle list: rendering rows, selection and the in-text keyboard behaviour.
import { state } from '../core/state.ts';
import { settings } from '../core/settings.ts';
import { byId, indexOf, selected, pushHistory, sortCues, commit } from '../core/cues.ts';
import { fmt, parseTime } from '../core/time.ts';
import { T } from '../core/i18n.ts';
import type { Cue, Field } from '../core/types.ts';
import { $, listEl } from '../ui/dom.ts';
import { toast } from '../ui/toast.ts';
import { cueIssues, readingStats, FIX_LABEL, updateIssues, fixCue } from './quality.ts';
import { getTime, seek, playCue } from './playback.ts';
import { renderOverlay } from './overlay.ts';
import { requestDraw } from './timeline.ts';
import { scheduleSave } from './saving.ts';
import {
  setStart, setEnd, splitCue, mergeNext, balanceCues, toggleTop, insertAfter, deleteCues, splitAtCaret, joinWithNext,
} from './editing.ts';

export const rowOf = (id: number | null): HTMLElement | null => listEl.querySelector(`.cue[data-id="${id}"]`);

// The cue a list element belongs to
const cueOf = (el: Element): Cue | undefined => byId(Number(el.closest<HTMLElement>('.cue')?.dataset.id));

function buildRow(c: Cue, i: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'cue';
  row.dataset.id = String(c.id);
  const tr = settings.translation;
  row.innerHTML = `
    <div class="cue-head">
      <span class="idx">${i + 1}</span>
      <input class="t start" title="${T('cue.start')}" spellcheck="false">
      <button class="ib" data-act="set-start" title="${T('cue.setStart')}">⇤</button>
      <span class="arrow">→</span>
      <input class="t end" title="${T('cue.end')}" spellcheck="false">
      <button class="ib" data-act="set-end" title="${T('cue.setEnd')}">⇥</button>
      <span class="meta"></span>
      <span class="badge" hidden></span>
      <span class="spacer"></span>
      <button class="ib fix" data-act="fix" hidden></button>
      <span class="actions">
        <button class="ib" data-act="play" title="${T('cue.play')}">▶</button>
        <button class="ib" data-act="split" title="${T('cue.split')}">✂</button>
        <button class="ib" data-act="merge" title="${T('cue.merge')}">⤓</button>
        <button class="ib" data-act="balance" title="${T('cue.balance')}">≡</button>
        <button class="ib top-btn${c.top ? ' on' : ''}" data-act="top" title="${T('cue.top')}">⇅</button>
        <button class="ib" data-act="add" title="${T('cue.add')}">＋</button>
        <button class="ib del" data-act="del" title="${T('cue.delete')}">✕</button>
      </span>
    </div>
    <div class="texts${tr ? ' two' : ''}">
      <textarea class="tx" data-field="text" rows="2" lang="${settings.spellLang}" spellcheck="true"${tr ? ` placeholder="${T('cue.original')}"` : ''}></textarea>
      ${tr ? `<textarea class="tx" data-field="tr" rows="2" lang="${settings.spellLang}" spellcheck="true" placeholder="${T('cue.translation')}"></textarea>` : ''}
    </div>
    <div class="speed" title="${T('cue.speed')}"><i></i></div>`;
  $<HTMLInputElement>('.start', row).value = fmt(c.start);
  $<HTMLInputElement>('.end', row).value = fmt(c.end);
  $<HTMLTextAreaElement>('[data-field="text"]', row).value = c.text;
  if (tr) $<HTMLTextAreaElement>('[data-field="tr"]', row).value = c.tr || '';
  return row;
}

export function renderList() {
  // Keep focus and caret if the user was typing
  const ae = document.activeElement;
  let keep: { id: number; field: string; s: number; e: number } | null = null;
  if (ae instanceof HTMLTextAreaElement && listEl.contains(ae)) {
    keep = { id: Number(ae.closest<HTMLElement>('.cue')!.dataset.id), field: ae.dataset.field!, s: ae.selectionStart, e: ae.selectionEnd };
  }
  const scroll = listEl.scrollTop;
  const frag = document.createDocumentFragment();
  state.cues.forEach((c, i) => frag.appendChild(buildRow(c, i)));
  listEl.replaceChildren(frag);
  listEl.scrollTop = scroll;

  $('#tab-list').textContent = T('list.subtitles', { n: state.cues.length });
  $('#empty').hidden = state.cues.length > 0 || !$('#review').hidden;
  state.cues.forEach((_, i) => refreshMeta(i));
  updateIssues();
  markRows();

  if (keep) {
    const ta = rowOf(keep.id)?.querySelector<HTMLTextAreaElement>(`[data-field="${keep.field}"]`);
    if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(keep.s, keep.e); }
  }
}

// Updates a row's duration, speed bar, warning badge and fix button
export function refreshMeta(i: number) {
  const c = state.cues[i], row = listEl.children[i] as HTMLElement | undefined;
  if (!c || !row) return;
  const issues = cueIssues(i);
  const { dur, cps, level } = readingStats(c);
  const meta = $('.meta', row);
  meta.textContent = `${dur.toFixed(2)}s · ${isFinite(cps) ? Math.round(cps) : '∞'} cps`;
  meta.title = issues.length ? issues.map(x => '• ' + x.msg).join('\n') : T('cue.metaTitle');
  row.classList.toggle('warn', issues.length > 0);
  row.classList.toggle('overlap', issues.some(x => x.type === 'overlap'));
  row.classList.toggle('speed-1', level === 1);
  row.classList.toggle('speed-2', level === 2);

  const badge = $('.badge', row);
  const others = issues.filter(x => x.type !== 'speed');
  badge.hidden = !issues.length;
  badge.className = 'badge ' + (level === 2 || issues.some(x => x.level === 2) ? 'b2' : 'b1');
  badge.textContent = level === 2 ? T('cue.tooFast') : level === 1 ? T('cue.fast')
    : others.length === 1 ? `⚠ ${others[0].type === 'empty' ? others[0].msg : T('cue.review')}` : T('cue.warnings', { n: others.length });
  badge.title = meta.title;

  const fixable = [...issues].sort((a, b) => b.level - a.level).find(x => x.fix);
  const fix = $('.fix', row);
  fix.hidden = !fixable;
  if (fixable?.fix) {
    fix.textContent = FIX_LABEL[fixable.fix];
    fix.title = T('cue.fixTitle', { msg: fixable.msg });
  }

  const bar = $('.speed i', row);
  bar.style.width = `${Math.min(100, (isFinite(cps) ? cps : 99) / (settings.maxCps * 1.5) * 100)}%`;
  $('.speed', row).title = T('cue.speedValue', { cps: isFinite(cps) ? cps.toFixed(1) : '∞', max: settings.maxCps });
}

// Cheaper than renderList() while dragging on the timeline
export function refreshRowTimes(c: Cue) {
  const row = rowOf(c.id);
  if (!row) return;
  $<HTMLInputElement>('.start', row).value = fmt(c.start);
  $<HTMLInputElement>('.end', row).value = fmt(c.end);
  const i = indexOf(c);
  refreshMeta(i);
  if (i > 0) refreshMeta(i - 1);
  updateIssues();
}

export function markRows() {
  for (const row of listEl.children as HTMLCollectionOf<HTMLElement>) {
    const id = Number(row.dataset.id);
    row.classList.toggle('selected', state.selection.has(id));
    row.classList.toggle('primary', id === state.selectedId);
    row.classList.toggle('active', state.activeIds.includes(id));
  }
  const n = state.selection.size;
  $('#multi-bar').hidden = n < 2;
  $('#multi-count').textContent = T('multi.selected', { n });
}

/* ---------- Selection ---------- */

interface SelectOptions {
  scroll?: boolean;
  focus?: boolean;
  mode?: 'single' | 'toggle' | 'range'; // toggle = Cmd/Ctrl+click, range = Shift+click
  field?: Field | string | null;        // which text box to focus
}

export function select(id: number | null, { scroll = false, focus = false, mode = 'single', field = null }: SelectOptions = {}) {
  if (mode === 'toggle' && id != null) {
    if (state.selection.has(id) && state.selection.size > 1) {
      state.selection.delete(id);
      if (state.selectedId === id) state.selectedId = [...state.selection][0];
    } else {
      state.selection.add(id);
      state.selectedId = id;
    }
  } else if (mode === 'range' && id != null && state.selectedId != null) {
    const a = indexOf(selected()), b = indexOf(byId(id));
    state.cues.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(c => state.selection.add(c.id));
    state.selectedId = id;
  } else {
    state.selection = new Set(id == null ? [] : [id]);
    state.selectedId = id;
  }
  markRows();
  requestDraw();
  const row = rowOf(id);
  if (!row) return;
  if (scroll) row.scrollIntoView({ block: 'nearest' });
  if (focus) {
    const ta = row.querySelector<HTMLTextAreaElement>(`[data-field="${field || 'text'}"]`) || $<HTMLTextAreaElement>('textarea', row);
    ta.focus({ preventScroll: !scroll });
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
}

export function clearSelection() {
  state.selection = new Set(state.selectedId != null ? [state.selectedId] : []);
  markRows();
  requestDraw();
}

export function selectAll() {
  state.selection = new Set(state.cues.map(c => c.id));
  if (state.selectedId == null && state.cues.length) state.selectedId = state.cues[0].id;
  markRows();
  requestDraw();
}

export function selectRelative(dir: number) {
  if (!state.cues.length) return;
  let i = indexOf(selected());
  if (i < 0) {
    const t = getTime();
    i = state.cues.findIndex(c => c.end > t);
    if (i < 0) i = state.cues.length - 1;
    if (dir > 0) i--;
  }
  const c = state.cues[Math.max(0, Math.min(state.cues.length - 1, i + dir))];
  const field = (document.activeElement as HTMLElement | null)?.dataset?.field;
  select(c.id, { scroll: true, focus: true, field });
  seek(c.start);
}

/* ---------- Events ---------- */

listEl.addEventListener('click', e => {
  const target = e.target as HTMLElement;
  const c = cueOf(target);
  if (!c) return;
  const btn = target.closest<HTMLButtonElement>('button');
  if (!btn) {
    if (e.shiftKey && !target.matches('input, textarea')) return select(c.id, { mode: 'range' });
    if ((e.metaKey || e.ctrlKey) && !target.matches('input, textarea')) return select(c.id, { mode: 'toggle' });
    if (!state.selection.has(c.id) || state.selection.size > 1 || state.selectedId !== c.id) select(c.id);
    if (!target.matches('input')) {
      const t = getTime();
      if (t < c.start || t >= c.end) seek(c.start);
    }
    return;
  }
  if (state.selectedId !== c.id) select(c.id);
  const actions: Record<string, () => void> = {
    'set-start': () => setStart(c),
    'set-end': () => setEnd(c),
    play: () => playCue(c),
    split: () => splitCue(c),
    merge: () => mergeNext(c),
    balance: () => balanceCues([c]),
    top: () => toggleTop([c]),
    add: () => insertAfter(c),
    del: () => deleteCues([c]),
    fix: () => fixCue(c),
  };
  actions[btn.dataset.act ?? '']?.();
});

// Text editing history: one undo entry per focus session
let textSnapshot: string | null = null;
listEl.addEventListener('focusin', e => {
  const target = e.target as HTMLElement;
  const c = cueOf(target);
  if (!c) return;
  if (state.selectedId !== c.id) select(c.id);
  if (target instanceof HTMLTextAreaElement) textSnapshot = JSON.stringify(state.cues);
});

// Typing doesn't re-render the list: only this row, the overlay and the save
listEl.addEventListener('input', e => {
  const ta = e.target;
  if (!(ta instanceof HTMLTextAreaElement)) return;
  const c = cueOf(ta);
  if (!c) return;
  if (textSnapshot) {
    state.undo.push(textSnapshot);
    state.redo = [];
    textSnapshot = null;
  }
  c[ta.dataset.field as Field] = ta.value;
  const i = indexOf(c);
  refreshMeta(i);
  if (i > 0) refreshMeta(i - 1);
  updateIssues();
  renderOverlay();
  requestDraw();
  scheduleSave();
});

listEl.addEventListener('change', e => {
  const input = e.target;
  if (!(input instanceof HTMLInputElement) || !input.matches('input.t')) return;
  const c = cueOf(input);
  if (!c) return;
  const isStart = input.classList.contains('start');
  const t = parseTime(input.value);
  const other = isStart ? c.end : c.start;
  if (!isFinite(t) || (isStart ? t >= other : t <= other)) {
    input.classList.add('invalid');
    toast(T('toast.badTime'), true);
    setTimeout(() => { input.classList.remove('invalid'); input.value = fmt(isStart ? c.start : c.end); }, 1200);
    return;
  }
  pushHistory();
  if (isStart) c.start = t; else c.end = t;
  sortCues();
  commit();
});

listEl.addEventListener('keydown', e => {
  const target = e.target as HTMLElement;
  if (target instanceof HTMLInputElement && target.matches('input.t') && e.key === 'Enter') return target.blur();
  if (!(target instanceof HTMLTextAreaElement) || e.isComposing || e.metaKey || e.ctrlKey) return;
  const ta = target;
  const c = cueOf(ta);
  if (!c) return;
  const isOriginal = ta.dataset.field === 'text';
  const collapsed = ta.selectionStart === ta.selectionEnd;

  if (e.key === 'Enter') {
    // In the translation, Enter is a line break; in the original it splits the block
    if (e.altKey || e.shiftKey || !isOriginal) {
      e.preventDefault();
      if (!document.execCommand('insertText', false, '\n')) {
        ta.setRangeText('\n', ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }
    e.preventDefault();
    return splitAtCaret(c, ta);
  }
  if (!isOriginal || e.altKey || !collapsed) return;
  // Delete at the end merges with the next one; Backspace at the start, with the previous one
  if (e.key === 'Delete' && ta.selectionStart === ta.value.length && state.cues[indexOf(c) + 1]) {
    e.preventDefault();
    return joinWithNext(c);
  }
  const prev = state.cues[indexOf(c) - 1];
  if (prev && e.key === 'Backspace' && ta.selectionStart === 0) {
    e.preventDefault();
    return joinWithNext(prev);
  }
});
