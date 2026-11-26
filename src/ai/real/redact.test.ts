import { describe, expect, it } from 'vitest';
import { PII_CATEGORIES } from '../contract.ts';
import type { RedactionEntity } from '../contract.ts';
import { applyReview } from '../mock/redaction.ts';
import { SAMPLE_TEXTS } from '../samples.ts';
import { entitiesFromValues, mergeEntities, rulesEntities } from './redact.ts';

const sample = SAMPLE_TEXTS['itemized-er-laceration'];
const noReview = { added: [], removedIds: [], consentToCloud: false } as const;

describe('entitiesFromValues', () => {
  const text = 'Jane Roe saw Dr. Smith. Call 555-123-4567. Jane Roe again. jane@x.org';

  it('groups identical pairs with all occurrences, ids in first-occurrence order', () => {
    const entities = entitiesFromValues(text, [
      { category: 'PATIENT_NAME', value: 'Jane Roe' },
      { category: 'PROVIDER_NAME', value: 'Dr. Smith' },
      { category: 'PATIENT_NAME', value: 'Jane Roe' },
    ]);
    expect(entities).toHaveLength(2);
    const second = text.indexOf('Jane Roe', 1);
    expect(entities[0]).toMatchObject({ id: '1', category: 'PATIENT_NAME', value: 'Jane Roe', selected: true, locked: false });
    expect(entities[0]?.occurrences).toEqual([{ start: 0, end: 8 }, { start: second, end: second + 8 }]);
    expect(entities[1]).toMatchObject({ id: '2', category: 'PROVIDER_NAME', value: 'Dr. Smith' });
    expect(entities[1]?.occurrences).toEqual([{ start: 13, end: 22 }]);
  });

  it('keeps the same value in different categories as separate entities', () => {
    const entities = entitiesFromValues('A1', [{ category: 'OTHER_ID', value: 'A1' }, { category: 'ACCOUNT_NUMBER', value: 'A1' }]);
    expect(entities.map((e) => e.id)).toEqual(['1', '2']);
  });

  it('locks only the six guarded categories', () => {
    const letters = 'abcdefghijklm';
    const values = PII_CATEGORIES.map((category, i) => ({ category, value: letters.charAt(i) }));
    const all = entitiesFromValues(letters, values);
    expect(all).toHaveLength(PII_CATEGORIES.length);
    expect(all.filter((e) => e.locked).map((e) => e.category).sort())
      .toEqual(['ACCOUNT_NUMBER', 'DOB', 'EMAIL', 'MEMBER_ID', 'PHONE', 'SSN']);
  });

  it('skips values not in the text and empty or whitespace-only values', () => {
    expect(entitiesFromValues(text, [
      { category: 'PATIENT_NAME', value: 'Nobody' },
      { category: 'PATIENT_NAME', value: '' },
      { category: 'PATIENT_NAME', value: '   ' },
    ])).toEqual([]);
  });
});

describe('rulesEntities on the sample bill', () => {
  const entities = rulesEntities(sample);
  const values = (category: string): string[] => entities.filter((e) => e.category === category).map((e) => e.value);

  it('finds the guarded identifiers and locks them', () => {
    expect(values('ACCOUNT_NUMBER')).toContain('NV81995635');
    expect(values('MEMBER_ID')).toContain('PMH563466991');
    expect(values('DOB')).toContain('03/14/1961');
    expect(values('EMAIL')).toEqual(expect.arrayContaining(['billing@example.org', 'b.fizzlewick@example.com']));
    expect(values('PHONE')).toContain('(330) 555-0170');
    for (const category of ['ACCOUNT_NUMBER', 'MEMBER_ID', 'DOB', 'EMAIL', 'PHONE']) {
      expect(entities.filter((e) => e.category === category).every((e) => e.locked && e.selected)).toBe(true);
    }
  });

  it('is conservative: the facility phone is also found (no ground-truth exemption)', () => {
    expect(values('PHONE')).toContain('(330) 555-0110');
  });

  it('groups the repeated account number into one entity with every occurrence', () => {
    expect(entities.find((e) => e.value === 'NV81995635')?.occurrences).toHaveLength(2);
  });

  it('assigns sequential string ids', () => {
    expect(entities.map((e) => e.id)).toEqual(entities.map((_, i) => String(i + 1)));
  });

  it('round trip: applyReview removes every value rulesEntities returned', () => {
    const { text } = applyReview(sample, entities, noReview);
    for (const { value } of entities) expect(text).not.toContain(value);
    expect(text).toContain('[ACCOUNT_NUMBER_1]');
  });
});

describe('mergeEntities', () => {
  it('dedupes by (category, value), keeps first-side order, and renumbers ids', () => {
    const text = 'Jane Roe 555-123-4567 Jane Roe';
    const model = entitiesFromValues(text, [{ category: 'PATIENT_NAME', value: 'Jane Roe' }, { category: 'PHONE', value: '555-123-4567' }]);
    const merged = mergeEntities(model, rulesEntities(text));
    expect(merged.map((e) => [e.id, e.category, e.value])).toEqual([['1', 'PATIENT_NAME', 'Jane Roe'], ['2', 'PHONE', '555-123-4567']]);
    expect(merged[1]?.locked).toBe(true);
  });

  it('keeps entities unique to either side and unions occurrence spans without duplicates', () => {
    const a: RedactionEntity = { id: '7', category: 'PERSON_NAME', value: 'Bo', occurrences: [{ start: 0, end: 2 }], selected: true, locked: false };
    const b: RedactionEntity = { id: '9', category: 'PERSON_NAME', value: 'Bo', occurrences: [{ start: 0, end: 2 }, { start: 5, end: 7 }], selected: true, locked: false };
    const c: RedactionEntity = { id: '3', category: 'SSN', value: '123-45-6789', occurrences: [{ start: 9, end: 20 }], selected: true, locked: true };
    const merged = mergeEntities([a], [b, c]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ id: '1', occurrences: [{ start: 0, end: 2 }, { start: 5, end: 7 }] });
    expect(merged[1]).toMatchObject({ id: '2', category: 'SSN', locked: true });
  });
});
