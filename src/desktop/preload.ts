// Bridge between the app page and Electron: exposed to the page as window.desktop
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  onOpen: (cb: (file: unknown) => void) => ipcRenderer.on('open', (_e, file) => cb(file)),
  setLanguage: (lang: string) => ipcRenderer.send('set-language', lang),
});
