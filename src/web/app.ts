// Composition root: imports every feature, wires them together and starts the app.
// Start reading here: each feature lives in features/<name>.js; pure logic (no DOM) is in core/.
import { state } from './core/state.ts';
import { settings } from './core/settings.ts';
import { on } from './core/events.ts';
import { $, video } from './ui/dom.ts';
import { hideToast } from './ui/toast.ts';
import { renderList } from './features/list.ts';
import { updateActive, applyDevice } from './features/overlay.ts';
import { requestDraw, drawIfNeeded, ensureVisible, setZoom, isDragging } from './features/timeline.ts';
import { getTime, playbackTick, updateTransport, updateFrameUi } from './features/playback.ts';
import { scheduleSave, restoreSession, connectServer } from './features/saving.ts';
import { renderReview, isReviewOpen } from './features/review.ts';
import { refreshFind, isFindOpen } from './features/find.ts';
import { liveTick } from './features/live.ts';
import { undo } from './features/editing.ts';
import { openDesktopFile } from './features/files.ts';
import { syncMaxCps, applyTranslationUi } from './features/preferences.ts';
import { openHelpOnFirstRun } from './features/help.ts';
// Features that only add event listeners
import './features/keyboard.ts';
import './features/sync.ts';
import './features/scenes.ts';
import './features/transcribe.ts';
import './features/waveform.ts';

// What happens after any change to the subtitles (commit() in core/cues.js)
on('cues-changed', () => {
  renderList();
  updateActive(true);
  requestDraw();
  scheduleSave();
  if (isReviewOpen()) renderReview();
  if (isFindOpen()) refreshFind();
});

$('#toast-undo').addEventListener('click', () => { hideToast(); undo(); });

// Main loop, once per animation frame: playback checks, list/overlay sync and timeline drawing
let lastT = -1;
function tick() {
  const t = getTime();
  playbackTick(t);
  liveTick(t);
  if (t !== lastT) {
    lastT = t;
    updateActive();
    updateTransport(t);
    if (!video.paused && !isDragging() && performance.now() - state.lastUserScroll > 2000) ensureVisible(t);
    requestDraw();
  }
  drawIfNeeded();
  requestAnimationFrame(tick);
}

// Startup
restoreSession();
syncMaxCps();
applyTranslationUi();
applyDevice();
renderList();
setZoom(state.pps, 0, 0);
updateFrameUi();
requestAnimationFrame(tick);
window.desktop?.onOpen(openDesktopFile);
window.desktop?.setSpellLang(settings.spellLang);
openHelpOnFirstRun();
connectServer();
document.body.dataset.ready = '1'; // lets tests know the app has started
