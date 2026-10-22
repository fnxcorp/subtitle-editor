// Browser APIs not in TypeScript's DOM library, and the bridge exposed by the desktop app.

interface DesktopFile {
  name: string;
  size: number;
  url: string;            // served by server.ts: /media/<token>/<name>
  kind: 'subs' | 'media';
}

interface DesktopBridge {
  onOpen(cb: (file: DesktopFile) => void): void;
  setLanguage(lang: string): void;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}

interface Window {
  desktop?: DesktopBridge; // only in the Electron app (see src/desktop/preload.ts)
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
}

interface Navigator {
  gpu?: { requestAdapter(): Promise<unknown | null> };
}

// Transformers.js, loaded from the CDN inside the Whisper worker (only what we use)
declare module 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js' {
  export const env: { allowLocalModels: boolean };
  export function pipeline(task: string, model: string, options?: Record<string, unknown>): Promise<unknown>;
}
