// Toggles and preferences in the main window: ripple, snap, follow, max cps and translation mode.
import { settings, saveSettings } from '../core/settings.ts';
import type { Settings } from '../core/settings.ts';
import { commit } from '../core/cues.ts';
import { $ } from '../ui/dom.ts';

// Changes a setting that affects the checks or the list, and re-renders
export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  settings[key] = value;
  saveSettings();
  if (key === 'maxCps') syncMaxCps();
  if (key === 'spellLang') window.desktop?.setSpellLang(String(value));
  commit();
}

// Keeps the "Max" select in sync with settings.maxCps (adding the value if it isn't a preset)
export function syncMaxCps() {
  const sel = $<HTMLSelectElement>('#max-cps');
  if (![...sel.options].some(o => +o.value === settings.maxCps)) {
    sel.add(new Option(`${settings.maxCps} cps`, String(settings.maxCps)));
  }
  sel.value = String(settings.maxCps);
}

export function applyTranslationUi() {
  document.body.classList.toggle('translating', settings.translation);
  $('#tr-toggle').setAttribute('aria-pressed', String(settings.translation));
  $('#tr-open').hidden = !settings.translation;
}

export function setTranslation(on: boolean) {
  settings.translation = on;
  saveSettings();
  applyTranslationUi();
  commit();
}

function bindCheck(id: string, key: 'ripple' | 'snap' | 'follow') {
  const el = $<HTMLInputElement>(id);
  el.checked = !!settings[key];
  el.addEventListener('change', () => { settings[key] = el.checked; saveSettings(); });
}

bindCheck('#ripple', 'ripple');
bindCheck('#snap', 'snap');
bindCheck('#follow', 'follow');
$('#tr-toggle').addEventListener('click', () => setTranslation(!settings.translation));
$<HTMLSelectElement>('#max-cps').addEventListener('change', e => setSetting('maxCps', +(e.target as HTMLSelectElement).value));
