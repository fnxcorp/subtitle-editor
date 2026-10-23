# Subtitle Editor

Local subtitle editor (SRT/VTT) synced to a video, similar to Happy Scribe's online editor.
Node server + plain web UI (no build step, no frameworks) + Electron wrapper for desktop.
The user speaks Spanish but works in English: **all code, comments, identifiers, logs and test names are in
English** unless the user says otherwise. The UI is translated (English default, Spanish available).

## Run

```bash
nvm use                   # Node 26.11 (.nvmrc); the shell default may be older
npm install
npm start                 # build + http://localhost:5173 (browser)
npm run app               # build + Electron desktop app
npm run check             # type-check (3 tsconfigs) + ESLint + unit tests
npm run test:e2e          # build + end-to-end tests in a real Electron window
CLIP=/path/video.mp4 npm run test:e2e             # + video tests (waveform, cuts, live timing, fps)
WHISPER=1 CLIP=/path/video.mp4 npm run test:e2e   # + real Whisper transcription (in-app and whisper.cpp)
```

A good test clip with cuts, speech and audio: https://media.w3.org/2010/05/sintel/trailer.mp4

## Stack (newest versions at least two weeks old, pinned exactly)

Node 26.11, TypeScript 6.0.3, Electron 44.7.0, ESLint 10.12 + typescript-eslint 8.71, @types/node 26.6.
- TypeScript 7 (the Go compiler) is not used yet: typescript-eslint only supports TypeScript < 6.1.
- Transformers.js is 3.8.1 (CDN, `src/web/workers/whisper-worker.ts`): 4.x breaks long-form Whisper
  timestamps (segments at 0:00, fragments); verified with `WHISPER=1` on the Sintel trailer. Its
  `transformers.web.min.js` build also needs a bundler. Re-test before upgrading.

## Hard rules

- **Autosave never touches the user's original subtitle file.** It goes to a working copy
  (`working-copies/<name>.working-copy.srt`, legacy `copias/` folder is reused if present) plus
  `history/` snapshots every 5 min, and to localStorage. Only an explicit save (Ctrl+S, `saveNow`)
  writes the original subtitle/translation files (`state.original`, `state.originalTr`): through the
  server in the desktop app (the first write keeps `<name>.original.<ext>` in the copies folder) or a
  File System Access handle in Chrome/Edge. Otherwise the final file comes from Export.
- **No hard-coded UI text.** Every visible string goes through `T('key', vars)` (from `core/i18n.js`) or a `data-i18n*`
  attribute, with the key added to **both** `public/locales/en.json` and `public/locales/es.json`.
- The i18n function is `T` (uppercase): many functions use a local variable `t` for time.
- Plurals: a key whose value is `{ "one": "...", "other": "..." }` picks the form from `vars.n`.
- Everything stays local: no uploads. Network is only used to download the Whisper models
  (Hugging Face, also the whisper.cpp ggml models), Transformers.js (jsDelivr, pinned to 3.8.1) and, in the desktop app on
  Windows/Linux, Chromium's Hunspell spell-check dictionaries (once per language).

## Architecture

TypeScript (strict), native ES modules, no bundler. Full map in README.md → "Project structure". Key points:

- `src/web/` compiles to `public/js/` (git-ignored); `src/server`, `src/desktop`, `test/e2e.ts` compile
  to CommonJS in `build/` (git-ignored). Configs: `tsconfig.web.json`, `tsconfig.node.json`,
  `tsconfig.test.json` (type-checks unit tests); `tsconfig.json` is the editor solution file.
- Imports use `.ts` extensions; `rewriteRelativeImportExtensions` turns them into `.js`. Only erasable
  syntax (`erasableSyntaxOnly`), so Node runs `test/unit.test.mts` straight from the sources.
- `src/web/main.ts` loads the language first (modules translate labels when they load), then `app.ts`.
- `src/web/app.ts` is the composition root: the `cues-changed` reaction, startup and the main loop.
- `src/web/core/` is pure logic with no DOM; shared types in `core/types.ts`; browser API gaps in `globals.d.ts`.
- `src/web/features/` has one file per feature. Features import each other directly. Cycles are fine
  because exports are function declarations that are only called at runtime.
- `features/commands.ts` holds every user action (`COMMANDS`, titles from `cmd.<id>`); keyboard,
  palette, help and the shortcut editor all read from it.
- `$<T>(selector)` returns a non-null element; pass the element type when you need its properties.
- `src/server/server.ts` serves `public/`, saves working copies (`/api/copy`), streams desktop files
  (`/media/<token>`). `ROOT` is three levels above the compiled file.

## Conventions

- Spanish word lists that the logic needs (`WEAK_WORDS`, `HALLUCINATIONS`) and Spanish test fixtures are data, not code.
- Keep it dependency-free in the browser; Electron is the only npm dependency (devDependency).
  Libraries are allowed if they clearly pay off; pin exact versions at least two weeks old.
- Any change to cues: `pushHistory()` before, `commit()` after (app.js re-renders list, overlay, timeline, review, find and saves).
- New pure logic gets a unit test in `test/unit.test.mts`; user-visible flows are covered by `test/e2e.ts`
  (each `run(name, code, expect)` asserts its result; the process exits 1 on any failure).
- `npm run check` must pass before committing; ESLint config is `eslint.config.mjs`.
- Mass/destructive actions show `toast(msg, { undo: true })` instead of confirm dialogs.
- Settings live in `settings` (localStorage `subeditor:settings`); defaults in `DEFAULTS` in `app.js`.

## Optional native tools (desktop app, found on PATH; Homebrew dirs are added for Finder launches)

- ffmpeg: remux (`/api/remux`), audio for waveform/transcription (`/api/audio`, any size or codec).
- whisper.cpp (`whisper-cli`, `brew install whisper-cpp`): `/api/whisper/<token>` streams NDJSON
  progress, models in `~/.cache/subtitle-editor/whisper/`. The "whisper.cpp" model group in the
  Transcribe dialog only shows when it is installed and the video has a desktop token.
