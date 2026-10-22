// Minimal event bus, so core modules can announce changes without importing the UI.
// Events: 'cues-changed' (after any change to the subtitles, see commit()).

type Handler = (...args: unknown[]) => void;
const handlers: Record<string, Handler[]> = {};

export function on(name: string, fn: Handler) {
  (handlers[name] ||= []).push(fn);
}

export function emit(name: string, ...args: unknown[]) {
  for (const fn of handlers[name] || []) fn(...args);
}
