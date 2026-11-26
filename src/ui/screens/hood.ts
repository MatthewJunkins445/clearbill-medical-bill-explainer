// S13: Under the hood. A non-modal `aside` that lists, from the live session, where each step ran (step, where it
// ran, model, mode, time, fallback), the device model state, the cloud model, the consent state and whether the cloud
// features are paused. app.ts owns the toggle; this builds the panel and repaints it from the session.
import type { ClearBillAI, DeviceModelState } from '../../ai/index.ts';
import { t } from '../copy.ts';
import { h } from '../dom.ts';
import type { Session } from '../state.ts';
import { cloudModelOf, hoodRow, killSwitchPaused } from './hood-view.ts';

export interface HoodPanel {
  readonly el: HTMLElement;
  readonly heading: HTMLElement;
  /** Repaints the status and the call list from the session. */
  update(session: Session): void;
  /** Asks the AI for the current device model state (called when the panel opens). */
  refreshDevice(): void;
  /** Stops the live device-status subscription. */
  dispose(): void;
}

const COLUMNS = ['step', 'mode', 'source', 'model', 'latency'] as const;

function statusRow(label: string, value: string): HTMLElement[] {
  return [h('dt', null, label), h('dd', null, value)];
}

export function buildHoodPanel(ai: ClearBillAI, onClose: () => void): HoodPanel {
  const heading = h('h2', { id: 'hood-title', tabindex: '-1' }, t('underTheHood.title'));
  const status = h('dl', { class: 'hood-status' });
  const calls = h('div', { class: 'hood-calls' });
  const callsTitle = h('h3', { id: 'hood-calls-title' });
  let session: Session | null = null;
  let device: DeviceModelState | null = null;

  function paintStatus(s: Session): void {
    let paused = false;
    try {
      paused = killSwitchPaused(ai.getCloudAvailability('sample'));
    } catch {
      // Unknown: shown as On, which is what an app without a pause switch would say.
    }
    const none = '—';
    status.replaceChildren(
      ...statusRow(t('underTheHood.deviceModelLabel'), t('underTheHood.deviceModelValue')),
      ...statusRow(
        t('underTheHood.deviceStateLabel'),
        device === null ? none : t(`underTheHood.deviceStateValues.${device}`),
      ),
      ...statusRow(t('underTheHood.cloudModelLabel'), cloudModelOf(s.log) ?? none),
      ...statusRow(t('underTheHood.consentLabel'), t(`underTheHood.consentValues.${s.consent}`)),
      ...statusRow(
        t('underTheHood.killSwitchLabel'),
        t(`underTheHood.killSwitchValues.${paused ? 'off' : 'on'}`),
      ),
    );
  }

  function paintCalls(s: Session): void {
    callsTitle.textContent = `${t('underTheHood.callsSection')}: ${String(s.log.length)}`;
    if (s.log.length === 0) {
      calls.replaceChildren(h('p', { class: 'muted' }, t('underTheHood.callsEmpty')));
      return;
    }
    const rows = s.log.map((entry) => {
      const row = hoodRow(entry);
      return h(
        'tr',
        null,
        h('td', null, row.step),
        h('td', null, row.mode),
        h(
          'td',
          null,
          row.source,
          row.fellBack
            ? h('span', { class: 'hood-fellback' }, ' (' + t('underTheHood.fellBackValue') + ')')
            : null,
        ),
        h('td', null, row.model),
        h('td', null, row.latency),
      );
    });
    calls.replaceChildren(
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'hood-table', 'aria-labelledby': 'hood-calls-title' },
          h(
            'thead',
            null,
            h('tr', null, ...COLUMNS.map((c) => h('th', { scope: 'col' }, t(`underTheHood.columns.${c}`)))),
          ),
          h('tbody', null, ...rows),
        ),
      ),
    );
  }

  const el = h(
    'aside',
    { id: 'under-the-hood', class: 'hood', 'aria-labelledby': 'hood-title', hidden: true },
    heading,
    h('p', null, t('underTheHood.intro')),
    h('h3', { id: 'hood-device-title' }, t('underTheHood.deviceSection')),
    status,
    callsTitle,
    calls,
    h('p', { class: 'muted' }, t('underTheHood.rawNeverSent')),
    h(
      'button',
      {
        type: 'button',
        class: 'btn',
        onClick: () => {
          onClose();
        },
      },
      t('app.close'),
    ),
  );
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') onClose();
  });

  // Live device state while the panel exists: downloads and re-checks repaint it without reopening.
  const unsubscribeDevice = ai.subscribeDeviceStatus((next) => {
    device = next.state;
    if (session) paintStatus(session);
  });

  function update(next: Session): void {
    session = next;
    paintStatus(next);
    paintCalls(next);
  }

  return {
    el,
    heading,
    update,
    dispose: unsubscribeDevice,
    refreshDevice: () => {
      ai.getDeviceStatus().then(
        (s) => {
          device = s.state;
          if (session) paintStatus(session);
        },
        () => {
          // The state stays as it was.
        },
      );
    },
  };
}
