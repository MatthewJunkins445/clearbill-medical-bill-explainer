// S10: the editable letter. `draftLetter` is called only when consent is `agreed` and the cloud is open (checked in
// `draft()`, right before the call). The raw AI result (placeholders only) is cached per approval, kind and chosen
// flags, so revisiting the tab does not send the bill again; "Draft again" is the only thing that asks again. The text
// the user edits or fills in with their own details lives only in the textarea: it is never stored anywhere else, and
// "Fill in my details" is a local `vault.rehydrate`, with no network call.
import type {
  AIResult,
  ApprovedBill,
  AuditFlag,
  ClearBillAI,
  LetterDraft,
  LetterKind,
  RedactionApproval,
} from '../../ai/index.ts';
import { LETTER_KINDS } from '../../ai/index.ts';
import { badge } from '../badge.ts';
import type { AppContext } from '../context.ts';
import { t, tn } from '../copy.ts';
import { h } from '../dom.ts';
import { stepTitle } from '../steps.ts';
import { selectedFlags } from './audit-view.ts';
import type { ClosedGate } from './cloud-gate.ts';
import { cloudErrorCard, cloudNoticeCard, currentGate } from './cloud-notice.ts';
import { countPlaceholders, defaultKind } from './letter-view.ts';

const KIND_LABEL: Readonly<Record<LetterKind, string>> = {
  itemized: 'letter.typeItemized',
  dispute: 'letter.typeDispute',
  appeal: 'letter.typeAppeal',
};

interface Entry {
  readonly promise: Promise<AIResult<LetterDraft>>;
  /** Set once the call has been put in the session log (exactly once per real AI call). */
  recorded: boolean;
}

// A new approval is a new object, so a changed choice or a revisited Review never sees an old draft.
const drafts = new WeakMap<ApprovedBill, Map<string, Entry>>();

const draftKey = (kind: LetterKind, flags: readonly AuditFlag[]): string =>
  `${kind}|${flags
    .map((f) => f.id)
    .sort()
    .join(',')}`;

/** The call for this kind and these flags: reused if already made, else made now (`fresh` asks again). */
function draftOnce(
  ai: ClearBillAI,
  bill: ApprovedBill,
  kind: LetterKind,
  flags: readonly AuditFlag[],
  fresh: boolean,
): Entry {
  let byKey = drafts.get(bill);
  if (!byKey) {
    byKey = new Map();
    drafts.set(bill, byKey);
  }
  const key = draftKey(kind, flags);
  const known = byKey.get(key);
  if (known && !fresh) return known;
  // The editor text is never sent: only the approved bill, the chosen flags and the letter kind.
  const promise = ai.draftLetter(bill, { flags }, kind);
  const entry: Entry = { promise, recorded: false };
  byKey.set(key, entry);
  promise.catch(() => {
    // A failed call is not remembered, so "Try again" asks again.
    if (byKey.get(key) === entry) byKey.delete(key);
  });
  return entry;
}

export function letterScreen(ctx: AppContext, approval: RedactionApproval): HTMLElement {
  const bill: ApprovedBill = approval.bill;
  let kind: LetterKind = defaultKind(selectedFlags(bill).length);
  /** Only the newest draft is shown; older ones are still logged. */
  let latest = 0;
  /** The text in the editor was changed by the user (typing or filling in details). */
  let edited = false;
  let confirmRedraft = false;

  const slot = h('div', { class: 'letter-slot', 'aria-busy': 'true' });
  const warning = h('p', { class: 'notice', hidden: true, role: 'status' });

  function setWarning(on: boolean): void {
    confirmRedraft = on;
    warning.hidden = !on;
    warning.textContent = on ? t('letter.redraftWarning') : '';
  }

  /** Asks the user first when a new draft would replace their edits; returns whether to go on. */
  function mayRedraft(): boolean {
    if (!edited || confirmRedraft) return true;
    setWarning(true);
    return false;
  }

  function editor(result: AIResult<LetterDraft>): HTMLElement {
    const hintId = 'fill-details-hint';
    const text = h('textarea', { id: 'letter-text', class: 'letter-text', rows: 16, spellcheck: true });
    text.value = result.data.text;
    const left = h('p', { class: 'muted', id: 'letter-left', role: 'status' });
    const filledNote = h('p', { class: 'muted', hidden: true }, t('letter.fillDetailsOn'));
    const fill = h(
      'button',
      {
        type: 'button',
        class: 'btn',
        'aria-describedby': hintId,
        onClick: () => {
          // Local only. The filled text goes into the textarea and nowhere else.
          text.value = approval.vault.rehydrate(text.value);
          edited = true;
          filledNote.hidden = false;
          ctx.announce(t('letter.fillDetailsOn'));
          refresh();
          // The button hides itself once nothing is left to fill in, so keep the keyboard where the text is.
          text.focus();
        },
      },
      t('letter.fillDetails'),
    );
    const fillRow = h(
      'div',
      { class: 'fill-row' },
      h('p', { class: 'muted', id: hintId }, t('letter.fillDetailsHint')),
      fill,
    );

    function refresh(): void {
      const labels = countPlaceholders(text.value);
      left.textContent = labels > 0 ? tn('letter.placeholdersLeft', labels) : '';
      fillRow.hidden = approval.vault.rehydrate(text.value) === text.value;
    }
    text.addEventListener('input', () => {
      edited = true;
      refresh();
    });
    refresh();

    return h(
      'div',
      { class: 'letter-editor' },
      h('label', { for: 'letter-text', class: 'field-label' }, t('letter.editorLabel')),
      text,
      h('div', { class: 'actions' }, badge(result.source)),
      fillRow,
      filledNote,
      left,
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onClick: () => {
              if (mayRedraft()) void draft(true);
            },
          },
          t('letter.regenerate'),
        ),
      ),
      h('p', { class: 'muted' }, t('letter.editsNotKept')),
      h('p', null, t('letter.nextSteps')),
      h('p', { class: 'muted' }, t('disclaimers.letter')),
    );
  }

  function showGate(gate: ClosedGate): void {
    latest += 1;
    group.hidden = true;
    slot.setAttribute('aria-busy', 'false');
    slot.replaceChildren(cloudNoticeCard(ctx, gate, 'letter'));
  }

  /** `fresh` is "Draft again": it replaces the remembered draft for this kind and these flags. */
  async function draft(fresh = false): Promise<void> {
    // Checked here, right before the call, so a retry, a type change or "Draft again" cannot skip it.
    const gate = currentGate(ctx, bill);
    if (gate.kind !== 'run') {
      showGate(gate);
      return;
    }
    const mine = ++latest;
    edited = false;
    setWarning(false);
    slot.setAttribute('aria-busy', 'true');
    slot.replaceChildren(h('div', { class: 'busy' }, badge('pending'), h('p', null, t('letter.drafting'))));
    ctx.announce(t('letter.drafting'));
    try {
      const entry = draftOnce(ctx.ai, bill, kind, selectedFlags(bill), fresh);
      const result = await entry.promise;
      // Logged even when the user has already left this screen: the call happened.
      if (!entry.recorded) {
        entry.recorded = true;
        ctx.record('letter', result);
      }
      if (ctx.signal.aborted || mine !== latest) return;
      slot.setAttribute('aria-busy', 'false');
      slot.replaceChildren(editor(result));
    } catch (error) {
      if (ctx.signal.aborted || mine !== latest) return;
      slot.setAttribute('aria-busy', 'false');
      slot.replaceChildren(
        cloudErrorCard(ctx, error, 'letter', () => {
          void draft(true);
        }),
      );
    }
  }

  const group = h(
    'fieldset',
    { class: 'kind-group' },
    h('legend', null, t('letter.typeLabel')),
    ...LETTER_KINDS.map((value) => {
      const id = `letter-kind-${value}`;
      const radio = h('input', { type: 'radio', name: 'letter-kind', id, value });
      radio.checked = value === kind;
      radio.addEventListener('change', () => {
        if (!radio.checked || value === kind) return;
        kind = value;
        // With edits in the editor the new type waits for "Draft again", which asks first.
        if (mayRedraft()) void draft();
      });
      return h('div', { class: 'check-row' }, radio, h('label', { for: id }, t(KIND_LABEL[value])));
    }),
  );

  const dom = h(
    'section',
    { class: 'screen letter' },
    h('h1', null, stepTitle(ctx.getSession())),
    h('p', null, t('letter.intro')),
    group,
    warning,
    h('p', { class: 'muted' }, t('letter.toneNote')),
    slot,
  );

  void draft();
  return dom;
}
