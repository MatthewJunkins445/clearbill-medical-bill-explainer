import { describe, expect, it } from 'vitest';
import { formatMoney } from './explain-format.ts';

describe('formatMoney', () => {
  it('formats US dollars', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(-25)).toBe('-$25.00');
  });
  it('shows the "not shown on the bill" copy for null', () => {
    expect(formatMoney(null)).toBe('Not shown on the bill');
  });
});
