// Desktop app: starts the same local server and opens it in its own window.
// Files can be opened by double-click (packaged app), by dropping them on the icon
// or from the command line: npm run app -- movie.mp4 movie.srt
import { app, BrowserWindow, Menu, dialog, shell, ipcMain } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { start, registerFile } from '../server/server.ts';

// Compiled to build/src/desktop/main.js, so the project root is three levels up
const ROOT = path.resolve(__dirname, '..', '..', '..');

const SUB_EXT = /\.(srt|vtt|txt)$/i;
const MEDIA_EXT = /\.(mp4|m4v|mov|mkv|webm|ogv|avi|mp3|wav|m4a|aac|ogg|flac)$/i;
let win: BrowserWindow | null = null;
let pending: string[] = [];

// The language chosen in the app is stored here to translate native menus and dialogs
const langFile = () => path.join(app.getPath('userData'), 'language');
const readLang = () => { try { return fs.readFileSync(langFile(), 'utf8').trim() === 'es' ? 'es' : 'en'; } catch { return 'en'; } };
// Native menu and dialog labels, from the same locale files as the UI
const L = (): Record<string, string> => JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'locales', `${readLang()}.json`), 'utf8')).desktop;
app.commandLine.appendSwitch('lang', readLang() === 'es' ? 'es' : 'en-US');

function openPaths(paths: string[]) {
  const files = paths.filter(p => fs.existsSync(p) && (SUB_EXT.test(p) || MEDIA_EXT.test(p)));
  if (!win) { pending.push(...files); return; }
  for (const p of files) {
    win.webContents.send('open', {
      name: path.basename(p),
      size: fs.statSync(p).size,
      url: registerFile(p),
      kind: SUB_EXT.test(p) ? 'subs' : 'media',
    });
  }
}

async function choose() {
  const r = await dialog.showOpenDialog(win!, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: L().media, extensions: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'srt', 'vtt', 'mp3', 'wav', 'm4a'] },
      { name: L().all, extensions: ['*'] },
    ],
  });
  if (!r.canceled) openPaths(r.filePaths);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as const] : []),
    { label: L().file, submenu: [
      { label: L().open, accelerator: 'CmdOrCtrl+Shift+O', click: choose },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: L().view, submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on('set-language', (_e, lang: string) => {
  fs.writeFileSync(langFile(), lang === 'es' ? 'es' : 'en');
  buildMenu();
});

app.on('open-file', (e, p) => { e.preventDefault(); openPaths([p]); }); // macOS: double-click / drop on the icon

app.whenReady().then(async () => {
  const copiesDir = app.isPackaged ? path.join(app.getPath('documents'), L().copies) : undefined;
  const { url } = await start({ port: 0, copiesDir });
  buildMenu();
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 600,
    title: 'Subtitle Editor', backgroundColor: '#0f1115',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' }; });
  await win.loadURL(url);
  const files = [...pending, ...process.argv.slice(app.isPackaged ? 1 : 2)];
  pending = [];
  openPaths(files);
});

app.on('window-all-closed', () => app.quit());
