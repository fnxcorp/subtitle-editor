// The Review tab: every problem in one list, with filters and automatic fixes.
import { state } from '../core/state.ts';
import { pushHistory, sortCues, commit } from '../core/cues.ts';
import { fmt } from '../core/time.ts';
import { cueText, escapeHtml, plainText, visibleField } from '../core/text.ts';
import { T } from '../core/i18n.ts';
import { $, $$, listEl } from '../ui/dom.ts';
import { toast } from '../ui/toast.ts';
import { cueIssues, applyFix, FIX_LABEL } from './quality.ts';
import { select } from './list.ts';
import { seek } from './playback.ts';
import { balanceCues } from './editing.ts';
import type { Cue, FixKind, Issue, IssueType } from '../core/types.ts';

type ReviewItem = Issue & { c: Cue; i: number };

const ISSUE_ORDER: IssueType[] = ['speed', 'overlap', 'gap', 'chars', 'lines', 'short', 'long', 'cut', 'empty'];
const reviewFilter = new Set<IssueType>(ISSUE_ORDER);
let reviewItems: ReviewItem[] = [];

// view: 'list' | 'review'
export function setView(view: 'list' | 'review') {
  $$('.list-head .tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  listEl.hidden = view !== 'list';
  $('#review').hidden = view !== 'review';
  $('#empty').hidden = state.cues.length > 0 || view === 'review';
  if (view === 'review') renderReview();
}

export const isReviewOpen = () => !$('#review').hidden;

export function collectIssues(): ReviewItem[] {
  const out: ReviewItem[] = [];
  state.cues.forEach((c, i) => cueIssues(i).forEach(is => out.push({ ...is, c, i })));
  return out;
}

export function renderReview() {
  const el = $('#review');
  const all = collectIssues();
  const counts: Partial<Record<IssueType, number>> = {};
  all.forEach(x => { counts[x.type] = (counts[x.type] || 0) + 1; });
  reviewItems = all.filter(x => reviewFilter.has(x.type));
  const fixable = reviewItems.filter(x => x.fix && x.fix !== 'delete').length;
  const chips = ISSUE_ORDER.filter(k => counts[k]).map(k =>
    `<button class="chip${reviewFilter.has(k) ? ' on' : ''}" data-type="${k}">${T(`issueType.${k}`)} <b>${counts[k]}</b></button>`).join('');
  const shown = reviewItems.slice(0, 800);
  el.innerHTML = `
    <div class="rv-head">
      <div class="chips">${chips || ''}</div>
      <div class="rv-actions">
        <button class="btn accent" data-rv="fixall"${fixable ? '' : ' disabled'}>${T('review.autoFix', { n: fixable })}</button>
        <button class="btn" data-rv="balanceall" title="${T('review.balanceAllTitle')}">${T('review.balanceAll')}</button>
      </div>
      ${state.cuts.length ? '' : `<p class="muted small">${T('review.cutsTip')}</p>`}
    </div>
    ${all.length ? '' : `<p class="rv-empty">${T('review.noProblems')}</p>`}
    <div class="rv-list">${shown.map((x, k) => `
      <div class="rv-item lvl-${x.level}" data-k="${k}">
        <div class="rv-top">
          <span class="idx">#${x.i + 1}</span>
          <span class="mono muted">${fmt(x.c.start)}</span>
          <span class="rv-msg">${x.level === 2 ? '⛔' : '⚠'} ${escapeHtml(x.msg)}</span>
        </div>
        <div class="rv-text">${escapeHtml(plainText(cueText(x.c, visibleField())).replace(/\n/g, ' / ').slice(0, 120)) || `<i class="muted">${T('cue.empty')}</i>`}</div>
        <div class="rv-btns">
          <button class="btn" data-rv="edit">${T('review.edit')}</button>
          ${x.fix ? `<button class="btn" data-rv="fix">${FIX_LABEL[x.fix]}</button>` : ''}
        </div>
      </div>`).join('')}
      ${reviewItems.length > shown.length ? `<p class="muted small">${T('review.more', { n: reviewItems.length - shown.length })}</p>` : ''}
    </div>`;
}

// Fixes in several passes (one fix can cause another: extend → gap). Empty subtitles are never deleted here.
export function fixAll() {
  const order: (FixKind | null)[] = ['balance', 'minDur', 'extend', 'trimEnd', 'cutStart', 'cutEnd'];
  pushHistory();
  let fixed = 0;
  for (let pass = 0; pass < 4; pass++) {
    let changed = 0;
    for (let i = 0; i < state.cues.length; i++) {
      const c = state.cues[i];
      const issues = cueIssues(i).filter(x => reviewFilter.has(x.type) && x.fix && x.fix !== 'delete');
      issues.sort((a, b) => order.indexOf(a.fix) - order.indexOf(b.fix));
      for (const is of issues) {
        const before = JSON.stringify(c);
        applyFix(c, is);
        if (JSON.stringify(c) !== before) changed++;
      }
    }
    sortCues();
    fixed += changed;
    if (!changed) break;
  }
  commit();
  toast(fixed ? T('toast.fixed', { n: fixed }) : T('toast.nothingFix'), { undo: fixed > 0 });
}

$$('.list-head .tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view as 'list' | 'review')));

$('#review').addEventListener('click', e => {
  const target = e.target as HTMLElement;
  const chip = target.closest<HTMLElement>('.chip');
  if (chip) {
    const k = chip.dataset.type as IssueType;
    if (reviewFilter.has(k)) reviewFilter.delete(k); else reviewFilter.add(k);
    return renderReview();
  }
  const act = target.closest<HTMLElement>('[data-rv]')?.dataset.rv;
  if (act === 'fixall') return fixAll();
  if (act === 'balanceall') return balanceCues(state.cues);
  const item = target.closest<HTMLElement>('.rv-item');
  if (!item) return;
  const x = reviewItems[Number(item.dataset.k)];
  if (!x || !state.cues.includes(x.c)) return renderReview();
  if (act === 'edit') {
    setView('list');
    select(x.c.id, { scroll: true, focus: true, field: visibleField() });
    return seek(x.c.start);
  }
  if (act === 'fix') {
    pushHistory();
    applyFix(x.c, x);
    sortCues();
    return commit();
  }
  select(x.c.id);
  seek(x.c.start);
});
