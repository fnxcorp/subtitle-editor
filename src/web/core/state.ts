// Shared mutable app state. Modules read and write it directly; after changing cues call commit().
import type { Cue, LiveSession, SavedSession, VideoSource } from './types.ts';

export const MIN_DUR = 0.1; // shortest allowed subtitle, in seconds

export interface State {
  cues: Cue[];
  nextId: number;
  selectedId: number | null;
  selection: Set<number>;
  activeIds: number[];
  srtName: string;
  video: VideoSource | null;
  videoLoaded: boolean;
  fakeTime: number;
  stopAt: number | null;
  loop: boolean;
  undo: string[];
  redo: string[];
  peaks: Float32Array | null;
  peaksRate: number;
  pps: number;
  viewStart: number;
  lastUserScroll: number;
  cuts: number[];
  fpsDetected: number;
  snapLine: number | null;
  live: LiveSession | null;
  lastSession: SavedSession | null;
}

export const state: State = {
  cues: [],            // { id, start, end, text, tr?, top? } sorted by start
  nextId: 1,
  selectedId: null,    // primary subtitle (the one being edited)
  selection: new Set(),
  activeIds: [],       // subtitles on screen at the current time
  srtName: 'subtitles.srt',
  video: null,         // { name, size, url, token?, file? }
  videoLoaded: false,
  fakeTime: 0,         // "virtual" time when there is no video
  stopAt: null,        // pause here (playing a single subtitle)
  loop: false,
  undo: [],
  redo: [],
  peaks: null,         // waveform, peaksRate values per second in 0..1
  peaksRate: 100,
  pps: 80,             // timeline zoom: pixels per second
  viewStart: 0,        // timeline scroll: first visible second
  lastUserScroll: 0,
  cuts: [],            // shot changes (seconds)
  fpsDetected: 0,
  snapLine: null,      // time of the snap guide while dragging
  live: null,          // live timing session
  lastSession: null,
};
