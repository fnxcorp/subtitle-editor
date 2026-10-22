// Subtitles drawn over the video, the reading-speed badge and the preview options (Aa menu).
import { state } from '../core/state.ts';
import { settings, saveSettings } from '../core/settings.ts';
import { byId } from '../core/cues.ts';
import { safeHtml } from '../core/text.ts';
import { T } from '../core/i18n.ts';
import { $, video, listEl } from '../ui/dom.ts';
import { toggleMenu } from '../ui/menus.ts';
import { readingStats } from './quality.ts';
import { getTime } from './playback.ts';
import { markRows, rowOf } from './list.ts';
import type { Cue } from '../core/types.ts';

const stage = $('#stage');
const picture = $('#picture');

function overlayHtml(c: Cue): string {
  const orig = c.text.trim() ? `<span class="${settings.translation && settings.overlay !== 'original' ? 'orig' : ''}">${safeHtml(c.text)}</span>` : '';
  if (!settings.translation || settings.overlay === 'original') return orig;
  const tr = c.tr && c.tr.trim() ? `<span>${safeHtml(c.tr)}</span>` : '';
  if (settings.overlay === 'both') return [tr, orig].filter(Boolean).join('<br>');
  return tr || orig;
}

export function renderOverlay() {
  const active = state.activeIds.map(byId).filter((c): c is Cue => !!c);
  $('#ov-top').innerHTML = active.filter(c => c.top).map(overlayHtml).filter(Boolean).join('<br>');
  $('#ov-bottom').innerHTML = active.filter(c => !c.top).map(overlayHtml).filter(Boolean).join('<br>');

  const worst = active.map(c => readingStats(c)).sort((a, b) => b.level - a.level)[0];
  const badge = $('#speed-badge');
  badge.hidden = !worst || !worst.level;
  if (worst && worst.level) {
    badge.className = `lvl-${worst.level}`;
    badge.textContent = T('video.badge', { icon: worst.level === 2 ? '⛔' : '⚠', cps: Math.round(worst.cps), needed: worst.needed.toFixed(1), dur: worst.dur.toFixed(1) });
  }
}

// Works out which subtitles are on screen now; force = re-render even if they didn't change
export function updateActive(force = false) {
  const t = getTime();
  const ids = state.cues.filter(c => t >= c.start && t < c.end).map(c => c.id);
  if (!force && ids.join() === state.activeIds.join()) return;
  state.activeIds = ids;
  renderOverlay();
  markRows();
  if (ids.length && settings.follow && !video.paused && !listEl.contains(document.activeElement)) {
    rowOf(ids[0])?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

// Places the subtitle layer over the actual picture (without the black bars) and scales the font
export function layoutPicture() {
  const W = stage.clientWidth, H = stage.clientHeight;
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
  const s = Math.min(W / vw, H / vh);
  const w = vw * s, h = vh * s;
  Object.assign(picture.style, { left: `${(W - w) / 2}px`, top: `${(H - h) / 2}px`, width: `${w}px`, height: `${h}px` });
  picture.style.setProperty('--sub-size', `${Math.max(9, h * 0.055 * settings.subSize / 100)}px`);
  picture.style.setProperty('--sub-bg', `rgba(0,0,0,${settings.subBg})`);
}

// Normal / phone / TV frame around the video
export function applyDevice() {
  stage.className = `stage device-${settings.device}`;
  requestAnimationFrame(layoutPicture);
}

new ResizeObserver(layoutPicture).observe(stage);

const subSize = $<HTMLInputElement>('#sub-size'), subBg = $<HTMLInputElement>('#sub-bg');
const device = $<HTMLSelectElement>('#device'), overlaySrc = $<HTMLSelectElement>('#overlay-src');
subSize.value = String(settings.subSize);
subBg.value = String(settings.subBg);
device.value = settings.device;
overlaySrc.value = settings.overlay;
subSize.addEventListener('input', () => { settings.subSize = +subSize.value; saveSettings(); layoutPicture(); });
subBg.addEventListener('input', () => { settings.subBg = +subBg.value; saveSettings(); layoutPicture(); });
device.addEventListener('change', () => { settings.device = device.value as typeof settings.device; saveSettings(); applyDevice(); });
overlaySrc.addEventListener('change', () => { settings.overlay = overlaySrc.value as typeof settings.overlay; saveSettings(); renderOverlay(); });
$('#preview-btn').addEventListener('click', e => { e.stopPropagation(); toggleMenu($('#preview-menu')); });
$('#preview-menu').addEventListener('click', e => e.stopPropagation());
