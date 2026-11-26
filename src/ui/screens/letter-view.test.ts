import { describe, expect, it } from 'vitest';
import { countPlaceholders, defaultKind } from './letter-view.ts';

describe('countPlaceholders', () => {
  it('counts labels like [ACCOUNT_NUMBER_1]', () => {
    expect(countPlaceholders('Account: [ACCOUNT_NUMBER_1] for [PATIENT_NAME_2] and [ACCOUNT_NUMBER_1]')).toBe(
      3,
    );
  });
  it('ignores ordinary brackets and plain text', () => {
    expect(countPlaceholders('see [note] and [1] and PATIENT_NAME_1')).toBe(0);
    expect(countPlaceholders('')).toBe(0);
  });
});

describe('defaultKind', () => {
  it('asks for an itemized bill when no flag was chosen, else questions the charges', () => {
    expect(defaultKind(0)).toBe('itemized');
    expect(defaultKind(2)).toBe('dispute');
  });
});
