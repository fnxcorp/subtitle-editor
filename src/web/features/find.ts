// Find and replace in the original and/or the translation.
import { state } from '../core/state.ts';
import { settings } from '../core/settings.ts';
import { byId, selected, pushHistory, commit } from '../core/cues.ts';
import { cueText } from '../core/text.ts';
import { T } from '../core/i18n.ts';
import { $, listEl } from '../ui/dom.ts';
import { toast } from '../ui/toast.ts';
import { select, rowOf } from './list.ts';
import { setView } from './review.ts';
import type { Field } from '../core/types.ts';

interface Match { id: number; field: Field; start: number; end: number }

// matches: [{ id, field, start, end }]; idx: current match (-1 = none yet)
export const find: { matches: Match[]; idx: number } = { matches: [], idx: -1 };

export const isFindOpen = () => !$('#find-bar').hidden;

const findInput = $<HTMLInputElement>('#find-q');
const replaceInput = $<HTMLInputElement>('#find-r');
const checked = (sel: string) => $<HTMLInputElement>(sel).checked;

function findRegex(): RegExp | null {
  const q = findInput.value;
  if (!q) return null;
  let src = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (checked('#find-word')) src = `(?<![\\p{L}\\p{N}_])${src}(?![\\p{L}\\p{N}_])`;
  return new RegExp(src, 'gu' + (checked('#find-case') ? '' : 'i'));
}

function findFields(): Field[] {
  const f = settings.translation ? $<HTMLSelectElement>('#find-field').value : 'text';
  return f === 'both' ? ['text', 'tr'] : [f as Field];
}

// Recomputes the matches and highlights their rows
export function refreshFind() {
  const re = findRegex();
  find.matches = [];
  if (re) {
    for (const c of state.cues) {
      for (const field of findFields()) {
        const t = cueText(c, field);
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(t))) {
          if (!m[0]) { re.lastIndex++; continue; }
          find.matches.push({ id: c.id, field, start: m.index, end: m.index + m[0].length });
        }
      }
    }
  }
  if (find.idx >= find.matches.length) find.idx = find.matches.length - 1;
  const ids = new Set(find.matches.map(m => m.id));
  const cur = find.matches[find.idx];
  for (const row of listEl.children as HTMLCollectionOf<HTMLElement>) {
    row.classList.toggle('match', ids.has(Number(row.dataset.id)));
    row.classList.toggle('match-current', !!cur && cur.id === Number(row.dataset.id));
  }
  $('#find-count').textContent = !findInput.value ? '' : find.matches.length
    ? T('find.count', { i: find.idx >= 0 ? find.idx + 1 : 0, n: find.matches.length }) : T('find.none');
}

function gotoMatch(dir: number) {
  refreshFind();
  const n = find.matches.length;
  if (!n) return;
  if (find.idx < 0 && dir >= 0) {
    // Start at the first match from the selected subtitle
    const from = selected()?.start ?? -1;
    find.idx = Math.max(0, find.matches.findIndex(m => (byId(m.id)?.start ?? -1) >= from));
  } else {
    find.idx = (find.idx + dir + n) % n;
  }
  const m = find.matches[find.idx];
  select(m.id, { scroll: true });
  rowOf(m.id)?.scrollIntoView({ block: 'center' });
  refreshFind();
}

function replaceOne() {
  const m = find.matches[find.idx];
  if (!m) return gotoMatch(1);
  const c = byId(m.id);
  if (!c) return;
  pushHistory();
  const t = cueText(c, m.field);
  c[m.field] = t.slice(0, m.start) + replaceInput.value + t.slice(m.end);
  find.idx--;
  commit();
  gotoMatch(1);
}

export function replaceAll() {
  const re = findRegex();
  if (!re) return;
  const repl = replaceInput.value;
  let n = 0;
  pushHistory();
  for (const c of state.cues) {
    for (const field of findFields()) {
      const t = cueText(c, field);
      if (!t) continue;
      c[field] = t.replace(re, () => { n++; return repl; });
    }
  }
  if (!n) { state.undo.pop(); return toast(T('find.noMatches')); }
  commit();
  toast(T('find.replaced', { n }), { undo: true });
}

export function openFind() {
  $('#find-bar').hidden = false;
  setView('list');
  const ae = document.activeElement;
  if (ae instanceof HTMLTextAreaElement && ae.selectionEnd > ae.selectionStart) {
    findInput.value = ae.value.slice(ae.selectionStart, ae.selectionEnd);
  }
  findInput.focus();
  findInput.select();
  find.idx = -1;
  refreshFind();
}

// Closing selects the current match in its text box
export function closeFind() {
  const m = find.matches[find.idx];
  $('#find-bar').hidden = true;
  for (const row of listEl.children) row.classList.remove('match', 'match-current');
  if (m) {
    const ta = rowOf(m.id)?.querySelector<HTMLTextAreaElement>(`[data-field="${m.field}"]`);
    if (ta) { ta.focus(); ta.setSelectionRange(m.start, m.end); }
  }
}

$('#find-btn').addEventListener('click', () => (isFindOpen() ? closeFind() : openFind()));
$('#find-close').addEventListener('click', closeFind);
$('#find-next').addEventListener('click', () => gotoMatch(1));
$('#find-prev').addEventListener('click', () => gotoMatch(-1));
$('#find-one').addEventListener('click', replaceOne);
$('#find-all').addEventListener('click', replaceAll);
['#find-q', '#find-case', '#find-word', '#find-field'].forEach(s =>
  $(s).addEventListener(s === '#find-q' ? 'input' : 'change', () => { find.idx = -1; refreshFind(); }));
$('#find-bar').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
  else if (e.key === 'Enter' && e.target === findInput) { e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1); }
  else if (e.key === 'Enter' && e.target === replaceInput) { e.preventDefault(); replaceOne(); }
});
