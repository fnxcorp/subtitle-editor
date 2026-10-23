// Settings dialog: quality limits, video, language, spell-check and the shortcut editor.
import { settings, saveSettings } from '../core/settings.ts';
import { escapeHtml } from '../core/text.ts';
import { I18N, T } from '../core/i18n.ts';
import { $, $$, IS_MAC } from '../ui/dom.ts';
import { toast } from '../ui/toast.ts';
import { COMMANDS, keysFor, comboOf, prettyCombo, setShortcut, resetShortcuts } from './commands.ts';
import { setSetting } from './preferences.ts';
import { updateFrameUi } from './playback.ts';
import { flushSave, revealCopies } from './saving.ts';

const dialog = $<HTMLDialogElement>('#settings');
const input = (sel: string) => $<HTMLInputElement>(sel);
const select = (sel: string) => $<HTMLSelectElement>(sel);

const NUM_SETTINGS = ['maxCps', 'maxChars', 'maxLines', 'minDur', 'maxDur', 'minGapFrames', 'cutFrames'] as const;

export function openSettings(tab = 'general') {
  for (const k of NUM_SETTINGS) input(`#s-${k}`).value = String(settings[k]);
  select('#s-fps').value = String(settings.fps);
  input('#s-frameExport').checked = settings.frameExport;
  select('#s-spellLang').value = settings.spellLang;
  select('#s-lang').value = I18N.lang;
  updateFrameUi();
  showTab(tab);
  renderKeys();
  dialog.showModal();
}

function showTab(tab: string) {
  $$('#settings .tab').forEach(t => t.classList.toggle('active', t.dataset.stab === tab));
  $$('#settings .stab').forEach(s => { s.hidden = s.dataset.stab !== tab; });
}

$$('#settings .tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.stab!)));
$('#settings-btn').addEventListener('click', () => openSettings());
$('#settings-close').addEventListener('click', () => dialog.close());
$('#reveal-copies').addEventListener('click', revealCopies);

for (const k of NUM_SETTINGS) {
  const el = input(`#s-${k}`);
  el.addEventListener('change', () => {
    const v = parseFloat(el.value.replace(',', '.'));
    if (isFinite(v) && v >= 0) setSetting(k, v); else el.value = String(settings[k]);
  });
}
select('#s-fps').addEventListener('change', () => setSetting('fps', +select('#s-fps').value));
input('#s-frameExport').addEventListener('change', () => setSetting('frameExport', input('#s-frameExport').checked));
// The macOS spell checker picks the language itself and ignores this setting
if (window.desktop && IS_MAC) select('#s-spellLang').closest('label')!.hidden = true;
select('#s-spellLang').addEventListener('change', () => setSetting('spellLang', select('#s-spellLang').value));
// Changing the language reloads the app (after saving the working copy)
select('#s-lang').addEventListener('change', async () => {
  settings.lang = select('#s-lang').value;
  saveSettings();
  window.desktop?.setLanguage(settings.lang);
  await flushSave();
  location.reload();
});

/* ---------- Shortcut editor ---------- */

let capturing: string | null = null; // id of the command waiting for a new shortcut
export const isCapturingShortcut = () => !!capturing;

function renderKeys() {
  $('#keys-table').innerHTML = COMMANDS.map(c => {
    const [primary, ...rest] = keysFor(c);
    return `<tr>
      <td>${escapeHtml(c.title)}</td>
      <td><button class="keycap${capturing === c.id ? ' capturing' : ''}" data-id="${c.id}">${capturing === c.id ? T('settings.pressKeys') : prettyCombo(primary)}</button>
        ${rest.map(k => `<kbd class="muted">${prettyCombo(k)}</kbd>`).join(' ')}</td>
      <td>${settings.keymap[c.id] !== undefined ? `<button class="ib" data-reset="${c.id}" title="${T('settings.reset')}">↺</button>` : ''}</td>
    </tr>`;
  }).join('');
}

$('#keys-table').addEventListener('click', e => {
  const target = e.target as HTMLElement;
  const cap = target.closest<HTMLElement>('.keycap');
  if (cap) { capturing = cap.dataset.id!; return renderKeys(); }
  const r = target.closest<HTMLElement>('[data-reset]');
  if (r) { setShortcut(r.dataset.reset!, null); renderKeys(); }
});

// Capture phase, so the new combination doesn't trigger any other shortcut
window.addEventListener('keydown', e => {
  if (!capturing) return;
  e.preventDefault();
  e.stopPropagation();
  if (['Shift', 'Alt', 'Meta', 'Control'].includes(e.key)) return;
  const id = capturing;
  capturing = null;
  if (e.key === 'Escape') return renderKeys();
  const combo = comboOf(e);
  const other = COMMANDS.find(c => c.id !== id && keysFor(c).includes(combo));
  if (other) {
    // A secondary default can't be removed; a primary one moves to this command
    if (keysFor(other)[0] !== combo) { toast(T('settings.keyUsed', { key: prettyCombo(combo), cmd: other.title }), true); return renderKeys(); }
    setShortcut(other.id, '');
    toast(T('settings.keyMoved', { key: prettyCombo(combo), cmd: other.title }));
  }
  setShortcut(id, combo);
  renderKeys();
}, true);

$('#keys-reset').addEventListener('click', () => {
  resetShortcuts();
  renderKeys();
  toast(T('settings.keysReset'));
});
