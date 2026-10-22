# Contributing

Thanks for helping! The project is TypeScript (strict) compiled to native ES modules, with no
framework and no bundler: each source file maps to one output file, so it's easy to follow.

## Setup

```bash
nvm use            # Node 26 (.nvmrc)
npm install
npm start          # build and run in the browser at http://localhost:5173
npm run check      # type-check + lint + unit tests
npm run test:e2e   # end-to-end tests (CLIP=/path/video.mp4 to include video tests)
```

Please run `npm run check` and the end-to-end tests before opening a pull request.

## Where things go

- **Pure logic** (parsing, timing, text, anything testable without a browser) → `src/web/core/`,
  with a unit test in `test/unit.test.mts`.
- **A feature or UI behaviour** → its own file in `src/web/features/`. Wire it from `app.ts` if it
  must react to changes, or just import it there if it only adds event listeners.
- **Shared types** → `src/web/core/types.ts`.
- **A new user action** → add it to `COMMANDS` in `src/web/features/commands.ts`. It then appears in the
  command palette, the help and the shortcut editor automatically.
- **Styles** → the matching file in `public/css/`.

## Rules

1. **Never write to the user's original subtitle file.** Changes go to the working copy; the final
   file only comes from Export.
2. **No hard-coded UI text.** Use `T('key', vars)` in TypeScript or `data-i18n*` attributes in HTML,
   and add the key to **both** `public/locales/en.json` and `es.json`. Plurals use
   `{ "one": "...", "other": "..." }` with `vars.n`.
3. The translation function is `T` (uppercase) because many functions use a local `t` for time.
4. **Changing subtitles**: call `pushHistory()` before and `commit()` after, so undo, re-rendering and
   saving keep working.
5. Destructive or bulk actions show `toast(message, { undo: true })` instead of a confirmation dialog.
6. Code, comments and identifiers are in English.
7. Keep the browser app dependency-free. If a library clearly pays off, pin an exact version that is
   at least two weeks old (`.npmrc` saves exact versions).
8. Imports use the `.ts` extension (`import { fmt } from '../core/time.ts'`); the compiler rewrites them.
   Use only erasable TypeScript syntax (no `enum` or `namespace`), so Node can run sources directly.

## Code style

Two-space indentation, single quotes, semicolons, small functions with a one-line comment when the
*why* isn't obvious. `npm run lint` enforces the rest. Match the style of the file you're editing.
