import { describe, expect, it } from 'vitest';
import type { AppliedRedaction, RedactionEntity } from '../ai/index.ts';
import { addedEntities, afterRemovalEntities, placeholderMap, segmentPreview } from './highlight.ts';

function entity(
  id: string,
  value: string,
  occurrences: [number, number][],
  extra: Partial<RedactionEntity> = {},
): RedactionEntity {
  return {
    id,
    category: 'PATIENT_NAME',
    value,
    occurrences: occurrences.map(([start, end]) => ({ start, end })),
    selected: true,
    locked: false,
    ...extra,
  };
}

const text = 'Anna met Bo. Anna paid.';

describe('segmentPreview', () => {
  it('returns one plain segment when there are no entities', () => {
    expect(segmentPreview(text, [], [])).toEqual([{ text, entityId: null, kept: false }]);
  });

  it('returns nothing for empty text', () => {
    expect(segmentPreview('', [entity('1', 'x', [[0, 1]])], [])).toEqual([]);
  });

  it('covers the whole text exactly and tags one segment per occurrence', () => {
    const anna = entity('1', 'Anna', [
      [0, 4],
      [13, 17],
    ]);
    const segments = segmentPreview(text, [anna], []);
    expect(segments.map((s) => s.text).join('')).toBe(text);
    const tagged = segments.filter((s) => s.entityId === '1');
    expect(tagged.map((s) => s.text)).toEqual(['Anna', 'Anna']);
    expect(segments.filter((s) => s.entityId === null).map((s) => s.text)).toEqual([' met Bo. ', ' paid.']);
  });

  it('marks kept entities as kept and the others as not kept', () => {
    const anna = entity('1', 'Anna', [[0, 4]]);
    const bo = entity('2', 'Bo', [[9, 11]]);
    const segments = segmentPreview(text, [anna, bo], ['2']);
    expect(segments.find((s) => s.entityId === '1')?.kept).toBe(false);
    expect(segments.find((s) => s.entityId === '2')?.kept).toBe(true);
    expect(segments.filter((s) => s.entityId === null).every((s) => !s.kept)).toBe(true);
  });

  it('does not duplicate characters when occurrences overlap', () => {
    const a = entity('1', 'Anna met', [[0, 8]]);
    const b = entity('2', 'met Bo', [[5, 11]]);
    const segments = segmentPreview(text, [b, a], []);
    expect(segments.map((s) => s.text).join('')).toBe(text);
    expect(segments.filter((s) => s.entityId !== null).map((s) => s.text)).toEqual(['Anna met', ' Bo']);
  });

  it('treats an occurrence inside another one as already covered, and ignores out-of-range ones', () => {
    const outer = entity('1', 'Anna met Bo', [[0, 11]]);
    const inner = entity('2', 'met', [[5, 8]]);
    const outside = entity('3', 'zzz', [[100, 110]]);
    const segments = segmentPreview(text, [inner, outer, outside], []);
    expect(segments.map((s) => s.text).join('')).toBe(text);
    expect(segments.filter((s) => s.entityId !== null)).toEqual([
      { text: 'Anna met Bo', entityId: '1', kept: false },
    ]);
  });
});

describe('addedEntities', () => {
  it('finds every occurrence of an added detail in the text and ignores empty values', () => {
    const found = addedEntities(text, [
      { category: 'PERSON_NAME', value: 'Anna' },
      { category: 'PERSON_NAME', value: '' },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: 'added:0', category: 'PERSON_NAME', locked: false });
    expect(found[0]?.occurrences).toEqual([
      { start: 0, end: 4 },
      { start: 13, end: 17 },
    ]);
  });
});

describe('placeholderMap and afterRemovalEntities', () => {
  // "Anna met Bo. Anna paid." with Anna redacted to [PATIENT_NAME_1] and Bo kept.
  const redactedText = '[PATIENT_NAME_1] met Bo. [PATIENT_NAME_1] paid.';
  const applied: AppliedRedaction[] = [
    {
      category: 'PATIENT_NAME',
      placeholder: '[PATIENT_NAME_1]',
      sourceRange: { start: 0, end: 4 },
      redactedRange: { start: 0, end: 16 },
    },
    {
      category: 'PATIENT_NAME',
      placeholder: '[PATIENT_NAME_1]',
      sourceRange: { start: 13, end: 17 },
      redactedRange: { start: 25, end: 41 },
    },
  ];
  const anna = entity('1', 'Anna', [
    [0, 4],
    [13, 17],
  ]);
  const bo = entity('2', 'Bo', [[9, 11]], { category: 'PERSON_NAME' });

  it('maps each redacted entity to its placeholder', () => {
    const map = placeholderMap([anna, bo], applied);
    expect(map.get('1')).toBe('[PATIENT_NAME_1]');
    expect(map.has('2')).toBe(false);
  });

  it('builds segments over the redacted text, with kept originals tagged too', () => {
    const entities = afterRemovalEntities(text, [anna, bo], ['2'], applied);
    const segments = segmentPreview(redactedText, entities, ['2']);
    expect(segments.map((s) => s.text).join('')).toBe(redactedText);
    expect(segments.filter((s) => s.entityId === '1').map((s) => s.text)).toEqual([
      '[PATIENT_NAME_1]',
      '[PATIENT_NAME_1]',
    ]);
    expect(segments.find((s) => s.entityId === '2')).toEqual({ text: 'Bo', entityId: '2', kept: true });
  });

  it('tags a redaction that no entity explains (guard or manual) with a synthetic id', () => {
    const entities = afterRemovalEntities(text, [bo], ['2'], applied);
    const segments = segmentPreview(redactedText, entities, ['2']);
    const tagged = segments.filter((s) => s.entityId !== null && s.entityId !== '2');
    expect(tagged.map((s) => s.text)).toEqual(['[PATIENT_NAME_1]', '[PATIENT_NAME_1]']);
  });
});
