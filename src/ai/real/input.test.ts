import { describe, expect, it } from 'vitest';
import { fixtures } from '../mock/fixtures.ts';
import { detectBillKind, validateBillText } from './input.ts';

describe('detectBillKind', () => {
  it.each(fixtures.filter((fixture) => fixture.kind !== 'not_medical').map((fixture) => [fixture.id, fixture.kind, fixture.text]))(
    'classifies the %s fixture as %s',
    (_id, kind, text) => {
      expect(detectBillKind(text)).toBe(kind);
    },
  );

  it('defaults to an itemized bill', () => {
    expect(detectBillKind('Hospital charges for patient visit')).toBe('itemized_bill');
  });
});

describe('validateBillText', () => {
  const code = (fn: () => void): string | undefined => {
    try {
      fn();
      return undefined;
    } catch (e) {
      return (e as { code?: string }).code;
    }
  };

  it('rejects empty or whitespace text as unsupported', () => {
    expect(code(() => { validateBillText('', 100); })).toBe('UNSUPPORTED_INPUT');
    expect(code(() => { validateBillText(' \n\t ', 100); })).toBe('UNSUPPORTED_INPUT');
  });

  it('rejects text over the limit, and a single line over it, before the bill check', () => {
    expect(code(() => { validateBillText('hospital\n'.repeat(20), 100); })).toBe('INPUT_TOO_LONG');
    expect(code(() => { validateBillText('x'.repeat(101), 100); })).toBe('INPUT_TOO_LONG');
  });

  it('rejects text with no medical wording as not a bill', () => {
    expect(code(() => { validateBillText('Electric utility statement, amount due 40.00', 100); })).toBe('NOT_A_BILL');
  });

  it('accepts bill-like text', () => {
    expect(code(() => { validateBillText('Patient: A. Person, hospital visit', 100); })).toBeUndefined();
  });
});
