// Every user action as a command: used by keyboard shortcuts, the command palette, the help and settings.
// To add an action: add an entry here and a `cmd.<id>` title in both locale files.
// keys: default shortcuts ('Mod' = Cmd on Mac, Ctrl elsewhere); the first one can be remapped by the user.
// text: the shortcut also works while typing in a text field (only if it uses Alt/Cmd/Ctrl).
import { state } from '../core/state.ts';
import { settings, saveSettings } from '../core/settings.ts';
import { selected, selectedCues } from '../core/cues.ts';
import { T } from '../core/i18n.ts';
import { $, IS_MAC } from '../ui/dom.ts';
import { toast } from '../ui/toast.ts';
import { togglePlay, seek, getTime, stepFrame, playCue, toggleLoop } from './playback.ts';
import { selectRelative, selectAll } from './list.ts';
import {
  undo, redo, setStart, setEnd, insertNow, splitCue, mergeNext, mergeCues, balanceCues, toggleTop, deleteCues, newProject,
} from './editing.ts';
import { fixCue, nextIssue } from './quality.ts';
import { setView, fixAll, isReviewOpen } from './review.ts';
import { flushSave, save, revealCopies } from './saving.ts';
import { exportFile } from './files.ts';
import { openFind } from './find.ts';
import { openSync, setSyncPoint } from './sync.ts';
import { toggleLive } from './live.ts';
import { setTranslation } from './preferences.ts';
import { openTranscribe } from './transcribe.ts';
import { detectScenes, clearCuts } from './scenes.ts';
import { buildWaveform } from './waveform.ts';
import { zoomBy } from './timeline.ts';
import { openPalette } from './palette.ts';
import { openSettings } from './settings-dialog.ts';
import { openHelp } from './help.ts';
import type { Cue } from '../core/types.ts';

export interface Command {
  id: string;
  title: string;
  keys: string[];          // default shortcuts
  run: () => unknown;
  text: boolean;           // also works while typing
}

// Wrappers that need a selection first
const need = (fn: (c: Cue) => unknown) => () => { const c = selected(); if (!c) return toast(T('toast.select')); fn(c); };
const needList = (fn: (l: Cue[]) => unknown) => () => { const l = selectedCues(); if (!l.length) return toast(T('toast.selectSome')); fn(l); };

const cmd = (id: string, keys: string[], run: () => unknown, text = false): Command => ({ id, title: T(`cmd.${id}`), keys, run, text });

export const COMMANDS: Command[] = [
  // Playback
  cmd('play', ['Escape', 'Space'], () => togglePlay(), true),
  cmd('back1', ['Alt+ArrowLeft', 'ArrowLeft'], () => seek(getTime() - 1), true),
  cmd('fwd1', ['Alt+ArrowRight', 'ArrowRight'], () => seek(getTime() + 1), true),
  cmd('back5', ['Alt+Shift+ArrowLeft', 'Shift+ArrowLeft'], () => seek(getTime() - 5), true),
  cmd('fwd5', ['Alt+Shift+ArrowRight', 'Shift+ArrowRight'], () => seek(getTime() + 5), true),
  cmd('frame-back', ['Alt+Comma', 'Comma'], () => stepFrame(-1), true),
  cmd('frame-fwd', ['Alt+Period', 'Period'], () => stepFrame(1), true),
  cmd('play-cue', ['Alt+KeyP'], need(c => playCue(c)), true),
  cmd('loop', ['Alt+KeyL'], () => toggleLoop(), true),
  // Navigation and selection
  cmd('prev-cue', ['Alt+ArrowUp', 'ArrowUp'], () => selectRelative(-1), true),
  cmd('next-cue', ['Alt+ArrowDown', 'ArrowDown'], () => selectRelative(1), true),
  cmd('select-all', ['Mod+KeyA'], () => selectAll()),
  // Editing
  cmd('set-start', ['Alt+KeyI'], need(c => setStart(c)), true),
  cmd('set-end', ['Alt+KeyO'], need(c => setEnd(c)), true),
  cmd('insert', ['Alt+KeyN'], () => insertNow(), true),
  cmd('split', ['Alt+KeyD'], need(c => splitCue(c)), true),
  cmd('merge', ['Alt+KeyU'], () => (state.selection.size > 1 ? mergeCues(selectedCues()) : need(c => mergeNext(c))()), true),
  cmd('balance', ['Alt+KeyB'], needList(l => balanceCues(l)), true),
  cmd('top', ['Alt+KeyT'], needList(l => toggleTop(l)), true),
  cmd('delete', ['Delete', 'Backspace'], needList(l => deleteCues(l))),
  cmd('undo', ['Mod+KeyZ'], () => undo()),
  cmd('redo', ['Mod+Shift+KeyZ', 'Mod+KeyY'], () => redo()),
  cmd('new', [], () => newProject()),
  // Quality
  cmd('fix', ['Alt+KeyF'], need(c => fixCue(c)), true),
  cmd('next-issue', ['Alt+KeyE'], () => nextIssue(true), true),
  cmd('next-any-issue', ['Alt+Shift+KeyE'], () => nextIssue(false), true),
  cmd('review', ['Alt+KeyR'], () => setView(isReviewOpen() ? 'list' : 'review'), true),
  cmd('fix-all', [], () => fixAll()),
  cmd('balance-all', [], () => balanceCues(state.cues)),
  // Timing tools
  cmd('sync', [], () => openSync()),
  cmd('sync-a', ['Alt+Digit1'], () => setSyncPoint('a'), true),
  cmd('sync-b', ['Alt+Digit2'], () => setSyncPoint('b'), true),
  cmd('live', ['Alt+KeyM'], () => toggleLive(), true),
  cmd('snap', [], () => { $('#snap').click(); toast(T(settings.snap ? 'toast.snapOn' : 'toast.snapOff')); }),
  cmd('ripple', [], () => { $('#ripple').click(); toast(T(settings.ripple ? 'toast.rippleOn' : 'toast.rippleOff')); }),
  cmd('zoom-in', ['Alt+Equal'], () => zoomBy(1.4), true),
  cmd('zoom-out', ['Alt+Minus'], () => zoomBy(1 / 1.4), true),
  // Files
  cmd('open-srt', ['Mod+KeyO'], () => $('#srt-input').click(), true),
  cmd('open-video', [], () => $('#video-input').click()),
  cmd('open-tr', [], () => { if (!settings.translation) setTranslation(true); $('#tr-input').click(); }),
  cmd('save', ['Mod+KeyS'], async () => { await flushSave(); if (save.server) toast(T('save.saved', { path: save.path })); }, true),
  cmd('export', ['Mod+KeyE'], () => exportFile('srt', 'text'), true),
  cmd('export-vtt', [], () => exportFile('vtt', 'text')),
  cmd('export-tr', [], () => exportFile('srt', 'tr')),
  cmd('copies', [], () => revealCopies()),
  // Features
  cmd('find', ['Mod+KeyF'], () => openFind(), true),
  cmd('translation', [], () => setTranslation(!settings.translation)),
  cmd('transcribe', [], () => openTranscribe()),
  cmd('scenes', [], () => detectScenes()),
  cmd('clear-cuts', [], () => clearCuts()),
  cmd('waveform', [], () => buildWaveform()),
  // App
  cmd('palette', ['Mod+KeyK'], () => openPalette(), true),
  cmd('settings', ['Mod+Comma'], () => openSettings(), true),
  cmd('shortcuts', [], () => openSettings('keys')),
  cmd('help', ['F1', 'Mod+Slash'], () => openHelp(), true),
];

/* ---------- Shortcuts ---------- */

const MOD = IS_MAC ? 'Meta' : 'Ctrl';
const normCombo = (k: string) => k.replace(/^Mod\+/, MOD + '+');

// Current shortcuts of a command; settings.keymap[id] overrides the first one ('' = removed)
export function keysFor(command: Command): string[] {
  const defaults = command.keys.map(normCombo);
  const o = settings.keymap[command.id];
  if (o === undefined) return defaults;
  return o ? [o, ...defaults.slice(1)] : defaults.slice(1);
}

// combo ("Alt+KeyI") → command
export let keyMap = new Map<string, Command>();
export function rebuildKeyMap() {
  keyMap = new Map<string, Command>();
  for (const c of COMMANDS) for (const k of keysFor(c)) if (!keyMap.has(k)) keyMap.set(k, c);
}

export function setShortcut(id: string, combo: string | null) {
  if (combo === null) delete settings.keymap[id]; else settings.keymap[id] = combo;
  saveSettings();
  rebuildKeyMap();
}

export function resetShortcuts() {
  settings.keymap = {};
  saveSettings();
  rebuildKeyMap();
}

// KeyboardEvent → "Meta+Ctrl+Alt+Shift+Code" (physical keys, so it works on any keyboard layout)
export function comboOf(e: KeyboardEvent): string {
  const parts = [];
  if (e.metaKey) parts.push('Meta');
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.code);
  return parts.join('+');
}

const KEY_NAMES: Record<string, string> = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Comma: ',', Period: '.', Escape: T('keys.esc'),
  Space: T('keys.space'), Delete: T('keys.del'), Backspace: '⌫', Equal: '=', Minus: '-', Enter: 'Enter', Slash: '/',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backquote: '`', Tab: 'Tab',
};

// "Alt+KeyI" → "⌥I" on Mac, "Alt+I" elsewhere
const MODIFIER_NAMES: Record<string, string> = { Meta: IS_MAC ? '⌘' : 'Win', Ctrl: IS_MAC ? '⌃' : 'Ctrl', Alt: IS_MAC ? '⌥' : 'Alt', Shift: '⇧' };

export function prettyCombo(k: string | undefined): string {
  if (!k) return '—';
  return k.split('+').map(p => MODIFIER_NAMES[p] || KEY_NAMES[p] || p.replace(/^Key/, '').replace(/^Digit/, '')).join(IS_MAC ? '' : '+');
}

rebuildKeyMap();
