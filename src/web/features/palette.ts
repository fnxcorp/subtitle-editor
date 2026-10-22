// Command palette (Cmd/Ctrl+K): type to filter every command, Enter to run it.
import { escapeHtml } from '../core/text.ts';
import { T } from '../core/i18n.ts';
import { $ } from '../ui/dom.ts';
import { COMMANDS, keysFor, prettyCombo } from './commands.ts';
import type { Command } from './commands.ts';

// Lowercase without accents, so "subtitulo" finds "subtítulo"
export const norm = (s: string): string => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export let palItems: Command[] = [];
let palIdx = 0;

const dialog = $<HTMLDialogElement>('#palette');
const query = $<HTMLInputElement>('#palette-q');

export function openPalette() {
  query.value = '';
  palIdx = 0;
  renderPalette();
  dialog.showModal();
  query.focus();
}

function renderPalette() {
  const terms = norm(query.value).split(/\s+/).filter(Boolean);
  palItems = COMMANDS.filter(c => terms.every(t => norm(c.title).includes(t)));
  palIdx = Math.max(0, Math.min(palIdx, palItems.length - 1));
  $('#palette-list').innerHTML = palItems.map((c, i) =>
    `<div class="pal-item${i === palIdx ? ' on' : ''}" data-i="${i}"><span>${escapeHtml(c.title)}</span>${keysFor(c)[0] ? `<kbd>${prettyCombo(keysFor(c)[0])}</kbd>` : ''}</div>`).join('')
    || `<div class="pal-empty muted">${T('palette.none')}</div>`;
  $('#palette-list .on')?.scrollIntoView({ block: 'nearest' });
}

function runPalette(i: number) {
  const c = palItems[i];
  dialog.close();
  if (c) setTimeout(() => c.run(), 0);
}

query.addEventListener('input', () => { palIdx = 0; renderPalette(); });
query.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palIdx++; renderPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palIdx--; renderPalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); runPalette(palIdx); }
});
$('#palette-list').addEventListener('click', e => {
  const it = (e.target as HTMLElement).closest<HTMLElement>('.pal-item');
  if (it) runPalette(Number(it.dataset.i));
});
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
$('#palette-btn').addEventListener('click', openPalette);
