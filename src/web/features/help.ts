// Help dialog: navigation, search, current settings values and the shortcut list.
// The sections themselves are HTML strings in the locale files (help.*).
import { settings } from '../core/settings.ts';
import { escapeHtml } from '../core/text.ts';
import { T } from '../core/i18n.ts';
import { $, $$ } from '../ui/dom.ts';
import { state } from '../core/state.ts';
import { COMMANDS, keysFor, prettyCombo } from './commands.ts';
import { norm } from './palette.ts';
import { serverInfo } from './saving.ts';
import type { Settings } from '../core/settings.ts';

const helpBody = $('#help-body');
const HELP_SEEN = 'subeditor:helpSeen';

export function openHelp(section = 'h-start') {
  $$('[data-setting]', helpBody).forEach(el => { el.textContent = String(settings[el.dataset.setting as keyof Settings]); });
  $('#help-copies').textContent = serverInfo.copiesDir || T('help.copiesFallback');
  $('#help-keys').innerHTML = COMMANDS.filter(c => keysFor(c).length).map(c =>
    `<div class="key-row"><span>${escapeHtml(c.title)}</span><span>${keysFor(c).map(k => `<kbd>${prettyCombo(k)}</kbd>`).join(' ')}</span></div>`).join('');
  $<HTMLInputElement>('#help-q').value = '';
  filterHelp();
  $<HTMLDialogElement>('#help').showModal();
  document.getElementById(section)?.scrollIntoView({ block: 'start' });
  spyHelp();
  try { localStorage.setItem(HELP_SEEN, '1'); } catch {}
}

export function filterHelp() {
  const q = norm($<HTMLInputElement>('#help-q').value.trim());
  let any = false;
  for (const s of $$('section', helpBody)) {
    const show = !q || norm(s.textContent).includes(q);
    s.hidden = !show;
    any = any || show;
  }
  // In the shortcut list, keep only the matching rows
  const keysTitle = norm($('#h-keys h2').textContent);
  $$('#help-keys .key-row').forEach(r => { r.hidden = !!q && !keysTitle.includes(q) && !norm(r.textContent).includes(q); });
  $$('.help-nav a').forEach(a => { a.hidden = $(a.getAttribute('href')!).hidden; });
  $('#help-noresults').hidden = any;
  spyHelp();
}

// Highlights the section being read in the navigation
export function spyHelp() {
  const top = helpBody.scrollTop + 80;
  let cur = null;
  for (const s of $$('section', helpBody)) if (!s.hidden && s.offsetTop <= top) cur = s.id;
  $$('.help-nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + cur));
}

function helpLink(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest('a[href^="#h-"]');
  if (!a) return;
  e.preventDefault();
  $(a.getAttribute('href')!).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('.help-nav').addEventListener('click', helpLink);
helpBody.addEventListener('click', helpLink);
helpBody.addEventListener('scroll', spyHelp);
$('#help-q').addEventListener('input', filterHelp);
$('#help-btn').addEventListener('click', () => openHelp());
$('#empty-help').addEventListener('click', () => openHelp());
const helpDialog = $<HTMLDialogElement>('#help');
$('#help-close').addEventListener('click', () => helpDialog.close());
helpDialog.addEventListener('click', e => { if (e.target === helpDialog) helpDialog.close(); });

// Opens on the quick start the first time (called at startup)
export function openHelpOnFirstRun() {
  let seen = true;
  try { seen = !!localStorage.getItem(HELP_SEEN); } catch {}
  if (!seen && !state.cues.length) openHelp();
}
