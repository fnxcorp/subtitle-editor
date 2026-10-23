// Bridge between the app page and Electron: exposed to the page as window.desktop
import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  onOpen: (cb: (file: unknown) => void) => ipcRenderer.on('open', (_e, file) => cb(file)),
  setLanguage: (lang: string) => ipcRenderer.send('set-language', lang),
  // Files dropped or picked in the page: served from disk like the File menu (no multi-GB reads in memory)
  register: (file: File): Promise<string> | null => {
    const p = webUtils.getPathForFile(file);
    return p ? ipcRenderer.invoke('register-file', p) : null;
  },
  setSpellLang: (lang: string) => ipcRenderer.send('set-spell-lang', lang),
});
