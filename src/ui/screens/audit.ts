// S09: things worth checking. `auditBill` is called only when consent is `agreed` and the cloud is open, once per
// approval: switching tabs and back reuses the result. Flags are questions to ask, never accusations.
import type {
  AIResult,
  ApprovedBill,
  AuditFlag,
  BillAudit,
  ClearBillAI,
  RedactionApproval,
} from '../../ai/index.ts';
import { badge } from '../badge.ts';
import type { AppContext } from '../context.ts';
import { t, tn } from '../copy.ts';
import { h } from '../dom.ts';
import { withTab } from '../state.ts';
import { stepTitle } from '../steps.ts';
import { countSeverities, formatLines, isSelected, setFlags, sortFlags, toggleFlag } from './audit-view.ts';
import { cloudErrorCard, cloudNoticeCard, currentGate } from './cloud-notice.ts';
import { createIdSource } from './ids.ts';

interface Entry {
  readonly promise: Promise<AIResult<BillAudit>>;
  /** Set once a screen that was still on the page has put the call in the session log. */
  recorded: boolean;
}

// A new approval is a new object, so a changed choice or a revisited Review never sees an old result.
const calls = new WeakMap<ApprovedBill, Entry>();

function auditOnce(ai: ClearBillAI, bill: ApprovedBill): Entry {
  const known = calls.get(bill);
  if (known) return known;
  const promise = ai.auditBill(bill);
  const entry: Entry = { promise, recorded: false };
  calls.set(bill, entry);
  promise.then(
    // The Letter tab reads the flags (and which of them the user ticks) from here, even if this screen is gone.
    (result) => {
      setFlags(bill, sortFlags(result.data.flags));
    },
    () => {
      // A failed call is not remembered, so "Try again" asks again.
      if (calls.get(bill) === entry) calls.delete(bill);
    },
  );
  return entry;
}

function flagCard(flag: AuditFlag, bill: ApprovedBill, titleId: string, checkId: string): HTMLElement {
  const tag = h(
    'span',
    { class: `severity severity-${flag.severity}` },
    h('span', { 'aria-hidden': 'true' }, flag.severity === 'likely_error' ? '! ' : '? '),
    t(`audit.severity.${flag.severity}.label`),
  );
  const included = h(
    'span',
    { class: 'included-tag', hidden: !isSelected(bill, flag.id) },
    t('audit.includedInLetter'),
  );
  // Named "Include in letter" plus the flag title, so each box is distinct for screen readers.
  const box = h('input', { type: 'checkbox', id: checkId, 'aria-labelledby': `${checkId}-label ${titleId}` });
  box.checked = isSelected(bill, flag.id);
  box.addEventListener('change', () => {
    included.hidden = !toggleFlag(bill, flag.id);
  });
  return h(
    'article',
    { class: 'flag-card panel', 'aria-labelledby': titleId },
    h('h3', { id: titleId }, flag.title),
    h('p', null, tag, ' ', h('span', { class: 'muted' }, t(`audit.severity.${flag.severity}.description`))),
    h('p', null, h('strong', null, t('audit.flagWhy')), ': ', flag.why),
    h('p', null, h('strong', null, t('audit.flagAsk')), ': ', flag.ask),
    flag.lineIndexes.length > 0
      ? h('p', { class: 'muted' }, t('audit.flagLines', { lines: formatLines(flag.lineIndexes) }))
      : null,
    h(
      'div',
      { class: 'check-row' },
      box,
      h('label', { for: checkId, id: `${checkId}-label` }, t('audit.includeInLetter')),
      included,
    ),
  );
}

export function auditScreen(ctx: AppContext, approval: RedactionApproval): HTMLElement {
  const bill = approval.bill;
  const body = h('div', { class: 'audit-body', 'aria-busy': 'true' });
  const nextId = createIdSource('flag');

  function showResult(result: AIResult<BillAudit>): void {
    const flags = sortFlags(result.data.flags);
    const { likely, asking } = countSeverities(flags);
    body.setAttribute('aria-busy', 'false');
    body.replaceChildren(
      h(
        'div',
        { class: 'audit-summary' },
        h('p', null, h('strong', null, tn('audit.countSummary', likely, { likely, asking }))),
        badge(result.source),
      ),
      h('p', { class: 'muted' }, t('disclaimers.audit')),
      flags.length === 0
        ? h('p', { class: 'notice' }, t('audit.noFlags'))
        : h(
            'ul',
            { class: 'flag-list' },
            ...flags.map((flag) => {
              const id = nextId();
              return h('li', null, flagCard(flag, bill, `${id}-title`, `${id}-check`));
            }),
          ),
      h(
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
              'aria-describedby': 'make-letter-hint',
              onClick: () => {
                ctx.update((s) => withTab(s, 'letter'));
              },
            },
            t('audit.makeLetter'),
          ),
        ),
        h('p', { class: 'muted', id: 'make-letter-hint' }, t('audit.makeLetterHint')),
      ),
    );
  }

  function showError(error: unknown): void {
    body.setAttribute('aria-busy', 'false');
    body.replaceChildren(cloudErrorCard(ctx, error, 'audit', run));
  }

  function run(): void {
    // Checked here, right before the call, so a retry (or any other path) cannot skip it.
    const gate = currentGate(ctx, bill);
    if (gate.kind !== 'run') {
      body.setAttribute('aria-busy', 'false');
      body.replaceChildren(cloudNoticeCard(ctx, gate, 'audit'));
      return;
    }
    body.setAttribute('aria-busy', 'true');
    body.replaceChildren(
      h('div', { class: 'busy' }, badge('pending'), h('p', null, t('audit.running'))),
      h('div', { class: 'skeleton', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
    );
    ctx.announce(t('audit.running'));
    const entry = auditOnce(ctx.ai, bill);
    entry.promise.then(
      (result) => {
        // Logged even when the user has already left this screen: the call happened.
        if (!entry.recorded) {
          entry.recorded = true;
          ctx.record('audit', result);
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
    { class: 'screen audit' },
    h('h1', null, stepTitle(ctx.getSession())),
    h('p', null, t('audit.intro')),
    body,
  );
  run();
  return dom;
}
