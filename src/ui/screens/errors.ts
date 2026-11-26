// Inline error card (S12 pattern): never a modal, never a dead end, focus moves to its heading.
import type { AIErrorCode } from '../../ai/index.ts';
import type { AppContext } from '../context.ts';
import { t } from '../copy.ts';
import { h } from '../dom.ts';
import { goTo, startOver, withoutInput } from '../state.ts';
import { recoveryActions } from './recovery.ts';

export interface ErrorAction {
  readonly label: string;
  readonly run: () => void;
}

/** An alert with the title and body of `errors.<code>`, one button per action and the technical code. */
export function errorCard(code: AIErrorCode, actions: readonly ErrorAction[]): HTMLElement {
  const heading = h('h2', { tabindex: '-1' }, t(`errors.${code}.title`));
  const card = h(
    'section',
    { class: 'error-card', role: 'alert' },
    heading,
    h('p', null, t(`errors.${code}.body`)),
    actions.length > 0
      ? h(
          'div',
          { class: 'actions' },
          ...actions.map((action, i) =>
            h(
              'button',
              {
                type: 'button',
                class: i === 0 ? 'btn btn-primary' : 'btn',
                onClick: () => {
                  action.run();
                },
              },
              action.label,
            ),
          ),
        )
      : null,
    h(
      'details',
      { class: 'error-details' },
      h('summary', null, t('errors.detailsToggle')),
      h('p', null, t('errors.detailsCode', { code })),
    ),
  );
  // Runs after the screen is attached and the shell has moved focus to the h1.
  queueMicrotask(() => {
    heading.focus();
  });
  return card;
}

/** The card for an error that happened on this screen, with the recovery actions from `recoveryActions`. */
export function recoveryCard(ctx: AppContext, code: AIErrorCode, retry?: () => void): HTMLElement {
  const actions: ErrorAction[] = [];
  for (const { kind, labelKey } of recoveryActions(code)) {
    const label = t(labelKey);
    switch (kind) {
      case 'retry':
        if (retry) actions.push({ label, run: retry });
        break;
      case 'differentBill':
        actions.push({
          label,
          run: () => {
            ctx.update(withoutInput);
          },
        });
        break;
      case 'edit':
        actions.push({
          label,
          run: () => {
            ctx.update((s) => goTo(s, 'import'));
          },
        });
        break;
      case 'setup':
        actions.push({
          label,
          run: () => {
            ctx.update((s) => goTo(s, 'model'));
          },
        });
        break;
      case 'consent':
        actions.push({
          label,
          run: () => {
            ctx.update((s) => goTo(s, 'consent'));
          },
        });
        break;
      case 'reload':
        actions.push({
          label,
          run: () => {
            location.reload();
          },
        });
        break;
      case 'startOver':
        actions.push({
          label,
          run: () => {
            ctx.update(() => startOver());
          },
        });
        break;
    }
  }
  return errorCard(code, actions);
}
