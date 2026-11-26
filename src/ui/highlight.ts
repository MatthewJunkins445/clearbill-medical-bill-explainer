// Pure helpers for the review screen's preview: no DOM. Text positions are UTF-16 offsets, as in the AI contract.
import type { AppliedRedaction, RedactionEntity, RedactionValue, TextRange } from '../ai/index.ts';

export interface PreviewSegment {
  readonly text: string;
  /** The entity this segment belongs to, or null for plain text. */
  readonly entityId: string | null;
  readonly kept: boolean;
}

/**
 * Splits `text` into consecutive segments that together are exactly `text`. Every occurrence of every
 * entity becomes one tagged segment; where occurrences overlap, the earlier one wins and the later
 * one is cut back so no character appears twice.
 */
export function segmentPreview(
  text: string,
  entities: readonly RedactionEntity[],
  keptIds: readonly string[],
): PreviewSegment[] {
  const kept = new Set(keptIds);
  const spans = entities
    .flatMap((entity) => entity.occurrences.map((range) => ({ ...range, id: entity.id })))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const segments: PreviewSegment[] = [];
  let cursor = 0;
  for (const span of spans) {
    const start = Math.max(span.start, cursor);
    const end = Math.min(span.end, text.length);
    if (end <= start) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), entityId: null, kept: false });
    segments.push({ text: text.slice(start, end), entityId: span.id, kept: kept.has(span.id) });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), entityId: null, kept: false });
  return segments;
}

function findAll(text: string, value: string): TextRange[] {
  const found: TextRange[] = [];
  if (value === '') return found;
  for (let start = text.indexOf(value); start !== -1; start = text.indexOf(value, start + value.length)) {
    found.push({ start, end: start + value.length });
  }
  return found;
}

/** Number of times `value` appears in `text` (non-overlapping). */
export function countMatches(text: string, value: string): number {
  return findAll(text, value).length;
}

/** The details the user added, as entities with ids `added:<index>` so they can sit in the same list. */
export function addedEntities(text: string, added: readonly RedactionValue[]): RedactionEntity[] {
  return added.flatMap((item, i) =>
    item.value === ''
      ? []
      : [
          {
            id: `added:${String(i)}`,
            category: item.category,
            value: item.value,
            occurrences: findAll(text, item.value),
            selected: true,
            locked: false,
          },
        ],
  );
}

const overlaps = (a: TextRange, b: TextRange): boolean => a.start < b.end && b.start < a.end;

/** The entity whose occurrences overlap `range` (first match), if any. */
function owner(entities: readonly RedactionEntity[], range: TextRange): RedactionEntity | undefined {
  return entities.find((entity) => entity.occurrences.some((occurrence) => overlaps(occurrence, range)));
}

/** For each entity that was replaced by a label, the label (for example "[PATIENT_NAME_1]"). */
export function placeholderMap(
  entities: readonly RedactionEntity[],
  applied: readonly AppliedRedaction[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of applied) {
    const match = owner(entities, item.sourceRange);
    if (match && !map.has(match.id)) map.set(match.id, item.placeholder);
  }
  return map;
}

/**
 * Entities whose occurrences are positions in the text AFTER removal, for `segmentPreview` over the
 * redacted text: each applied label belongs to the entity it replaced (or to a synthetic `guard:<n>`
 * entity when none explains it), and kept details that stayed in the text keep their original words.
 */
export function afterRemovalEntities(
  text: string,
  entities: readonly RedactionEntity[],
  keptIds: readonly string[],
  applied: readonly AppliedRedaction[],
): RedactionEntity[] {
  const ranges = new Map<string, TextRange[]>();
  const synthetic: RedactionEntity[] = [];
  const push = (id: string, range: TextRange): void => {
    ranges.set(id, [...(ranges.get(id) ?? []), range]);
  };
  applied.forEach((item, i) => {
    const match = owner(entities, item.sourceRange);
    if (match) {
      push(match.id, item.redactedRange);
      return;
    }
    const id = `guard:${String(i)}`;
    synthetic.push({
      id,
      category: item.category,
      value: text.slice(item.sourceRange.start, item.sourceRange.end),
      occurrences: [item.redactedRange],
      selected: true,
      locked: true,
    });
  });
  // A position in the original text moves by the length change of every label before it.
  const shiftAt = (position: number): number => {
    const before = applied.filter((item) => item.sourceRange.end <= position).at(-1);
    return before ? before.redactedRange.end - before.sourceRange.end : 0;
  };
  const kept = new Set(keptIds);
  for (const entity of entities) {
    if (!kept.has(entity.id) || entity.locked) continue;
    for (const occurrence of entity.occurrences) {
      if (applied.some((item) => overlaps(item.sourceRange, occurrence))) continue;
      const shift = shiftAt(occurrence.start);
      push(entity.id, { start: occurrence.start + shift, end: occurrence.end + shift });
    }
  }
  const real = entities.flatMap((entity) => {
    const own = ranges.get(entity.id);
    return own ? [{ ...entity, occurrences: own }] : [];
  });
  return [...real, ...synthetic];
}
