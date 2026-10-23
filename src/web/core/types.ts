// Shared types for the whole web app.

export type Field = 'text' | 'tr';

export interface Cue {
  id: number;
  start: number;   // seconds
  end: number;     // seconds
  text: string;    // original
  tr?: string;     // translation
  top?: boolean;   // shown at the top of the screen ({\an8})
}

export interface VideoSource {
  name: string;
  size: number;
  url: string;
  file?: File;     // opened in the browser
  token?: string;  // opened from disk by the desktop app (served by server.ts)
}

// A subtitle file on disk that Ctrl+S writes: served by server.ts (desktop) or a browser file handle
export interface DiskFile {
  token?: string;
  handle?: FileSystemFileHandle;
  vtt: boolean;
}

export interface LiveSession {
  idx: number;          // subtitle being timed
  holding: Cue | null;  // subtitle whose key is held down
}

export type FixKind = 'extend' | 'minDur' | 'trimEnd' | 'balance' | 'cutStart' | 'cutEnd' | 'delete';
export type IssueType = 'speed' | 'overlap' | 'gap' | 'chars' | 'lines' | 'short' | 'long' | 'cut' | 'empty';

export interface Issue {
  type: IssueType;
  level: 1 | 2;          // 1 = warning (amber), 2 = serious (red)
  msg: string;
  fix: FixKind | null;
  at?: number;           // shot change time, for cutStart / cutEnd
}

export interface SavedSession {
  cues: Cue[];
  srtName: string;
  videoName: string;
  videoSize: number;
}
