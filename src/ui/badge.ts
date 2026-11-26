import type { ResultSource } from '../ai/index.ts';
import { t } from './copy.ts';
import { h, svg } from './dom.ts';

export type BadgeKind = ResultSource | 'pending';

const ICON_ATTRS = {
  viewBox: '0 0 16 16',
  width: 16,
  height: 16,
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.5,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
  focusable: 'false',
} as const;

// Three different outlines so the badges stay distinct without colour (design/badges.md).
function icon(kind: BadgeKind): SVGElement {
  switch (kind) {
    case 'ON_DEVICE': // laptop
      return svg(
        'svg',
        ICON_ATTRS,
        svg('rect', { x: 3, y: 3, width: 10, height: 7, rx: 1 }),
        svg('path', { d: 'M1.5 13h13' }),
      );
    case 'IN_CLOUD': // cloud with an up arrow
      return svg(
        'svg',
        ICON_ATTRS,
        svg('path', { d: 'M4.5 12.5a3 3 0 0 1-.3-5.98 4 4 0 0 1 7.6 1A2.5 2.5 0 0 1 11.5 12.5' }),
        svg('path', { d: 'M8 13V8.5M6.2 10.2 8 8.5l1.8 1.7' }),
      );
    case 'LOCAL_RULES': // checklist
      return svg('svg', ICON_ATTRS, svg('path', { d: 'M2 4h6M2 8h6M2 12h4M10 10.5l1.5 1.5 3-3.5' }));
    case 'pending': // three dots
      return svg(
        'svg',
        { ...ICON_ATTRS, fill: 'currentColor', stroke: 'none' },
        svg('circle', { cx: 3, cy: 8, r: 1.5 }),
        svg('circle', { cx: 8, cy: 8, r: 1.5 }),
        svg('circle', { cx: 13, cy: 8, r: 1.5 }),
      );
  }
}

/** Where a result was made: icon plus visible text, with a longer hidden label for screen readers. */
export function badge(kind: BadgeKind): HTMLElement {
  return h(
    'span',
    { class: `badge badge-${kind}` },
    icon(kind),
    h('span', { class: 'badge-label' }, t(`badges.${kind}.label`)),
    h('span', { class: 'sr-only' }, ' ' + t(`badges.${kind}.srLabel`)),
  );
}
