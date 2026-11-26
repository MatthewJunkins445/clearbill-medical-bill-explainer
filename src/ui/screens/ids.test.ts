import { describe, expect, it } from 'vitest';
import { createIdSource } from './ids.ts';

describe('createIdSource', () => {
  it('gives every call a different id with the prefix', () => {
    const next = createIdSource('fill-hint');
    const ids = [next(), next(), next()];
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^fill-hint-\d+$/);
  });
  it('keeps separate sources independent', () => {
    expect(createIdSource('a')()).toBe(createIdSource('a')());
  });
});
