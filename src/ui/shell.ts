// Builders for the parts of the app shell that are not a screen: step bar, Start over confirmation,
// and footer (the Under the hood panel is in screens/hood.ts). app.ts wires them to the session.
import { t } from './copy.ts';
import { h } from './dom.ts';
import { barItems, BAR_KEYS, type BarKey } from './steps.ts';
import type { Session } from './state.ts';

export function buildStepBar(session: Session, go: (key: BarKey) => void): HTMLElement {
  const total = BAR_KEYS.length;
  const items = barItems(session).map((item, i) => {
    const name = t(`steps.${item.key}`);
    const label =
      item.status === 'current'
        ? t('steps.current', { n: i + 1, total, name })
        : item.status === 'completed'
          ? t('steps.completed', { name })
          : item.status === 'upcoming'
            ? t('steps.upcoming', { name })
            : name;
    // Visible text is the plain name; screen readers get the full status label instead.
    const content = [h('span', { 'aria-hidden': 'true' }, name), h('span', { class: 'sr-only' }, label)];
    if (item.status === 'completed' || item.status === 'open') {
      const link = h(
        'a',
        {
          href: `#step-${item.key}`,
          onClick: (event: Event) => {
            event.preventDefault();
            go(item.key);
          },
        },
        ...content,
      );
      return h('li', { class: `step step-${item.status}` }, link);
    }
    return h(
      'li',
      { class: `step step-${item.status}`, 'aria-current': item.status === 'current' ? 'step' : null },
      h('span', null, ...content),
    );
  });
  return h('nav', { 'aria-label': t('steps.navLabel'), class: 'step-bar' }, h('ol', null, ...items));
}

export interface ConfirmPanel {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
}

/** Inline "Start over?" confirmation (not window.confirm). Hidden until opened. */
export function buildStartOverConfirm(onYes: () => void, onNo: () => void): ConfirmPanel {
  const title = h('h2', { id: 'start-over-title', tabindex: '-1' }, t('app.startOverConfirmTitle'));
  const el = h(
    'section',
    { class: 'confirm', role: 'group', 'aria-labelledby': 'start-over-title', hidden: true },
    title,
    h('p', null, t('app.startOverConfirmBody')),
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-primary',
          onClick: () => {
            onYes();
          },
        },
        t('app.startOverConfirmYes'),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onClick: () => {
            onNo();
          },
        },
        t('app.startOverConfirmNo'),
      ),
    ),
  );
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') onNo();
  });
  return {
    el,
    open: () => {
      el.hidden = false;
      title.focus();
    },
    close: () => {
      el.hidden = true;
    },
  };
}

export function buildFooter(): HTMLElement {
  return h(
    'footer',
    { class: 'site-footer' },
    h('p', null, t('app.footerPrivacy')),
    h('p', null, t('disclaimers.short')),
  );
}
