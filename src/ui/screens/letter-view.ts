// Pure helpers for the Letter tab.
import type { LetterKind } from '../../ai/index.ts';

const PLACEHOLDER = /\[[A-Z][A-Z_]*_\d+\]/g;

/** How many labels like [ACCOUNT_NUMBER_1] are still in the text. */
export function countPlaceholders(text: string): number {
  return text.match(PLACEHOLDER)?.length ?? 0;
}

/** Without chosen flags there is nothing specific to question, so the letter asks for an itemized bill. */
export function defaultKind(selectedCount: number): LetterKind {
  return selectedCount > 0 ? 'dispute' : 'itemized';
}
