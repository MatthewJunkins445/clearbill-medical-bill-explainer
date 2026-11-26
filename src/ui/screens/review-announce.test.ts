import { describe, expect, it } from 'vitest';
import { spoken, toggleAnnouncement } from './review-announce.ts';

describe('spoken', () => {
  it('turns a label into words', () => {
    expect(spoken('[PATIENT_NAME_1]')).toBe('patient name 1');
    expect(spoken('[DOB_2]')).toBe('date of birth 2');
  });
  it('leaves anything else as it is', () => {
    expect(spoken('Dr. Lee')).toBe('Dr. Lee');
    expect(spoken('[NOPE_1]')).toBe('[NOPE_1]');
  });
});

describe('toggleAnnouncement', () => {
  const base = { category: 'PROVIDER_NAME', original: 'Dr. Lee', locked: false } as const;

  it('says a kept detail stays in the text', () => {
    const msg = toggleAnnouncement({
      ...base,
      nowKept: true,
      placeholderBefore: '[PROVIDER_NAME_1]',
      placeholderAfter: undefined,
    });
    expect(msg).toBe('[PROVIDER_NAME_1] will stay in the text as "Dr. Lee".');
  });

  it('says a removed detail is replaced by its label', () => {
    const msg = toggleAnnouncement({
      ...base,
      nowKept: false,
      placeholderBefore: undefined,
      placeholderAfter: '[PROVIDER_NAME_1]',
    });
    expect(msg).toBe('Dr. Lee will be replaced with [PROVIDER_NAME_1].');
  });

  it('warns that a kept always-removed detail is still removed', () => {
    const msg = toggleAnnouncement({
      category: 'ACCOUNT_NUMBER',
      original: 'NV1',
      locked: true,
      nowKept: true,
      placeholderBefore: '[ACCOUNT_NUMBER_1]',
      placeholderAfter: '[ACCOUNT_NUMBER_1]',
    });
    expect(msg).toContain('the final check removes it');
    expect(msg).toContain('account number 1');
  });

  it('falls back to the category when no label is known, with no braces left over', () => {
    const msg = toggleAnnouncement({
      ...base,
      nowKept: false,
      placeholderBefore: undefined,
      placeholderAfter: undefined,
    });
    expect(msg).not.toContain('{');
  });
});
