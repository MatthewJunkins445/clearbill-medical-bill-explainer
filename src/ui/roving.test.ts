import { describe, expect, it } from 'vitest';
import { nextIndex } from './roving.ts';

const groups = ['a', 'a', 'b', 'c', 'c'];

describe('nextIndex', () => {
  it('moves by one and stops at the ends', () => {
    expect(nextIndex(1, 5, 'ArrowDown')).toBe(2);
    expect(nextIndex(4, 5, 'ArrowDown')).toBe(4);
    expect(nextIndex(1, 5, 'ArrowUp')).toBe(0);
    expect(nextIndex(0, 5, 'ArrowUp')).toBe(0);
  });

  it('jumps to the first and last item', () => {
    expect(nextIndex(3, 5, 'Home')).toBe(0);
    expect(nextIndex(1, 5, 'End')).toBe(4);
  });

  it('jumps to the first item of the next or previous group', () => {
    expect(nextIndex(0, 5, 'PageDown', groups)).toBe(2);
    expect(nextIndex(2, 5, 'PageDown', groups)).toBe(3);
    expect(nextIndex(4, 5, 'PageDown', groups)).toBe(3);
    expect(nextIndex(4, 5, 'PageUp', groups)).toBe(2);
    expect(nextIndex(1, 5, 'PageUp', groups)).toBe(0);
  });

  it('ignores page keys without groups, other keys, and an invalid current index', () => {
    expect(nextIndex(1, 5, 'PageDown')).toBeNull();
    expect(nextIndex(1, 5, 'Enter')).toBeNull();
    expect(nextIndex(-1, 5, 'ArrowDown')).toBeNull();
    expect(nextIndex(0, 0, 'ArrowDown')).toBeNull();
  });
});
