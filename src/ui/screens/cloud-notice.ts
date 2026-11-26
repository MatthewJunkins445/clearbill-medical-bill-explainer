// The card shown instead of a cloud-only result (Things to check, Letter) when the cloud is not available for this
// approval: no consent, the kill switch, the region or a non-sample bill. It never makes a cloud call.
import type { ApprovedBill, CloudAvailability } from '../../ai/index.ts';
import type { AppContext } from '../context.ts';
import { t } from '../copy.ts';
import { h } from '../dom.ts';
import { goTo, withTab } from '../state.ts';
import { errorCard, recoveryCard, type ErrorAction } from './errors.ts';
import {
  cloudGate,
  gateErrorCode,
  gateFromError,
  gateNoticeKey,
  type CloudGate,
  type ClosedGate,
} from './cloud-gate.ts';
import { errorCodeOf } from './results-common.ts';

export type CloudTab = 'audit' | 'letter';

export function cloudNoticeCard(ctx: AppContext, gate: ClosedGate, tab: CloudTab): HTMLElement {
  const code = gateErrorCode(gate);
  const toExplain: ErrorAction = {
    label:
      gate.kind === 'needConsent'
        ? t('errors.CONSENT_REQUIRED.secondaryAction')
        : t(`errors.${code}.primaryAction`),
    run: () => {
      ctx.update((s) => withTab(s, 'explain'));
    },
  };
  const actions: ErrorAction[] =
    gate.kind === 'needConsent'
      ? [
          {
            label: t('errors.CONSENT_REQUIRED.primaryAction'),
            run: () => {
              ctx.update((s) => goTo(s, 'consent'));
            },
          },
          toExplain,
        ]
      : [toExplain];
  const noticeKey = gateNoticeKey(gate);
  const killSwitchKey = gate.kind === 'blocked' && gate.reason === 'kill_switch';
  return h(
    'div',
    { class: 'cloud-notice' },
    errorCard(code, actions),
    noticeKey === null ? null : h('p', { class: 'notice' }, t(noticeKey)),
    killSwitchKey ? h('p', { class: 'notice' }, t(`specialStates.killSwitch.${tab}Card`)) : null,
  );
}

/** The gate for this approval right now: the AI is called only for `run`. */
export function currentGate(ctx: AppContext, bill: ApprovedBill): CloudGate {
  let availability: CloudAvailability;
  try {
    availability = ctx.ai.getCloudAvailability(bill);
  } catch {
    // Cannot tell: assume the cloud is not open, so nothing is sent.
    availability = { allowed: false, reason: 'no_consent' };
  }
  return cloudGate(ctx.getSession().consent, availability);
}

/** The card for an error thrown by a cloud-only call: a gate notice when the cloud closed, else the recovery card. */
export function cloudErrorCard(
  ctx: AppContext,
  error: unknown,
  tab: CloudTab,
  retry: () => void,
): HTMLElement {
  const gate = gateFromError(error);
  return gate ? cloudNoticeCard(ctx, gate, tab) : recoveryCard(ctx, errorCodeOf(error), retry);
}
