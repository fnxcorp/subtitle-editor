// User preferences, persisted in localStorage.

const SETTINGS_KEY = 'subeditor:settings';

export interface Settings {
  maxCps: number;        // reading speed limit, characters per second
  maxChars: number;      // per line
  maxLines: number;
  minDur: number;        // seconds
  maxDur: number;        // seconds
  minGapFrames: number;
  cutFrames: number;     // "near a shot change" distance
  lang: string;          // UI language
  fps: number;           // 0 = automatic
  frameExport: boolean;  // round times to frames on export
  snap: boolean;
  follow: boolean;
  ripple: boolean;
  spellLang: string;
  subSize: number;       // preview font size, %
  subBg: number;         // preview background opacity
  device: 'normal' | 'phone' | 'tv';
  overlay: 'auto' | 'both' | 'original';
  translation: boolean;
  keymap: Record<string, string>; // command id → shortcut ('' = removed)
}

export const DEFAULTS: Settings = {
  maxCps: 17, maxChars: 42, maxLines: 2, minDur: 0.7, maxDur: 7, minGapFrames: 2, cutFrames: 12,
  lang: 'en', fps: 0, frameExport: false, snap: true, follow: true, ripple: false, spellLang: 'es',
  subSize: 100, subBg: 0.72, device: 'normal', overlay: 'auto', translation: false, keymap: {},
};

export const settings: Settings = (() => {
  let s: Partial<Settings> = {};
  try {
    s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
    const old = Number(localStorage.getItem('subeditor:maxcps')); // pre-1.0 setting
    if (old && !s.maxCps) s.maxCps = old;
  } catch {}
  return { ...DEFAULTS, ...s, keymap: { ...(s.keymap || {}) } };
})();

export function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}
