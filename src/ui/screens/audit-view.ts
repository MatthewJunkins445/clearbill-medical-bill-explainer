// Pure helpers for the Things to check tab, and the per-approval choice of flags that the Letter tab reads.
import type { ApprovedBill, AuditFlag } from '../../ai/index.ts';

/** Likely errors first; the order within a severity is kept. */
export function sortFlags(flags: readonly AuditFlag[]): AuditFlag[] {
  const rank = (f: AuditFlag): number => (f.severity === 'likely_error' ? 0 : 1);
  return [...flags].sort((a, b) => rank(a) - rank(b));
}

export function countSeverities(flags: readonly AuditFlag[]): { likely: number; asking: number } {
  const likely = flags.filter((f) => f.severity === 'likely_error').length;
  return { likely, asking: flags.length - likely };
}

/** Line indexes are zero-based (like `LineExplanation.lineIndex`); people count from one. */
export function formatLines(indexes: readonly number[]): string {
  return indexes.map((i) => String(i + 1)).join(', ');
}

interface Choice {
  flags: readonly AuditFlag[];
  ids: ReadonlySet<string>;
}

// A new approval is a new object, so a changed choice or a revisited Review never sees an old selection.
// Only flag ids are kept here: they are titles from the redacted text, not the user's details.
const choices = new WeakMap<ApprovedBill, Choice>();

/** Remembers the flags of the audit for this approval (the selection starts empty). */
export function setFlags(bill: ApprovedBill, flags: readonly AuditFlag[]): void {
  choices.set(bill, { flags, ids: new Set() });
}

export function getFlags(bill: ApprovedBill): readonly AuditFlag[] {
  return choices.get(bill)?.flags ?? [];
}

export function isSelected(bill: ApprovedBill, id: string): boolean {
  return choices.get(bill)?.ids.has(id) ?? false;
}

/** Flips one flag; returns whether it is now selected. Ids that are not flags of this bill are ignored. */
export function toggleFlag(bill: ApprovedBill, id: string): boolean {
  const choice = choices.get(bill);
  if (!choice?.flags.some((f) => f.id === id)) return false;
  const now = !choice.ids.has(id);
  if (now) (choice.ids as Set<string>).add(id);
  else (choice.ids as Set<string>).delete(id);
  return now;
}

/** The flags the user ticked, in flag order. Empty when the user never visited the audit. */
export function selectedFlags(bill: ApprovedBill): AuditFlag[] {
  const choice = choices.get(bill);
  return choice ? choice.flags.filter((f) => choice.ids.has(f.id)) : [];
}
