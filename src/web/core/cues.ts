// The subtitle list: creation, lookup, selection helpers and history.
import { state } from './state.ts';
import type { Cue } from './types.ts';
import { emit } from './events.ts';

export function newCue(start: number, end: number, text = '', extra: Partial<Cue> = {}): Cue {
  return { id: state.nextId++, start, end, text, ...extra };
}

export const byId = (id: number | null): Cue | undefined => state.cues.find(c => c.id === id);
export const indexOf = (c: Cue | undefined): number => (c ? state.cues.indexOf(c) : -1);
export const selected = () => byId(state.selectedId);
export const selectedCues = () => state.cues.filter(c => state.selection.has(c.id));
export const sortCues = () => state.cues.sort((a, b) => a.start - b.start || a.end - b.end);

// Call before changing cues so the change can be undone
export function pushHistory() {
  state.undo.push(JSON.stringify(state.cues));
  if (state.undo.length > 300) state.undo.shift();
  state.redo = [];
}

// Replaces the cues with a history snapshot, keeping whatever selection still exists
export function restoreSnapshot(json: string) {
  state.cues = JSON.parse(json) as Cue[];
  state.nextId = Math.max(state.nextId, ...state.cues.map(c => c.id + 1));
  const ids = new Set(state.cues.map(c => c.id));
  state.selection = new Set([...state.selection].filter(id => ids.has(id)));
  if (state.selectedId != null && !ids.has(state.selectedId)) state.selectedId = null;
  commit();
}

// Call after any change to the cues: the UI re-renders and the working copy is saved (wired in app.js)
export function commit() {
  emit('cues-changed');
}
