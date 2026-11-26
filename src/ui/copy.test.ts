import { describe, expect, it } from 'vitest';
import { t, tList, tn } from './copy.ts';

describe('t', () => {
  it('returns a non-empty string for a top-level key', () => {
    expect(t('app.name')).not.toBe('');
  });

  it('resolves a nested key', () => {
    expect(t('errors.NETWORK.title')).not.toBe('');
  });

  it('throws for a missing key', () => {
    expect(() => t('x.nope')).toThrow('Missing copy key: x.nope');
  });

  it('throws when the key points at a group, not a string', () => {
    expect(() => t('errors.NETWORK')).toThrow('Missing copy key: errors.NETWORK');
  });

  it('fills {name} from vars and leaves no braces', () => {
    const out = t('steps.completed', { name: 'Add bill' });
    expect(out).toBe('Add bill, done');
    expect(out).not.toContain('{');
  });

  it('fills several placeholders', () => {
    expect(t('steps.current', { n: 2, total: 5, name: 'Set up' })).toBe('Step 2 of 5: Set up');
  });
});

describe('tn', () => {
  it('uses the _one string for a count of 1', () => {
    expect(tn('review.summary', 1)).toBe('We found 1 detail to remove.');
  });

  it('uses the _other string otherwise and fills {count}', () => {
    expect(tn('review.summary', 3)).toBe('We found 3 details to remove.');
    expect(tn('review.summary', 0)).toBe('We found 0 details to remove.');
  });

  it('throws for a missing plural key', () => {
    expect(() => tn('x.nope', 2)).toThrow('Missing copy key: x.nope_other');
  });
});

describe('tList', () => {
  it('returns every string of a list key', () => {
    const items = tList('consent.staysItems');
    expect(items.length).toBeGreaterThan(1);
    for (const item of items) expect(item).not.toBe('');
  });

  it('throws for a key that is not a list of strings', () => {
    expect(() => tList('app.name')).toThrow('Missing copy key: app.name');
    expect(() => tList('x.nope')).toThrow('Missing copy key: x.nope');
  });
});
