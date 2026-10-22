// Unit tests for the pure core modules (no DOM): npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt, parseTime } from '../src/web/core/time.ts';
import { plainText, safeHtml, joinTexts, splitTextAtRatio } from '../src/web/core/text.ts';
import { parseSubs, toSRT, toVTT } from '../src/web/core/subtitles.ts';
import { balanceText } from '../src/web/core/balance.ts';
import { I18N, T } from '../src/web/core/i18n.ts';
import { state } from '../src/web/core/state.ts';
import { on } from '../src/web/core/events.ts';
import { newCue, pushHistory, restoreSnapshot, sortCues } from '../src/web/core/cues.ts';

test('fmt formats SRT and display timecodes', () => {
  assert.equal(fmt(3725.5), '01:02:05,500');
  assert.equal(fmt(1.0456, '.'), '00:00:01.046');
  assert.equal(fmt(-3), '00:00:00,000');
  assert.equal(fmt(NaN), '00:00:00,000');
});

test('parseTime accepts SRT, VTT and short forms', () => {
  assert.equal(parseTime('01:02:05,045'), 3725.045);
  assert.equal(parseTime('2:05.5'), 125.5);
  assert.equal(parseTime('00:00:07'), 7);
  assert.ok(Number.isNaN(parseTime('abc')));
});

test('parseSubs handles BOM, CRLF, missing blank lines and positions', () => {
  const srt = '﻿1\r\n00:00:01,000 --> 00:00:03,500\r\nHello <i>world</i>\r\nsecond line\r\n\r\n'
    + '2\r\n00:00:04,000 --> 00:00:06,000\r\n{\\an8}Top line\r\n3\r\n00:00:07,5 --> 00:00:08,000\r\nNo blank before\r\n';
  const cues = parseSubs(srt);
  assert.equal(cues.length, 3);
  assert.deepEqual([cues[0].start, cues[0].end, cues[0].text], [1, 3.5, 'Hello <i>world</i>\nsecond line']);
  assert.equal(cues[1].top, true);
  assert.equal(cues[1].text, 'Top line');
  assert.equal(cues[2].start, 7.5);

  const vtt = parseSubs('WEBVTT\n\n00:01.000 --> 00:02.250 line:5%\nVTT cue\n');
  assert.deepEqual([vtt[0].start, vtt[0].end, vtt[0].text, vtt[0].top], [1, 2.25, 'VTT cue', true]);
});

test('toSRT / toVTT round-trip', () => {
  const cues = [newCue(1, 2.5, 'One'), newCue(3, 4, 'Two', { top: true })];
  const srt = toSRT('text', cues);
  assert.equal(srt, '1\n00:00:01,000 --> 00:00:02,500\nOne\n\n2\n00:00:03,000 --> 00:00:04,000\n{\\an8}Two\n');
  assert.deepEqual(parseSubs(srt).map(c => [c.start, c.end, c.text, !!c.top]), [[1, 2.5, 'One', false], [3, 4, 'Two', true]]);
  assert.ok(toVTT('text', cues).startsWith('WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nOne'));
});

test('text helpers', () => {
  assert.equal(plainText('<i>Hi</i> {\\an8}there'), 'Hi there');
  assert.equal(safeHtml('<i>ok</i> <script>x</script>\nline'), '<i>ok</i> &lt;script&gt;x&lt;/script&gt;<br>line');
  assert.equal(joinTexts('a ', ' b'), 'a b');
  assert.equal(joinTexts('', 'b'), 'b');
  assert.deepEqual(splitTextAtRatio('one two three four', 0.5), ['one two', 'three four']);
});

test('balanceText wraps long lines and avoids ending on weak words', () => {
  assert.equal(balanceText('Short line'), 'Short line');
  const out = balanceText('Esta es una frase bastante larga que no cabe en una sola línea de subtítulo');
  const lines = out.split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines.every(l => l.length <= 42), out);
  assert.ok(!/ (de|la|que|en|una)$/.test(lines[0]), out);
  assert.equal(balanceText('- Hi there.\n- Hello!'), '- Hi there.\n- Hello!'); // dialogue untouched
});

test('T interpolates, pluralises and falls back to the key', () => {
  I18N.lang = 'en';
  I18N.dict = { a: { hello: 'Hi {name}', n: { one: '{n} item', other: '{n} items' } } };
  I18N.fallback = { only: 'from fallback' };
  assert.equal(T('a.hello', { name: 'Ana' }), 'Hi Ana');
  assert.equal(T('a.n', { n: 1 }), '1 item');
  assert.equal(T('a.n', { n: 3 }), '3 items');
  assert.equal(T('only'), 'from fallback');
  assert.equal(T('missing.key'), 'missing.key');
});

test('history snapshots restore cues and announce the change', () => {
  let changes = 0;
  on('cues-changed', () => changes++);
  state.cues = [newCue(5, 6, 'B'), newCue(1, 2, 'A')];
  sortCues();
  assert.deepEqual(state.cues.map(c => c.text), ['A', 'B']);
  pushHistory();
  state.cues.pop();
  restoreSnapshot(state.undo.pop()!);
  assert.deepEqual(state.cues.map(c => c.text), ['A', 'B']);
  assert.equal(changes, 1);
});
