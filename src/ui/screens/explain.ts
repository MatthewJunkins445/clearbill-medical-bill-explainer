// S07: the plain-words explanation. One `explainBill` call per approval: switching tabs and back reuses it.
import type {
  AIResult,
  ApprovedBill,
  BillExplanation,
  ClearBillAI,
  LineExplanation,
  RedactionApproval,
} from '../../ai/index.ts';
import { badge } from '../badge.ts';
import type { AppContext } from '../context.ts';
import { t } from '../copy.ts';
import { h } from '../dom.ts';
import { withQuestionDraft, withTab } from '../state.ts';
import { stepTitle } from '../steps.ts';
import { recoveryCard } from './errors.ts';
import { formatMoney } from './explain-format.ts';
import { auditReasonFor, changeChoiceButton, errorCodeOf } from './results-common.ts';

interface Entry {
  readonly promise: Promise<AIResult<BillExplanation>>;
  /** Set once a screen that was still on the page has put the call in the session log. */
  recorded: boolean;
}

// A new approval is a new object, so a changed choice or a revisited Review never sees an old result.
const calls = new WeakMap<ApprovedBill, Entry>();

function explainOnce(ai: ClearBillAI, bill: ApprovedBill): Entry {
  const known = calls.get(bill);
  if (known) return known;
  const promise = ai.explainBill(bill);
  const entry: Entry = { promise, recorded: false };
  calls.set(bill, entry);
  // A failed call is not remembered, so "Try again" asks again.
  promise.catch(() => {
    if (calls.get(bill) === entry) calls.delete(bill);
  });
  return entry;
}

function totalsList(totals: BillExplanation['totals']): HTMLElement {
  const rows: readonly (readonly [string, number | null])[] = [
    ['explain.totalBilled', totals.billed],
    ['explain.insurancePaid', totals.insurancePaid],
    ['explain.adjustments', totals.adjustments],
    ['explain.youOwe', totals.patientMayOwe],
  ];
  return h(
    'dl',
    { class: 'totals' },
    ...rows.flatMap(([key, amount]) => [h('dt', null, t(key)), h('dd', null, formatMoney(amount))]),
  );
}

function lineCard(
  line: LineExplanation,
  source: AIResult<unknown>['source'],
  onAsk: () => void,
): HTMLElement {
  return h(
    'article',
    { class: 'line-card panel' },
    h('h3', null, line.description),
    h(
      'p',
      { class: 'muted' },
      line.code === null ? t('explain.lineNoCode') : t('explain.lineCode', { code: line.code }),
      ' · ',
      formatMoney(line.charge),
    ),
    h('p', null, h('strong', null, t('explain.lineWhatItIs')), ': ', line.whatItIs),
    h('p', null, h('strong', null, t('explain.lineWhyCharged')), ': ', line.whyCharged),
    h(
      'div',
      { class: 'actions' },
      badge(source),
      h('button', { type: 'button', class: 'btn', onClick: onAsk }, t('explain.askAbout')),
    ),
  );
}

export function explainScreen(ctx: AppContext, approval: RedactionApproval): HTMLElement {
  const body = h('div', { class: 'explain-body', 'aria-busy': 'true' });
  const toQuestions = (prefill: string): void => {
    ctx.update((s) => withTab(withQuestionDraft(s, prefill), 'questions'));
  };

  function next(): HTMLElement {
    const reason = auditReasonFor(ctx, approval.bill);
    return h(
      'div',
      { class: 'next-actions' },
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-primary',
            onClick: () => {
              toQuestions('');
            },
          },
          t('explain.nextQuestions'),
        ),
        reason === null
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn',
                onClick: () => {
                  ctx.update((s) => withTab(s, 'audit'));
                },
              },
              t('explain.nextAudit'),
            )
          : null,
        changeChoiceButton(ctx),
      ),
      reason === null ? null : h('p', { class: 'muted' }, t(reason)),
    );
  }

  function showResult(result: AIResult<BillExplanation>): void {
    const { summary, lineItems, totals } = result.data;
    body.setAttribute('aria-busy', 'false');
    body.replaceChildren(
      h(
        'section',
        { class: 'panel', 'aria-labelledby': 'summary-title' },
        h('h2', { id: 'summary-title' }, t('explain.summaryTitle')),
        h('p', null, summary),
        totalsList(totals),
        badge(result.source),
      ),
      lineItems.length === 0
        ? h('p', { class: 'notice' }, t('explain.noLines'))
        : h(
            'div',
            { class: 'line-list' },
            ...lineItems.map((line) =>
              lineCard(line, result.source, () => {
                toQuestions(t('questions.aboutChargePrefill', { description: line.description }));
              }),
            ),
          ),
      next(),
    );
  }

  function showError(error: unknown): void {
    body.setAttribute('aria-busy', 'false');
    body.replaceChildren(recoveryCard(ctx, errorCodeOf(error), run), next());
  }

  function run(): void {
    body.setAttribute('aria-busy', 'true');
    body.replaceChildren(
      h('div', { class: 'busy' }, badge('pending'), h('p', null, t('explain.explaining'))),
      h('div', { class: 'skeleton', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
    );
    ctx.announce(t('explain.explaining'));
    let entry: Entry;
    try {
      entry = explainOnce(ctx.ai, approval.bill);
    } catch (error) {
      showError(error);
      return;
    }
    entry.promise.then(
      (result) => {
        // Logged even when the user has already left this screen: the call happened.
        if (!entry.recorded) {
          entry.recorded = true;
          ctx.record('explain', result);
        }
        if (!ctx.signal.aborted) showResult(result);
      },
      (error: unknown) => {
        if (!ctx.signal.aborted) showError(error);
      },
    );
  }

  const dom = h(
    'section',
    { class: 'screen explain' },
    h('h1', null, stepTitle(ctx.getSession())),
    h('p', null, t('explain.intro')),
    body,
  );
  run();
  return dom;
}
