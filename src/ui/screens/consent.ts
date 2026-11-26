// S06: what stays on this computer and what may leave it. Nothing cloud-capable runs before this screen's
// decision; the checkbox starts unticked and declining is a full button (design/wireframes/s06.md).
import type { RedactionApproval, RedactionDraft } from '../../ai/index.ts';
import { badge } from '../badge.ts';
import type { AppContext, Screen } from '../context.ts';
import { t, tList } from '../copy.ts';
import { h } from '../dom.ts';
import { goTo, setConsent, withApproval, withTab, type ConsentState } from '../state.ts';
import { stepTitle } from '../steps.ts';
import { consentChoices } from './consent-view.ts';
import { errorCodeOf, redirectScreen } from './results-common.ts';

const TERMS_URL = 'https://aistudio.google.com/docs/terms#data-use-unpaid';

const statusKey: Partial<Record<ConsentState, string>> = {
  agreed: 'consent.statusAgreed',
  declined: 'consent.statusDeclined',
  withdrawn: 'consent.withdrawDone',
};

const list = (key: string): HTMLElement => h('ul', null, ...tList(key).map((item) => h('li', null, item)));

function buildConsent(ctx: AppContext, draft: RedactionDraft): HTMLElement {
  const start = ctx.getSession();
  const choices = consentChoices(ctx.ai.getCloudAvailability(draft.provenance));

  const approve = (consentToCloud: boolean): RedactionApproval => {
    const s = ctx.getSession();
    return ctx.ai.approveRedaction(draft, { added: s.added, removedIds: s.keptIds, consentToCloud });
  };

  // A stored approval is shown as it is. After a visit to Review there is none: preview one, without storing it.
  let redactedText: string;
  try {
    redactedText = (start.approval ?? approve(false)).bill.redactedText;
  } catch {
    ctx.showError('UNKNOWN');
    return h('section', { class: 'screen' }, h('h1', null, stepTitle(start)), backButton(ctx));
  }

  function decide(agree: boolean): void {
    try {
      const approval = approve(agree);
      // setConsent first: it drops any approval, withApproval then stores the fresh one.
      ctx.update((s) =>
        withTab(
          goTo(withApproval(setConsent(s, agree ? 'agreed' : 'declined'), approval), 'results'),
          'explain',
        ),
      );
    } catch (error) {
      ctx.showError(errorCodeOf(error), () => {
        decide(agree);
      });
    }
  }

  function withdraw(): void {
    try {
      const approval = approve(false);
      ctx.update((s) => withApproval(setConsent(s, 'withdrawn'), approval));
      ctx.announce(t('consent.withdrawDone'));
    } catch (error) {
      ctx.showError(errorCodeOf(error), withdraw);
    }
  }

  // The exact text, viewable on demand (a disclosure that starts closed).
  const textRegion = h(
    'div',
    {
      class: 'preview-text',
      id: 'consent-text',
      role: 'region',
      tabindex: 0,
      'aria-label': t('consent.viewText'),
      hidden: true,
    },
    redactedText,
  );
  const viewToggle = h(
    'button',
    {
      type: 'button',
      class: 'btn',
      'aria-expanded': 'false',
      'aria-controls': 'consent-text',
      onClick: () => {
        const open = textRegion.hidden;
        textRegion.hidden = !open;
        viewToggle.setAttribute('aria-expanded', String(open));
        viewToggle.textContent = t(open ? 'consent.hideText' : 'consent.viewText');
      },
    },
    t('consent.viewText'),
  );

  // Status line and "Stop sending" for when the user comes back here with an earlier choice.
  const status = h('p', { class: 'muted', id: 'consent-status' });
  const withdrawButton = h(
    'button',
    { type: 'button', class: 'btn', onClick: withdraw },
    t('consent.withdraw'),
  );
  const paintStatus = (): void => {
    const s = ctx.getSession();
    const key = statusKey[s.consent];
    status.textContent = key ? t(key) : '';
    status.hidden = !key;
    withdrawButton.hidden = s.consent !== 'agreed';
  };

  const declineHint = h('p', { class: 'muted', id: 'decline-hint' }, t('consent.declineHint'));
  void ctx.ai.getDeviceStatus().then(
    ({ state }) => {
      if (!ctx.signal.aborted && state !== 'available')
        declineHint.textContent = t('consent.declineNoDevice');
    },
    () => undefined,
  );
  const declineButton = h(
    'button',
    {
      type: 'button',
      class: choices.offerAgree ? 'btn' : 'btn btn-primary',
      'aria-describedby': 'decline-hint',
      onClick: () => {
        decide(false);
      },
    },
    t('consent.declineButton'),
  );

  let cloudSection: HTMLElement | null = null;
  let decision: HTMLElement;
  if (choices.offerAgree) {
    const checkbox = h('input', {
      type: 'checkbox',
      id: 'consent-agree',
      'aria-describedby': 'consent-not-perfect consent-kept',
    });
    const agreeHint = h('p', { class: 'muted', id: 'agree-hint' }, t('consent.agreeButtonDisabledHint'));
    const agreeButton = h(
      'button',
      {
        type: 'button',
        class: 'btn btn-primary',
        'aria-disabled': 'true',
        'aria-describedby': 'agree-hint',
        onClick: () => {
          if (!checkbox.checked) {
            agreeHint.hidden = false;
            checkbox.focus();
            return;
          }
          decide(true);
        },
      },
      t('consent.agreeButton'),
    );
    checkbox.addEventListener('change', () => {
      agreeButton.setAttribute('aria-disabled', String(!checkbox.checked));
      agreeHint.hidden = checkbox.checked;
    });
    cloudSection = h(
      'section',
      { class: 'panel', 'aria-labelledby': 'leaves-title' },
      h('h2', { id: 'leaves-title' }, t('consent.leavesTitle')),
      list('consent.leavesItems'),
      h('p', null, t('consent.leavesWhere')),
      h('p', null, t('consent.leavesSize', { characters: redactedText.length })),
    );
    decision = h(
      'section',
      { class: 'panel consent-card', 'aria-labelledby': 'decision-title' },
      h('h2', { id: 'decision-title' }, t('consent.title')),
      h('p', { id: 'consent-kept' }, t('consent.keptOnPurpose')),
      h('p', { id: 'consent-not-perfect' }, t('consent.notPerfect')),
      h('p', null, t('consent.notStored')),
      h(
        'p',
        null,
        h('a', { href: TERMS_URL, target: '_blank', rel: 'noopener noreferrer' }, t('consent.termsLink')),
      ),
      h(
        'div',
        { class: 'check-row' },
        checkbox,
        h('label', { for: 'consent-agree' }, t('consent.agreeLabel')),
      ),
      agreeHint,
      h('div', { class: 'actions' }, agreeButton, declineButton),
      declineHint,
    );
  } else {
    decision = h(
      'section',
      { class: 'panel consent-card', 'aria-labelledby': 'decision-title' },
      h('h2', { id: 'decision-title' }, t('consent.title')),
      h('p', { class: 'notice', role: 'note' }, t(choices.noticeKey ?? 'specialStates.cloudSampleOnly.body')),
      h('p', null, t('consent.notPerfect')),
      h('div', { class: 'actions' }, declineButton),
      declineHint,
    );
  }

  const dom = h(
    'section',
    { class: 'screen consent' },
    h('h1', null, stepTitle(start)),
    draft.provenance === 'sample' ? h('p', { class: 'chip' }, t('import.sampleLabel')) : null,
    h('p', null, t('consent.intro')),
    start.draftSource === 'LOCAL_RULES'
      ? h('p', { class: 'muted' }, t('specialStates.rulesOnly.reviewNudge'))
      : null,
    h(
      'section',
      { class: 'panel', 'aria-labelledby': 'stays-title' },
      h('h2', { id: 'stays-title' }, t('consent.staysTitle')),
      list('consent.staysItems'),
      badge('ON_DEVICE'),
    ),
    cloudSection,
    h('div', { class: 'actions' }, viewToggle),
    textRegion,
    decision,
    h('p', { class: 'muted' }, t('consent.scope')),
    status,
    h('div', { class: 'actions' }, withdrawButton),
    h(
      'details',
      { class: 'disclaimer' },
      h('summary', null, t('disclaimers.short')),
      h('p', null, t('disclaimers.full')),
    ),
    backButton(ctx),
  );
  paintStatus();
  ctx.subscribe(paintStatus);
  return dom;
}

function backButton(ctx: AppContext): HTMLElement {
  return h(
    'div',
    { class: 'actions' },
    h(
      'button',
      {
        type: 'button',
        class: 'btn',
        onClick: () => {
          ctx.update((s) => goTo(s, 'review'));
        },
      },
      t('app.back'),
    ),
  );
}

export const consentScreen: Screen = (ctx) => {
  const { draft } = ctx.getSession();
  return draft ? buildConsent(ctx, draft) : redirectScreen(ctx, 'import');
};
