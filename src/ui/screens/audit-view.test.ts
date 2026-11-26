import { describe, expect, it } from 'vitest';
import type { ApprovedBill, AuditFlag } from '../../ai/index.ts';
import {
  countSeverities,
  formatLines,
  getFlags,
  selectedFlags,
  setFlags,
  sortFlags,
  toggleFlag,
} from './audit-view.ts';

const flag = (id: string, severity: AuditFlag['severity'], lineIndexes: number[] = []): AuditFlag => ({
  id,
  severity,
  title: `Title ${id}`,
  why: 'why',
  ask: 'ask',
  lineIndexes,
});

describe('sortFlags', () => {
  it('puts likely errors first and keeps the order within a severity', () => {
    const sorted = sortFlags([
      flag('a', 'worth_asking'),
      flag('b', 'likely_error'),
      flag('c', 'worth_asking'),
      flag('d', 'likely_error'),
    ]);
    expect(sorted.map((f) => f.id)).toEqual(['b', 'd', 'a', 'c']);
  });
  it('does not change its input', () => {
    const input = [flag('a', 'worth_asking'), flag('b', 'likely_error')];
    sortFlags(input);
    expect(input.map((f) => f.id)).toEqual(['a', 'b']);
  });
});

describe('countSeverities', () => {
  it('counts each severity', () => {
    expect(
      countSeverities([flag('a', 'worth_asking'), flag('b', 'likely_error'), flag('c', 'worth_asking')]),
    ).toEqual({ likely: 1, asking: 2 });
    expect(countSeverities([])).toEqual({ likely: 0, asking: 0 });
  });
});

describe('formatLines', () => {
  it('shows one-based numbers, because indexes are zero-based', () => {
    expect(formatLines([0, 2, 3])).toBe('1, 3, 4');
  });
  it('is empty for no lines', () => {
    expect(formatLines([])).toBe('');
  });
});

describe('selection per approval', () => {
  const bill = {} as ApprovedBill;
  const other = {} as ApprovedBill;
  const flags = [flag('a', 'likely_error'), flag('b', 'worth_asking')];

  it('starts with nothing selected and no flags', () => {
    expect(selectedFlags(bill)).toEqual([]);
    expect(getFlags(bill)).toEqual([]);
  });
  it('toggles flags on and off, in flag order', () => {
    setFlags(bill, flags);
    expect(toggleFlag(bill, 'b')).toBe(true);
    expect(toggleFlag(bill, 'a')).toBe(true);
    expect(selectedFlags(bill).map((f) => f.id)).toEqual(['a', 'b']);
    expect(toggleFlag(bill, 'a')).toBe(false);
    expect(selectedFlags(bill).map((f) => f.id)).toEqual(['b']);
  });
  it('is separate for each approval', () => {
    expect(selectedFlags(other)).toEqual([]);
  });
  it('ignores ids that are not flags of this bill', () => {
    toggleFlag(bill, 'zzz');
    expect(selectedFlags(bill).map((f) => f.id)).toEqual(['b']);
  });
});
