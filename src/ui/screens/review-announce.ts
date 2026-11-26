// Pure wording helpers for the review screen's polite announcements.
import { PII_CATEGORIES, type PiiCategory } from '../../ai/index.ts';
import { t } from '../copy.ts';

export const categoryLabel = (category: PiiCategory): string => t(`pii.${category}.label`);

/** "[PATIENT_NAME_1]" becomes "patient name 1" so a screen reader does not spell out the symbols. */
export function spoken(placeholder: string): string {
  const match = /^\[([A-Z_]+)_(\d+)\]$/.exec(placeholder);
  const category = PII_CATEGORIES.find((c) => c === match?.[1]);
  return match && category ? `${categoryLabel(category).toLowerCase()} ${match[2] ?? ''}` : placeholder;
}

export interface ToggleAnnounceInput {
  /** True when, after the toggle, the user is keeping the detail. */
  readonly nowKept: boolean;
  readonly locked: boolean;
  readonly category: PiiCategory;
  readonly original: string;
  /** The label before the toggle (what the kept detail stood for), if it had one. */
  readonly placeholderBefore: string | undefined;
  /** The label after the toggle, if the detail is replaced. */
  readonly placeholderAfter: string | undefined;
}

/** What the polite region says after a Keep/Remove toggle. */
export function toggleAnnouncement(input: ToggleAnnounceInput): string {
  const category = categoryLabel(input.category);
  if (input.nowKept && input.locked) {
    return t('highlight.srKeptButGuarded', { category, placeholder: spoken(input.placeholderAfter ?? '') });
  }
  if (input.nowKept) {
    return t('review.keptAnnounce', {
      placeholder: input.placeholderBefore ?? category,
      original: input.original,
    });
  }
  return t('review.removedAnnounce', {
    placeholder: input.placeholderAfter ?? category,
    original: input.original,
  });
}
