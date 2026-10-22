// End-to-end tests: npm run test:e2e  (CLIP=/path/video.mp4 to also run the video tests)
// Opens a real window for a few seconds. Without audio output the video is muted so its clock advances.
import { app, BrowserWindow } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { start, registerFile } from '../src/server/server.ts';
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), 'subtitle-editor-e2e');
fs.mkdirSync(OUT, { recursive: true });

setTimeout(() => { console.log('ABORT global'); app.exit(1); }, 170000);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.whenReady().then(async () => {
  const copiesDir = path.join(OUT, 'working-copies');
  fs.rmSync(copiesDir, { recursive: true, force: true });
  const { url } = await start({ port: 0, copiesDir });
  const win = new BrowserWindow({ width: 1440, height: 900, show: true, x: 20, y: 20, webPreferences: { backgroundThrottling: false } });
  const logs: string[] = [];
  win.webContents.on('console-message', (e) => logs.push(`[${e.level}] ${e.message}`));
  win.webContents.on('render-process-gone', (_e, d) => logs.push('CRASH ' + JSON.stringify(d)));
  // Runs a snippet with every app module export in scope (see public/js/dev/test-scope.js)
  const inApp = (code: string) => win.webContents.executeJavaScript(
    `(async () => { const { scope } = await import('/js/dev/test-scope.js'); with (scope) { return await (async () => { ${code} })(); } })()`);
  const waitApp = async () => { for (let i = 0; i < 100; i++) { if (await win.webContents.executeJavaScript(`document.body.dataset.ready === '1'`)) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('app did not load'); };
  await win.loadURL(url);
  await waitApp();
  await new Promise(r => setTimeout(r, 300));
  const run = async (name: string, code: string) => {
    try {
      const r = await Promise.race([inApp(code), new Promise((_, rej) => setTimeout(() => rej(new Error('TIMED OUT')), 60000))]);
      console.log('✔', name, r === undefined ? '' : JSON.stringify(r));
    }
    catch (e) { console.log('✘', name, (e as Error).message); }
  };
  await run('help opens on first run', `const o = $('#help').open; $('#help').close(); return o;`);
  await run('load SRT', `
    localStorage.clear(); localStorage.setItem('subeditor:helpSeen', '1');
    loadSubsText("1\\n00:00:01,000 --> 00:00:02,000\\nEste texto es demasiado largo para leerlo en solo un segundo\\n\\n2\\n00:00:01,900 --> 00:00:04,000\\nHola mundo\\n\\n3\\n00:00:04,000 --> 00:00:04,300\\nCorto\\n\\n4\\n00:00:05,000 --> 00:00:08,000\\n{\\\\an8}Esta es una frase bastante larga que no cabe en una sola línea\\n", 'prueba.srt');
    return { n: state.cues.length, top: state.cues[3].top, issues: collectIssues().map(x => x.type) };`);
  await run('balance', `return balanceText('Esta es una frase bastante larga que no cabe en una sola línea de subtítulo');`);
  await run('auto-fix', `fixAll(); return { remaining: collectIssues().map(x => x.type + ':' + x.i), cues: state.cues.map(c => [c.start.toFixed(2), c.end.toFixed(2), c.text]) };`);
  await run('undo', `undo(); return collectIssues().length;`);
  await run('two-point sync', `sync.a = { orig: 10, at: 12, n: 1 }; sync.b = { orig: 100, at: 105.6, n: 2 }; renderSync(); const t = syncTransform(); return { k: t.k.toFixed(5), off: t.off.toFixed(3), text: $('#sync-result').textContent };`);
  await run('find/replace', `openFind(); $('#find-q').value = 'hola'; refreshFind(); const c = find.matches.length; $('#find-r').value = 'Adiós'; replaceAll(); closeFind(); return { found: c, text: state.cues[1].text };`);
  await run('merge/split', `const n0 = state.cues.length; joinWithNext(state.cues[0]); const n1 = state.cues.length; const c = state.cues[0]; const ta = rowOf(c.id).querySelector('[data-field="text"]'); ta.focus(); ta.setSelectionRange(10, 10); splitAtCaret(c, ta); return { before: n0, merged: n1, split: state.cues.length, a: state.cues[0].text, b: state.cues[1].text, cut: state.cues[0].end.toFixed(2) };`);
  await run('multi-select', `select(state.cues[0].id); select(state.cues[2].id, { mode: 'range' }); const n = state.selection.size; const vis = !$('#multi-bar').hidden; shiftCues(selectedCues(), 0.5); return { n, bar: vis, start: state.cues[0].start };`);
  await run('translation mode', `setTranslation(true); loadTranslationText("1\\n00:00:01,000 --> 00:00:02,000\\nThis text is too long\\n\\n2\\n00:00:05,000 --> 00:00:08,000\\nLong sentence\\n", 'en.srt'); return { columns: document.querySelectorAll('[data-field=tr]').length, tr: state.cues.map(c => c.tr || '') };`);
  await run('shortcuts', `return { commands: COMMANDS.length, keymap: keyMap.size, example: prettyCombo(keysFor(COMMANDS.find(c=>c.id==='set-start'))[0]), save: prettyCombo(keysFor(COMMANDS.find(c=>c.id==='save'))[0]) };`);
  await run('Alt+N key', `document.body.focus(); document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyN', key: 'n', altKey: true, bubbles: true })); return state.cues.length;`);
  await run('palette', `openPalette(); $('#palette-q').value = 'balance'; $('#palette-q').dispatchEvent(new Event('input')); const r = palItems.map(c => c.title); $('#palette').close(); return r;`);
  await run('settings', `openSettings('keys'); const filas = $$('#keys-table tr').length; $('#settings').close(); return filas;`);
  await run('working copy', `await flushSave(); return { server: save.server, path: save.path, status: $('#save-status').textContent };`);
  console.log('   copy files:', fs.existsSync(copiesDir) ? fs.readdirSync(copiesDir) : 'NONE');
  await run('export SRT', `return toSRT().split('\\n').slice(0, 8).join(' | ');`);

  const clip = process.env.CLIP;
  if (!clip) console.log('(no CLIP=/path/video.mp4: video tests skipped)');
  else {
  const murl = registerFile(clip);
  await run('open video (desktop route)', `openDesktopFile({ name: 'sintel.mp4', size: ${fs.statSync(clip).size}, url: '${murl}', kind: 'media' });
    await new Promise(r => video.addEventListener('loadedmetadata', r, { once: true }));
    return { dur: video.duration, w: video.videoWidth, h: video.videoHeight };`);
  await run('fps on playback', `video.muted = true; const p = video.play().then(() => 'ok', e => e.name); await new Promise(r => setTimeout(r, 4000)); const st = { rs: video.readyState, ns: video.networkState, paused: video.paused, t: video.currentTime.toFixed(2), err: video.error && video.error.code, dialogs: [...document.querySelectorAll('dialog[open]')].map(d => d.id), play: await Promise.race([p, new Promise(r => setTimeout(() => r('pendiente'), 100))]) }; video.pause(); return { detected: state.fpsDetected, st };`);
  await new Promise(r => setTimeout(r, 2500));
  await run('waveform', `return state.peaks ? { peaks: state.peaks.length, max: Math.max(...state.peaks).toFixed(2) } : 'no peaks';`);
  await run('detect cuts', `await detectScenes(); return state.cuts.map(t => t.toFixed(2));`);
  await run('snap candidates', `return snapCandidates(new Set()).length;`);
  await run('live timing', `
    state.cues.forEach(c => { c.tr = c.tr || 'x'; }); select(state.cues[0].id); video.currentTime = 0.2; await new Promise(r => setTimeout(r, 200));
    startLive(); const down = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true });
    document.dispatchEvent(down); await new Promise(r => setTimeout(r, 700));
    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }));
    const c = state.cues[0]; const res = { start: c.start.toFixed(2), end: c.end.toFixed(2), next: state.live && state.live.idx };
    stopLive(); video.pause(); return res;`);
  if (process.env.WHISPER) {
    // Downloads the tiny model the first time (about 40 MB); enable with WHISPER=1
    await run('whisper transcription (tiny)', `openTranscribe(); $('#tx-model').value = 'tiny'; $('#tx-lang').value = 'english';
      await runTranscription(); return { status: $('#tx-status').textContent, cues: state.cues.map(c => fmt(c.start) + ' ' + fmt(c.end) + ' ' + c.text.replace(/\\n/g, ' / ')) };`);
  }
  await run('review with cuts', `return collectIssues().filter(x => x.type === 'cut').map(x => x.msg);`);

  }
  await inApp(`setTranslation(false); setView('list'); select(state.cues[0].id); seek(1.2); toggleMenu($('#export-menu'), false);`);
  await new Promise(r => setTimeout(r, 500));
  fs.writeFileSync(path.join(OUT, 'shot-main.png'), (await win.webContents.capturePage()).toPNG());
  await inApp(`setView('review')`);
  await new Promise(r => setTimeout(r, 300));
  fs.writeFileSync(path.join(OUT, 'shot-review.png'), (await win.webContents.capturePage()).toPNG());
  await inApp(`setView('list'); setTranslation(true); openSync();`);
  await new Promise(r => setTimeout(r, 300));
  fs.writeFileSync(path.join(OUT, 'shot-translation.png'), (await win.webContents.capturePage()).toPNG());

  await run('help', `openHelp('h-quality'); const r = { sections: $$('#help-body section').length, shortcuts: $$('#help-keys .key-row').length, setting: $('[data-setting=maxCps]').textContent };
    $('#help-q').value = 'waveform'; filterHelp(); r.search = $$('#help-body section').filter(s => !s.hidden).map(s => s.id); r.rows = $$('#help-keys .key-row').filter(x => !x.hidden).length;
    $('#help-q').value = ''; filterHelp(); return r;`);
  await new Promise(r => setTimeout(r, 300));
  fs.writeFileSync(path.join(OUT, 'shot-help.png'), (await win.webContents.capturePage()).toPNG());
  await inApp(`$('#help').scrollTop = 0; $('#help-body').scrollTop = 0; document.getElementById('h-start').scrollIntoView(); spyHelp();`);
  await new Promise(r => setTimeout(r, 300));
  fs.writeFileSync(path.join(OUT, 'shot-help-start.png'), (await win.webContents.capturePage()).toPNG());
  await inApp(`$('#help').close()`);
  await inApp(`settings.lang = 'es'; saveSettings();`);
  await win.webContents.reload(); await waitApp(); await new Promise(r => setTimeout(r, 300));
  await run('Spanish language', `return { lang: document.documentElement.lang, open: $('#srt-input').parentElement.textContent.trim(), tab: $('#tab-list').textContent, cmd: COMMANDS[0].title, plural: T('toast.deleted', { n: 1 }) + ' / ' + T('toast.deleted', { n: 3 }), help: $('#h-start h2').textContent, fps: $('#fps-convert').options[1].textContent };`);
  fs.writeFileSync(path.join(OUT, 'shot-es.png'), (await win.webContents.capturePage()).toPNG());
  await inApp(`settings.lang = 'en'; saveSettings();`);
  await win.webContents.reload(); await waitApp(); await new Promise(r => setTimeout(r, 300));
  await run('English language', `return { lang: document.documentElement.lang, open: $('#srt-input').parentElement.textContent.trim(), help: $('#h-start h2').textContent, plural: T('toast.deleted', { n: 1 }) + ' / ' + T('toast.deleted', { n: 3 }) };`);
  console.log('--- console ---');
  logs.filter(l => !l.includes('Electron Security Warning')).forEach(l => console.log(l));
  app.quit();
});
