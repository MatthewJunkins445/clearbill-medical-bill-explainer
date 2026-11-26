// S03: device model setup. Renders the panel for the current DeviceModelState. The download starts
// only when the user presses "Download model"; nothing on this screen advances by itself.
import { ClearBillAIError, type DeviceModelState, type DeviceStatus } from '../../ai/index.ts';
import type { Screen } from '../context.ts';
import { t } from '../copy.ts';
import { h } from '../dom.ts';
import { goTo } from '../state.ts';
import { downloadPercent, failurePlan, panelSpec, type ModelAction } from './model-panel.ts';

type Focus = 'heading' | 'primary' | 'none';

/** Button label: `rules` is worded differently in each state that offers it. */
function actionLabel(state: DeviceModelState, action: ModelAction): string {
  switch (action) {
    case 'continue':
      return t('deviceModel.states.available.primaryAction');
    case 'download':
      return t('deviceModel.states.downloadable.primaryAction');
    case 'recheck':
      return t('deviceModel.states.unavailable.secondaryAction');
    case 'requirements':
      return t('deviceModel.states.unsupported.secondaryAction');
    case 'rules':
      if (state === 'downloadable') return t('deviceModel.states.downloadable.secondaryAction');
      if (state === 'downloading') return t('deviceModel.states.downloading.secondaryAction');
      return t(`deviceModel.states.${state === 'unsupported' ? 'unsupported' : 'unavailable'}.primaryAction`);
  }
}

function progressText(percent: number | null): string {
  if (percent === null) return t('deviceModel.states.downloading.bodyIndeterminate');
  if (percent === 100) return t('deviceModel.states.downloading.bodyFinalizing');
  return t('deviceModel.states.downloading.bodyProgress', { percent });
}

export const modelScreen: Screen = (ctx) => {
  const panel = h('div', { class: 'panel' }, h('p', { class: 'muted' }, t('deviceModel.checking')));
  let disposed = false;
  let current: DeviceStatus | null = null;
  let requirementsOpen = false;
  let downloadStarted = false;
  let lastBucket = -1;
  let focusNext: Focus | null = null;
  let bar: HTMLProgressElement | null = null;
  let barText: HTMLElement | null = null;

  ctx.onDispose(() => {
    disposed = true;
  });

  /** `duringDownload` is true only for a failed prepareDeviceModel after the user clicked Download. */
  function fail(error: unknown, duringDownload: boolean): void {
    if (disposed) return;
    const plan = failurePlan({ downloadStarted: duringDownload, hasStatus: current !== null });
    if (duringDownload) downloadStarted = false;
    ctx.showError(
      error instanceof ClearBillAIError ? error.code : 'UNKNOWN',
      plan.retry === 'download' ? download : recheck,
    );
    // With no known state, show the unavailable panel (simple rules, Check again) so the user is never stuck.
    if (plan.fallbackPanel) current = { state: 'unavailable', checkedAt: 0 };
    if (current) render(current, 'none');
  }

  const failCheck = (error: unknown): void => {
    fail(error, false);
  };
  const failDownload = (error: unknown): void => {
    fail(error, true);
  };

  function recheck(): void {
    panel.replaceChildren(h('p', { class: 'muted' }, t('deviceModel.checking')));
    focusNext = 'heading';
    ctx.ai.getDeviceStatus().then(apply, failCheck);
  }

  /** Runs only from the button's click handler, so the user's click is the gesture. */
  function download(): void {
    downloadStarted = true;
    ctx.ai.prepareDeviceModel().then(apply, failDownload);
    if (current) render(current, 'heading');
  }

  const toWorking = (): void => {
    ctx.update((s) => goTo(s, 'working'));
  };
  const handlers: Record<ModelAction, () => void> = {
    download,
    rules: toWorking,
    continue: toWorking,
    recheck,
    requirements: () => {
      requirementsOpen = !requirementsOpen;
      if (current) render(current, 'none');
    },
  };

  function progressBlock(status: DeviceStatus): HTMLElement {
    bar = h('progress', {
      class: 'progress',
      'aria-label': t('deviceModel.states.downloading.progressLabel'),
      max: 100,
    });
    barText = h('p', null);
    paintProgress(status);
    return h('div', null, bar, barText);
  }

  /** Updates the bar in place so focus on the button beside it survives every progress tick. */
  function paintProgress(status: DeviceStatus): void {
    if (!bar || !barText) return;
    const percent = downloadPercent(status.progress);
    barText.textContent = progressText(percent);
    if (percent === null) {
      bar.removeAttribute('value');
    } else {
      bar.value = percent;
      const bucket = Math.floor(percent / 25);
      if (bucket > lastBucket) {
        lastBucket = bucket;
        ctx.announce(t('deviceModel.states.downloading.srProgressUpdate', { percent }));
      }
    }
  }

  function render(status: DeviceStatus, focus: Focus): void {
    const { state } = status;
    const spec = panelSpec(state);
    const key = `deviceModel.states.${state}`;
    const heading = h('h2', { tabindex: '-1' }, t(`${key}.title`));
    const button = (action: ModelAction, primary: boolean, describedBy?: string): HTMLButtonElement =>
      h(
        'button',
        {
          type: 'button',
          class: primary ? 'btn btn-primary' : 'btn',
          'aria-describedby': describedBy,
          'aria-expanded': action === 'requirements' ? String(requirementsOpen) : undefined,
          disabled: action === 'download' && downloadStarted,
          onClick: handlers[action],
        },
        actionLabel(state, action),
      );
    const primary = spec.primary
      ? button(spec.primary, true)
      : state === 'downloading' && !downloadStarted && status.progress === undefined
        ? h('button', { type: 'button', class: 'btn btn-primary', onClick: download },
            t('deviceModel.states.downloading.trackAction'))
        : null;
    const secondary = spec.secondary
      ? button(spec.secondary, false, spec.hint ? 'secondary-hint' : undefined)
      : null;
    bar = null;
    barText = null;
    panel.replaceChildren(
      h('span', { class: 'chip' }, t(`${key}.badge`)),
      heading,
      h('p', null, t('deviceModel.whatItIs')),
      state === 'downloading' ? progressBlock(status) : h('p', null, t(`${key}.body`)),
      h('div', { class: 'actions' }, ...[primary, secondary].filter((b) => b !== null)),
      ...(spec.hint ? [h('p', { id: 'secondary-hint', class: 'muted' }, t(`${key}.secondaryHint`))] : []),
      ...(spec.secondary === 'requirements' && requirementsOpen
        ? [h('p', null, t('deviceModel.states.unsupported.requirements'))]
        : []),
    );
    if (focus === 'primary') (primary ?? heading).focus();
    else if (focus === 'heading') heading.focus();
  }

  function apply(status: DeviceStatus): void {
    if (disposed || (current && status.checkedAt < current.checkedAt)) return;
    const previous = current;
    current = status;
    if (status.state !== 'downloading') lastBucket = -1;
    if (previous?.state === 'downloading' && status.state === 'downloading') {
      paintProgress(status);
      return;
    }
    const changed = previous !== null && previous.state !== status.state;
    const focus = focusNext ?? (changed ? 'heading' : 'none');
    focusNext = null;
    if (changed && status.state === 'available') {
      ctx.announce(t('deviceModel.states.available.srAnnounce'));
      render(status, 'primary');
    } else {
      render(status, focus);
    }
  }

  ctx.onDispose(ctx.ai.subscribeDeviceStatus(apply));
  ctx.ai.getDeviceStatus().then(apply, failCheck);

  return h(
    'section',
    { class: 'screen' },
    h('h1', null, t('steps.model')),
    h('p', { class: 'muted' }, t('deviceModel.panelTitle')),
    panel,
  );
};
