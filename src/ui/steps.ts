import { t } from './copy.ts';
import type { ResultsTab, Session } from './state.ts';

/** The step bar, in order. Matches the `steps.*` keys in design/copy.json. */
export const BAR_KEYS = [
  'import',
  'model',
  'review',
  'consent',
  'explain',
  'questions',
  'audit',
  'letter',
] as const;
export type BarKey = (typeof BAR_KEYS)[number];

export type BarStatus = 'completed' | 'current' | 'upcoming' | 'open';
export interface BarItem {
  readonly key: BarKey;
  readonly status: BarStatus;
}

type Where = Pick<Session, 'step' | 'tab'>;

/**
 * Ruling: `working` (removing details) belongs to the "Set up" item, since it follows the device
 * check and finishes into Check details; `results` shows the item of the active results tab.
 */
export function barKeyFor(s: Where): BarKey {
  switch (s.step) {
    case 'working':
      return 'model';
    case 'results':
      return s.tab;
    default:
      return s.step;
  }
}

const TABS: readonly BarKey[] = ['explain', 'questions', 'audit', 'letter'] satisfies readonly ResultsTab[];

export function barItems(s: Where): readonly BarItem[] {
  const current = BAR_KEYS.indexOf(barKeyFor(s));
  return BAR_KEYS.map((key, i): BarItem => {
    if (i === current) return { key, status: 'current' };
    // Results tabs are all reachable from each other once the user is in the results area.
    if (s.step === 'results' && TABS.includes(key)) return { key, status: 'open' };
    return { key, status: i < current ? 'completed' : 'upcoming' };
  });
}

/** The visible title of the step; also the `h1` text and the start of `document.title`. */
export function stepTitle(s: Where): string {
  return s.step === 'working' ? t('redacting.title') : t(`steps.${barKeyFor(s)}`);
}
