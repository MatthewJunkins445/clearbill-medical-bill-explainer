import type { AIErrorCode, AIResult, ClearBillAI } from '../ai/index.ts';
import type { AppContext } from './context.ts';
import { t } from './copy.ts';
import { h } from './dom.ts';
import { createEmitter, createEpoch, createScope, type Scope } from './lifetime.ts';
import { buildHoodPanel } from './screens/hood.ts';
import { screens } from './screens/index.ts';
import { buildFooter, buildStartOverConfirm, buildStepBar } from './shell.ts';
import { goTo, logResult, newSession, startOver, type ResultsTab, type Session } from './state.ts';
import { stepTitle, type BarKey } from './steps.ts';

export interface MountOptions {
  /** The AI could not be created: show the generic error but still render the shell. */
  readonly startupError?: boolean;
}

const TABS: readonly BarKey[] = ['explain', 'questions', 'audit', 'letter'];

export function mountApp(root: HTMLElement, ai: ClearBillAI, options: MountOptions = {}): void {
  let session: Session = newSession();
  // Advanced on every Start over: a late result from before it must not land in the new session's log.
  const epoch = createEpoch();
  const changes = createEmitter<Session>();
  let scope: Scope = createScope();
  let ctx: AppContext = makeContext(scope);

  const status = h('div', { role: 'status', class: 'live' });
  const alert = h('div', { role: 'alert', class: 'live live-alert' });
  const main = h('main', { id: 'main', tabindex: '-1' });
  let nav = buildStepBar(session, go);

  let hoodOpen = false;
  const hood = buildHoodPanel(ai, () => {
    setHood(false, true);
  });
  const hoodToggle = h('button', {
    type: 'button',
    class: 'btn',
    'aria-expanded': 'false',
    'aria-controls': 'under-the-hood',
    onClick: () => {
      setHood(!hoodOpen, true);
    },
  });
  const startOverButton = h(
    'button',
    {
      type: 'button',
      class: 'btn',
      onClick: () => {
        confirmPanel.open();
      },
    },
    t('app.startOver'),
  );
  const confirmPanel = buildStartOverConfirm(
    () => {
      confirmPanel.close();
      const notify = changes.capture();
      epoch.advance();
      session = startOver();
      render(true);
      notify(session);
    },
    () => {
      confirmPanel.close();
      startOverButton.focus();
    },
  );

  const skip = h('a', { class: 'skip-link', href: '#main' }, t('app.skipLink'));
  skip.addEventListener('click', (event) => {
    event.preventDefault();
    focusHeading();
  });

  const header = h(
    'header',
    { class: 'site-header' },
    h(
      'div',
      { class: 'header-row' },
      h('p', { class: 'app-name' }, t('app.name')),
      h('div', { class: 'header-actions' }, hoodToggle, startOverButton),
    ),
    confirmPanel.el,
    nav,
  );

  let announceTimer: ReturnType<typeof setTimeout> | undefined;
  function announce(msg: string): void {
    clearTimeout(announceTimer);
    status.textContent = '';
    // A short delay makes screen readers announce the same text again.
    announceTimer = setTimeout(() => (status.textContent = msg), 50);
  }

  function clearError(): void {
    alert.replaceChildren();
  }

  function showError(code: AIErrorCode, retry?: () => void): void {
    const retryButton = retry
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onClick: () => {
              clearError();
              retry();
            },
          },
          t('app.retry'),
        )
      : null;
    alert.replaceChildren(
      h('strong', null, t(`errors.${code}.title`)),
      h('p', null, t(`errors.${code}.body`)),
    );
    if (retryButton) alert.append(retryButton);
  }

  function setHood(open: boolean, moveFocus: boolean): void {
    hoodOpen = open;
    hood.el.hidden = !open;
    hoodToggle.setAttribute('aria-expanded', String(open));
    hoodToggle.textContent = open ? t('underTheHood.toggleClose') : t('underTheHood.toggleOpen');
    if (open) hood.refreshDevice();
    if (!moveFocus) return;
    if (open) hood.heading.focus();
    else hoodToggle.focus();
  }

  function focusHeading(): void {
    (main.querySelector<HTMLElement>('h1') ?? main).focus();
  }

  function renderBar(): void {
    const next = buildStepBar(session, go);
    nav.replaceWith(next);
    nav = next;
  }

  /** Renders the screen for the current step. Focus moves to its h1 unless this is the first render. */
  function render(moveFocus: boolean): void {
    clearError();
    scope.dispose();
    scope = createScope();
    ctx = makeContext(scope);
    main.replaceChildren(screens[session.step](ctx));
    const heading = main.querySelector('h1');
    heading?.setAttribute('tabindex', '-1');
    document.title = `${heading?.textContent ?? stepTitle(session)} · ${t('app.name')}`;
    renderBar();
    if (moveFocus) focusHeading();
  }

  /** The screen is re-rendered only when the step or results tab changes, so typing is never lost. */
  function setSession(next: Session): void {
    const changed = next.step !== session.step || next.tab !== session.tab;
    // A log that got shorter means a new session (Start over from an error card goes through update()).
    if (next.log.length < session.log.length) epoch.advance();
    const notify = changes.capture();
    session = next;
    if (changed) render(true);
    else renderBar();
    notify(session);
  }

  function go(key: BarKey): void {
    if (TABS.includes(key)) {
      setSession({ ...goTo(session, 'results'), tab: key as ResultsTab });
    } else {
      setSession(goTo(session, key as Session['step']));
    }
  }

  /** A fresh context per rendered screen. Once its scope is disposed, its calls are ignored. */
  function makeContext(own: Scope): AppContext {
    const born = epoch.current;
    const live =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A): void => {
        if (own.active) fn(...args);
      };
    return {
      ai,
      signal: own.signal,
      onDispose: (fn) => {
        own.onDispose(fn);
      },
      getSession: () => session,
      update: live((fn: (s: Session) => Session) => {
        setSession(fn(session));
      }),
      subscribe: (listener) => {
        if (!own.active) return () => undefined;
        const off = changes.subscribe(listener);
        own.onDispose(off);
        return off;
      },
      announce: live(announce),
      showError: live(showError),
      // A call that happened is a fact the user must be able to see, so unlike the other calls, record() still
      // works after this screen is gone, as long as the session it belongs to is still the current one.
      record: (step: string, result: AIResult<unknown>) => {
        if (!epoch.isCurrent(born)) return;
        setSession(
          logResult(session, {
            at: Date.now(),
            step,
            source: result.source,
            model: result.model,
            mode: result.mode,
            latencyMs: result.latencyMs,
            fellBack: result.fellBack,
          }),
        );
      },
    };
  }

  setHood(false, false);
  root.replaceChildren(
    skip,
    header,
    h('div', { class: 'alert-region' }, alert),
    h('div', { class: 'layout' }, main, hood.el),
    buildFooter(),
    h('div', { class: 'live-regions' }, status),
  );
  changes.subscribe((s) => {
    hood.update(s);
  });
  hood.update(session);
  if (import.meta.env.VITE_AI_MODE === 'mock' && !import.meta.env.PROD) {
    // Test hook (mock mode only): the context of the screen that is rendered now.
    (window as unknown as Record<string, unknown>)['__clearbill'] = { current: () => ctx };
  }
  render(false);
  if (options.startupError) showError('UNKNOWN');
}
