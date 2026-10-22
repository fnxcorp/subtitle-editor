// Test-only (used by test/e2e.js, never by the app): exposes every module's exports by name,
// so end-to-end test snippets can call app functions directly inside `with (scope) { ... }`.
import * as state from '../core/state.ts';
import * as settings from '../core/settings.ts';
import * as time from '../core/time.ts';
import * as text from '../core/text.ts';
import * as cues from '../core/cues.ts';
import * as subtitles from '../core/subtitles.ts';
import * as balance from '../core/balance.ts';
import * as i18n from '../core/i18n.ts';
import * as dom from '../ui/dom.ts';
import * as toast from '../ui/toast.ts';
import * as menus from '../ui/menus.ts';
import * as commands from '../features/commands.ts';
import * as editing from '../features/editing.ts';
import * as files from '../features/files.ts';
import * as find from '../features/find.ts';
import * as help from '../features/help.ts';
import * as list from '../features/list.ts';
import * as live from '../features/live.ts';
import * as overlay from '../features/overlay.ts';
import * as palette from '../features/palette.ts';
import * as playback from '../features/playback.ts';
import * as preferences from '../features/preferences.ts';
import * as quality from '../features/quality.ts';
import * as review from '../features/review.ts';
import * as saving from '../features/saving.ts';
import * as scenes from '../features/scenes.ts';
import * as settingsDialog from '../features/settings-dialog.ts';
import * as sync from '../features/sync.ts';
import * as timeline from '../features/timeline.ts';
import * as transcribe from '../features/transcribe.ts';
import * as waveform from '../features/waveform.ts';

const modules: Record<string, unknown>[] = [state, settings, time, text, cues, subtitles, balance, i18n, dom, toast, menus, commands, editing, files,
  find, help, list, live, overlay, palette, playback, preferences, quality, review, saving, scenes, settingsDialog, sync,
  timeline, transcribe, waveform];

// Live bindings: reads always go to the module namespace, so reassigned exports stay current
export const scope = new Proxy({}, {
  has: (_, k) => typeof k === 'string' && modules.some(m => k in m),
  get: (_, k) => (typeof k === 'string' ? modules.find(m => k in m)?.[k] : undefined),
});
