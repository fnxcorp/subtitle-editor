// End-to-end tests: npm run test:e2e  (CLIP=/path/video.mp4 to also run the video tests)
// Opens a real window for a few seconds. Without audio output the video is muted so its clock advances.
import { app, BrowserWindow } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { start, registerFile } from '../src/server/server.ts';
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), 'subtitle-editor-e2e');
fs.mkdirSync(OUT, { recursive: true });

// Whisper runs (model downloads, long clips) need much longer limits
const LIMIT = process.env.WHISPER ? 1200000 : 170000;
setTimeout(() => { console.log('ABORT global'); app.exit(1); }, LIMIT);
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
  // Runs a snippet in the app; `expect` checks its result (a failed check or a thrown error is ✘)
  let failed = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- results are whatever the snippet returns
  const run = async (name: string, code: string, expect?: (r: any) => unknown) => {
    try {
      const r = await Promise.race([inApp(code), new Promise((_, rej) => setTimeout(() => rej(new Error('TIMED OUT')), LIMIT / 3))]);
      const ok = !expect || expect(r);
      if (!ok) failed++;
      console.log(ok ? '✔' : '✘', name, r === undefined ? '' : JSON.stringify(r));
    }
    catch (e) { failed++; console.log('✘', name, (e as Error).message); }
  };
  const check = (name: string, ok: boolean, info = '') => { if (!ok) failed++; console.log(ok ? '✔' : '✘', name, info); };
  win.webContents.on('will-prevent-unload', e => e.preventDefault()); // the "unsaved original" prompt would block reloads
  await run('help opens on first run', `const o = $('#help').open; $('#help').close(); return o;`, r => r === true);
  await run('load SRT', `
    localStorage.clear(); localStorage.setItem('subeditor:helpSeen', '1');
    loadSubsText("1\\n00:00:01,000 --> 00:00:02,000\\nEste texto es demasiado largo para leerlo en solo un segundo\\n\\n2\\n00:00:01,900 --> 00:00:04,000\\nHola mundo\\n\\n3\\n00:00:04,000 --> 00:00:04,300\\nCorto\\n\\n4\\n00:00:05,000 --> 00:00:08,000\\n{\\\\an8}Esta es una frase bastante larga que no cabe en una sola línea\\n", 'prueba.srt');
    return { n: state.cues.length, top: state.cues[3].top, issues: collectIssues().map(x => x.type) };`, r => r.n === 4 && r.top && r.issues.includes('overlap'));
  await run('balance', `return balanceText('Esta es una frase bastante larga que no cabe en una sola línea de subtítulo');`, r => r === 'Esta es una frase bastante larga\nque no cabe en una sola línea de subtítulo');
  await run('auto-fix', `fixAll(); return { remaining: collectIssues().map(x => x.type + ':' + x.i), cues: state.cues.map(c => [c.start.toFixed(2), c.end.toFixed(2), c.text]) };`, r => !r.remaining.some((x: string) => /overlap|gap|chars|short/.test(x)));
  await run('undo', `undo(); return collectIssues().length;`, r => r === 7);
  await run('two-point sync', `sync.a = { orig: 10, at: 12, n: 1 }; sync.b = { orig: 100, at: 105.6, n: 2 }; renderSync(); const t = syncTransform(); return { k: t.k.toFixed(5), off: t.off.toFixed(3), text: $('#sync-result').textContent };`, r => r.k === '1.04000' && r.off === '1.600');
  await run('find/replace', `openFind(); $('#find-q').value = 'hola'; refreshFind(); const c = find.matches.length; $('#find-r').value = 'Adiós'; replaceAll(); closeFind(); return { found: c, text: state.cues[1].text };`, r => r.found === 1 && r.text === 'Adiós mundo');
  await run('merge/split', `const n0 = state.cues.length; joinWithNext(state.cues[0]); const n1 = state.cues.length; const c = state.cues[0]; const ta = rowOf(c.id).querySelector('[data-field="text"]'); ta.focus(); ta.setSelectionRange(10, 10); splitAtCaret(c, ta); return { before: n0, merged: n1, split: state.cues.length, a: state.cues[0].text, b: state.cues[1].text, cut: state.cues[0].end.toFixed(2) };`, r => r.merged === r.before - 1 && r.split === r.before && r.a === 'Este texto');
  await run('multi-select', `select(state.cues[0].id); select(state.cues[2].id, { mode: 'range' }); const n = state.selection.size; const vis = !$('#multi-bar').hidden; shiftCues(selectedCues(), 0.5); return { n, bar: vis, start: state.cues[0].start };`, r => r.n === 3 && r.bar && r.start === 1.5);
  await run('translation mode', `setTranslation(true); loadTranslationText("1\\n00:00:01,000 --> 00:00:02,000\\nThis text is too long\\n\\n2\\n00:00:05,000 --> 00:00:08,000\\nLong sentence\\n", 'en.srt'); return { columns: document.querySelectorAll('[data-field=tr]').length, tr: state.cues.map(c => c.tr || '') };`, r => r.tr[0] === 'This text is too long' && r.tr[3] === 'Long sentence');
  await run('shortcuts', `return { commands: COMMANDS.length, keymap: keyMap.size, example: prettyCombo(keysFor(COMMANDS.find(c=>c.id==='set-start'))[0]), save: prettyCombo(keysFor(COMMANDS.find(c=>c.id==='save'))[0]) };`, r => r.commands > 40 && r.keymap > 40 && r.save === (process.platform === 'darwin' ? '⌘S' : 'Ctrl+S'));
  await run('Alt+N key', `document.body.focus(); document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyN', key: 'n', altKey: true, bubbles: true })); return state.cues.length;`, r => r === 5);
  await run('palette', `openPalette(); $('#palette-q').value = 'balance'; $('#palette-q').dispatchEvent(new Event('input')); const r = palItems.map(c => c.title); $('#palette').close(); return r;`, r => r[0] === 'Balance lines');
  await run('settings', `openSettings('keys'); const filas = $$('#keys-table tr').length; $('#settings').close(); return filas;`, r => r > 40);
  await run('timeline scrollbar', `state.pps = 200; requestDraw(); drawIfNeeded(); const bar = $('#timeline-scroll'); bar.scrollLeft = 400;
    await new Promise(r => setTimeout(r, 100)); return { scrollable: bar.scrollWidth > bar.clientWidth, viewStart: state.viewStart, visible: bar.offsetHeight };`, r => r.scrollable && r.viewStart === 2 && r.visible > 0);
  await run('working copy', `await flushSave(); return { server: save.server, path: save.path, status: $('#save-status').textContent };`, r => r.server && r.path.endsWith('prueba.working-copy.srt'));
  // AC-3 in MKV: Chromium can't decode it, so the waveform needs the ffmpeg fallback
  const ac3 = path.join(OUT, 'tone-ac3.mkv');
  try { execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'ac3', ac3]); } catch {}
  if (!fs.existsSync(ac3)) console.log('(no ffmpeg: AC-3 waveform test skipped)');
  else await run('waveform via ffmpeg (AC-3)', `await connectServer(); state.video = { name: 'tone.mkv', size: 1, url: '${registerFile(ac3)}', token: '${registerFile(ac3).split('/')[2]}' };
    const native = await new OfflineAudioContext(1, 1, 8000).decodeAudioData(await (await fetch(state.video.url)).arrayBuffer()).then(() => 'ok', e => e.name);
    const a = await decodeAudio(8000); state.video = null; return { native, seconds: (a.length / a.sampleRate).toFixed(1) };`, r => r.native === 'EncodingError' && r.seconds === '3.0');
  const orig = path.join(OUT, 'original.srt');
  fs.writeFileSync(orig, '1\n00:00:01,000 --> 00:00:02,000\nOld\n');
  const origTr = path.join(OUT, 'original.en.srt');
  fs.writeFileSync(origTr, '1\n00:00:01,000 --> 00:00:02,000\nOld en\n');
  await run('Ctrl+S saves the original and its translation', `openDesktopFile({ name: 'original.srt', size: 1, url: '${registerFile(orig)}', kind: 'subs' });
    await new Promise(r => setTimeout(r, 500)); const clean = document.title;
    setTranslation(true); const buf = await (await fetch('${registerFile(origTr)}')).arrayBuffer();
    loadTranslationText(new TextDecoder().decode(buf), 'original.en.srt', { token: '${registerFile(origTr).split('/')[2]}' });
    pushHistory(); state.cues[0].text = 'New'; state.cues[0].tr = 'New en'; commit(); const dirty = document.title;
    await saveNow(); const r = { clean, dirty, saved: document.title }; setTranslation(false); return r;`,
    r => !r.clean.startsWith('•') && r.dirty.startsWith('•') && !r.saved.startsWith('•'));
  check('original file written', fs.readFileSync(orig, 'utf8').includes('New') && fs.existsSync(path.join(copiesDir, 'original.original.srt')));
  check('translation file written', fs.readFileSync(origTr, 'utf8').includes('New en') && fs.existsSync(path.join(copiesDir, 'original.en.original.srt')));
  await run('export SRT', `return toSRT().split('\\n').slice(0, 8).join(' | ');`, r => r.startsWith('1 | 00:00:01,000 --> 00:00:02,000'));

  const clip = process.env.CLIP;
  if (!clip) console.log('(no CLIP=/path/video.mp4: video tests skipped)');
  else {
  const murl = registerFile(clip);
  await run('open video (desktop route)', `openDesktopFile({ name: 'sintel.mp4', size: ${fs.statSync(clip).size}, url: '${murl}', kind: 'media' });
    await new Promise(r => video.addEventListener('loadedmetadata', r, { once: true }));
    return { dur: video.duration, w: video.videoWidth, h: video.videoHeight };`, r => r.dur > 0 && r.w > 0);
  await run('fps on playback', `video.muted = true; const p = video.play().then(() => 'ok', e => e.name); await new Promise(r => setTimeout(r, 4000)); const st = { rs: video.readyState, ns: video.networkState, paused: video.paused, t: video.currentTime.toFixed(2), err: video.error && video.error.code, dialogs: [...document.querySelectorAll('dialog[open]')].map(d => d.id), play: await Promise.race([p, new Promise(r => setTimeout(() => r('pendiente'), 100))]) }; video.pause(); return { detected: state.fpsDetected, st };`, r => r.detected > 0 && r.st.play === 'ok');
  await new Promise(r => setTimeout(r, 2500));
  await run('waveform', `return state.peaks ? { peaks: state.peaks.length, max: Math.max(...state.peaks).toFixed(2) } : 'no peaks';`, r => r.peaks > 0 && r.max === '1.00');
  await run('detect cuts', `await detectScenes(); return state.cuts.map(t => t.toFixed(2));`, r => Array.isArray(r));
  await run('snap candidates', `return snapCandidates(new Set()).length;`, r => r > 0);
  await run('live timing', `
    state.cues.forEach(c => { c.tr = c.tr || 'x'; }); select(state.cues[0].id); video.currentTime = 0.2; await new Promise(r => setTimeout(r, 200));
    startLive(); const down = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true });
    document.dispatchEvent(down); await new Promise(r => setTimeout(r, 700));
    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }));
    const c = state.cues[0]; const res = { start: c.start.toFixed(2), end: c.end.toFixed(2), next: state.live && state.live.idx };
    stopLive(); video.pause(); return res;`, r => r.start === '0.20' && +r.end > 0.5);
  await run('overview marks on the scrollbar', `requestDraw(); drawIfNeeded(); const c = $('#timeline'), d = c.getContext('2d').getImageData(0, (c.height - 4 * devicePixelRatio) | 0, c.width, 1).data;
    let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 150) lit++; return lit;`, r => r > 0);
  if (process.env.WHISPER) {
    // Downloads the tiny model the first time (about 40 MB); enable with WHISPER=1
    await run('whisper transcription (tiny)', `openTranscribe(); $('#tx-model').value = 'tiny'; $('#tx-lang').value = 'english';
      await runTranscription(); return { status: $('#tx-status').textContent, cues: state.cues.map(c => fmt(c.start) + ' ' + fmt(c.end) + ' ' + c.text.replace(/\\n/g, ' / ')) };`, r => r.cues.length > 0);
    await run('whisper.cpp transcription (base)', `if (!serverInfo.whisper) return 'no whisper-cli';
      openTranscribe(); $('#tx-model').value = 'native:base'; $('#tx-lang').value = ''; $('#tx-from-now').checked = false;
      await runTranscription(); return { status: $('#tx-status').textContent, cues: state.cues.slice(0, 6).map(c => fmt(c.start) + ' ' + c.text.replace(/\\n/g, ' / ')), n: state.cues.length };`,
      r => r === 'no whisper-cli' || r.n > 0);
  }
  await run('review with cuts', `return collectIssues().filter(x => x.type === 'cut').map(x => x.msg);`, r => Array.isArray(r));

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
    $('#help-q').value = ''; filterHelp(); return r;`, r => r.sections > 5 && r.search.length > 0);
  await new Promise(r => setTimeout(r, 300));
  fs.writeFileSync(path.join(OUT, 'shot-help.png'), (await win.webContents.capturePage()).toPNG());
  await inApp(`$('#help').scrollTop = 0; $('#help-body').scrollTop = 0; document.getElementById('h-start').scrollIntoView(); spyHelp();`);
  await new Promise(r => setTimeout(r, 300));
  fs.writeFileSync(path.join(OUT, 'shot-help-start.png'), (await win.webContents.capturePage()).toPNG());
  await inApp(`$('#help').close()`);
  await inApp(`settings.lang = 'es'; saveSettings();`);
  await win.webContents.reload(); await waitApp(); await new Promise(r => setTimeout(r, 300));
  await run('Spanish language', `return { lang: document.documentElement.lang, open: $('#srt-input').parentElement.textContent.trim(), tab: $('#tab-list').textContent, cmd: COMMANDS[0].title, plural: T('toast.deleted', { n: 1 }) + ' / ' + T('toast.deleted', { n: 3 }), help: $('#h-start h2').textContent, fps: $('#fps-convert').options[1].textContent };`, r => r.lang === 'es' && r.open === 'Abrir SRT' && r.plural.startsWith('Subtítulo borrado'));
  fs.writeFileSync(path.join(OUT, 'shot-es.png'), (await win.webContents.capturePage()).toPNG());
  await inApp(`settings.lang = 'en'; saveSettings();`);
  await win.webContents.reload(); await waitApp(); await new Promise(r => setTimeout(r, 300));
  await run('English language', `return { lang: document.documentElement.lang, open: $('#srt-input').parentElement.textContent.trim(), help: $('#h-start h2').textContent, plural: T('toast.deleted', { n: 1 }) + ' / ' + T('toast.deleted', { n: 3 }) };`, r => r.lang === 'en' && r.open === 'Open SRT');
  console.log('--- console ---');
  logs.filter(l => !l.includes('Electron Security Warning')).forEach(l => console.log(l));
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  app.exit(failed ? 1 : 0);
});
