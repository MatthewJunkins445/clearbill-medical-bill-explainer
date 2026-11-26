// S04: one local createRedactionDraft call. Success goes to review; errors branch as in design/flows.md.
import { ClearBillAIError, type AIErrorCode } from '../../ai/index.ts';
import { badge } from '../badge.ts';
import type { Screen } from '../context.ts';
import { t } from '../copy.ts';
import { h } from '../dom.ts';
import { goTo, withDraft } from '../state.ts';
import { recoveryCard } from './errors.ts';
import { setImportNotice } from './import.ts';

export const workingScreen: Screen = (ctx) => {
  // The screen is discarded (signal aborted) when the user leaves it; results arriving later are ignored.
  const stale = (): boolean => ctx.signal.aborted;
  const { input } = ctx.getSession();
  const body = h('p', null, t('redacting.bodyRules'));
  const stop = h('button', { type: 'button', class: 'btn' }, t('redacting.cancel'));
  const busy = h(
    'div',
    { class: 'busy' },
    badge('pending'),
    body,
    h('div', { class: 'skeleton', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
    h('div', { class: 'actions' }, stop),
  );
  const root = h(
    'section',
    { class: 'screen', 'aria-busy': 'true' },
    h('h1', null, t('redacting.title')),
    input?.kind === 'sample' ? h('p', { class: 'muted' }, t('import.sampleLabel')) : null,
    busy,
  );

  function showCard(code: AIErrorCode, retry?: () => void): void {
    root.setAttribute('aria-busy', 'false');
    busy.replaceWith(recoveryCard(ctx, code, retry));
  }

  function back(code: AIErrorCode): void {
    setImportNotice(code);
    ctx.update((s) => goTo(s, 'import'));
  }

  stop.addEventListener('click', () => {
    back('ABORTED');
  });

  async function run(): Promise<void> {
    if (!input) {
      showCard('UNKNOWN');
      return;
    }
    try {
      const { state } = await ctx.ai.getDeviceStatus();
      if (stale()) return;
      body.textContent = t(state === 'available' ? 'redacting.bodyDevice' : 'redacting.bodyRules');
      const result = await ctx.ai.createRedactionDraft(input);
      // A late result from a screen the user already left is dropped.
      if (stale()) return;
      ctx.record('redaction', result);
      ctx.update((s) => goTo(withDraft(s, result.data, result.source), 'review'));
    } catch (error) {
      if (stale()) return;
      const code = error instanceof ClearBillAIError ? error.code : 'UNKNOWN';
      if (code === 'INPUT_TOO_LONG') back(code);
      else showCard(code, retry);
    }
  }

  function retry(): void {
    root.setAttribute('aria-busy', 'true');
    root.lastElementChild?.replaceWith(busy);
    void run();
  }

  void run();
  return root;
};
