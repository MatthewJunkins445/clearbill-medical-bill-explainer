// S01: add a bill by pasting text or by choosing the built-in sample. PDF and photo import are cut.
import { SAMPLE_IDS, type AIErrorCode, type BillInput } from '../../ai/index.ts';
import type { AppContext, Screen } from '../context.ts';
import { t } from '../copy.ts';
import { h } from '../dom.ts';
import { goTo, withInput } from '../state.ts';
import { errorCard } from './errors.ts';

// A screen that sends the user back to S01 leaves a one-time notice here; S01 shows it once.
let pendingNotice: AIErrorCode | null = null;

/** Called by the screen that returns the user to S01, before it navigates. */
export function setImportNotice(code: AIErrorCode): void {
  pendingNotice = code;
}

function takeImportNotice(): AIErrorCode | null {
  const code = pendingNotice;
  pendingNotice = null;
  return code;
}

/** Returning users with a ready model skip S03. Anything else goes to the device setup. */
async function proceed(ctx: AppContext, input: BillInput): Promise<void> {
  const status = await ctx.ai.getDeviceStatus();
  if (ctx.signal.aborted) return;
  ctx.update((s) => goTo(withInput(s, input), status.state === 'available' ? 'working' : 'model'));
}

export const importScreen: Screen = (ctx) => {
  const { input } = ctx.getSession();
  const notice = takeImportNotice();

  const textarea = h('textarea', {
    id: 'bill-text',
    class: 'bill-text',
    rows: 12,
    placeholder: t('import.pastePlaceholder'),
    'aria-describedby': 'bill-text-hint',
    spellcheck: false,
  });
  if (input?.kind === 'text') textarea.value = input.text;

  const hint = h('p', { id: 'submit-hint', class: 'muted' }, t('import.submitDisabledHint'));
  const submit = h('button', { type: 'button', class: 'btn btn-primary' }, t('import.submit'));
  const sample = h('button', { type: 'button', class: 'btn' }, t('import.trySample'));

  let busy = false;
  const refresh = (): void => {
    const empty = textarea.value.trim() === '';
    submit.disabled = empty || busy;
    sample.disabled = busy;
    hint.hidden = !empty;
    // A hidden element is still read through aria-describedby, so the link exists only while the hint shows.
    if (empty) submit.setAttribute('aria-describedby', 'submit-hint');
    else submit.removeAttribute('aria-describedby');
  };
  const go = (next: BillInput): void => {
    if (busy) return;
    busy = true;
    refresh();
    ctx.announce(t('deviceModel.checking'));
    proceed(ctx, next).catch(() => {
      busy = false;
      refresh();
      ctx.showError('UNKNOWN', () => {
        go(next);
      });
    });
  };
  textarea.addEventListener('input', refresh);
  submit.addEventListener('click', () => {
    go({ kind: 'text', text: textarea.value, origin: 'paste' });
  });
  sample.addEventListener('click', () => {
    go({ kind: 'sample', sampleId: SAMPLE_IDS[0] });
  });
  refresh();

  return h(
    'section',
    { class: 'screen' },
    h('h1', null, t('import.title')),
    notice
      ? errorCard(
          notice,
          notice === 'INPUT_TOO_LONG'
            ? [
                {
                  label: t('errors.INPUT_TOO_LONG.primaryAction'),
                  run: () => {
                    textarea.focus();
                  },
                },
              ]
            : [],
        )
      : null,
    h('p', null, t('import.intro')),
    h(
      'ul',
      { class: 'privacy-points' },
      ...[0, 1, 2].map((i) => h('li', null, t(`import.privacyPoints.${String(i)}`))),
    ),
    h('label', { for: 'bill-text', class: 'field-label' }, t('import.pasteLabel')),
    h('p', { id: 'bill-text-hint', class: 'muted' }, t('import.pasteHint')),
    textarea,
    h('div', { class: 'actions' }, submit),
    hint,
    h(
      'div',
      { class: 'sample-box' },
      h('div', { class: 'actions' }, sample),
      h('p', { class: 'muted' }, t('import.sampleNote')),
    ),
  );
};
