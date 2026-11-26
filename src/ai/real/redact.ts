import type { RedactionEntity, RedactionValue, TextRange } from '../contract.ts';
import { findOccurrences, lockedCategories, redactionEntities } from '../mock/redaction.ts';

function renumber(groups: Iterable<Omit<RedactionEntity, 'id'>>): readonly RedactionEntity[] {
  return Object.freeze([...groups].map((entity, index) => Object.freeze({ ...entity, id: String(index + 1) })));
}

/** Model-found values to entities: identical (category, value) pairs grouped, every occurrence located. */
export function entitiesFromValues(text: string, values: readonly RedactionValue[]): readonly RedactionEntity[] {
  const groups = new Map<string, Omit<RedactionEntity, 'id'>>();
  for (const { category, value } of values) {
    const key = category + '\0' + value;
    if (groups.has(key) || !value.trim()) continue;
    const occurrences = findOccurrences(text, value);
    if (occurrences.length === 0) continue;
    groups.set(key, {
      category, value, occurrences: Object.freeze(occurrences.map((range) => Object.freeze(range))),
      selected: true, locked: lockedCategories.has(category),
    });
  }
  return renumber(groups.values());
}

/**
 * Rules-only path. Deliberately passes no fixture ground truth, so it is conservative: every phone number
 * it recognises is redacted, including a facility's.
 */
export function rulesEntities(text: string): readonly RedactionEntity[] {
  return redactionEntities(text, undefined, false);
}

/** Dedupes by (category, value), unions occurrences, keeps the first side's order, and renumbers ids. */
export function mergeEntities(a: readonly RedactionEntity[], b: readonly RedactionEntity[]): readonly RedactionEntity[] {
  const groups = new Map<string, Omit<RedactionEntity, 'id'>>();
  for (const { category, value, occurrences, selected, locked } of [...a, ...b]) {
    const key = category + '\0' + value;
    const previous = groups.get(key);
    const spans: TextRange[] = [...(previous?.occurrences ?? [])];
    for (const span of occurrences) {
      if (!spans.some(({ start, end }) => start === span.start && end === span.end)) spans.push(span);
    }
    spans.sort((x, y) => x.start - y.start);
    groups.set(key, {
      category, value, occurrences: Object.freeze(spans),
      selected: (previous?.selected ?? false) || selected, locked: (previous?.locked ?? false) || locked,
    });
  }
  return renumber(groups.values());
}
