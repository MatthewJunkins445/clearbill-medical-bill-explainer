// Pieces shared by the consent and results screens.
import { ClearBillAIError, type AIErrorCode, type ApprovedBill } from '../../ai/index.ts';
import type { AppContext } from '../context.ts';
import { t } from '../copy.ts';
import { h } from '../dom.ts';
import { goTo, type Step } from '../state.ts';
import { stepTitle } from '../steps.ts';
import { auditUnavailableKey } from './consent-view.ts';

/** The code of an error thrown by the AI layer (anything else is UNKNOWN). */
export function errorCodeOf(error: unknown): AIErrorCode {
  return error instanceof ClearBillAIError ? error.code : 'UNKNOWN';
}

/**
 * A screen that has nothing to show yet and sends the user to `step` once it is on the page. The move waits a
 * microtask because the shell cannot re-render while it is still building this screen.
 */
export function redirectScreen(ctx: AppContext, step: Step): HTMLElement {
  queueMicrotask(() => {
    ctx.update((s) => goTo(s, step));
  });
  return h(
    'section',
    { class: 'screen' },
    h('h1', null, stepTitle(ctx.getSession())),
    h('p', { class: 'muted' }, t('app.loading')),
  );
}

/** Copy key for why the cloud check is off for this approval, or null when it is on. */
export function auditReasonFor(ctx: AppContext, bill: ApprovedBill): string | null {
  try {
    return auditUnavailableKey(ctx.ai.getCloudAvailability(bill));
  } catch {
    return null;
  }
}

/** "Change my choice": back to the consent step, keeping the current approval. */
export function changeChoiceButton(ctx: AppContext): HTMLElement {
  return h(
    'button',
    {
      type: 'button',
      class: 'btn',
      onClick: () => {
        ctx.update((s) => goTo(s, 'consent'));
      },
    },
    t('consent.changeLater'),
  );
}
