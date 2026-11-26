import { describe, expect, it } from 'vitest';
import { CLOUD_BLOCK_REASONS } from '../contract.ts';
import type { CloudBlockReason } from '../contract.ts';
import { cloudAvailability, gateError } from './gate.ts';

type Input = Parameters<typeof cloudAvailability>[0];
const open: Input = { killSwitch: false, regionAllowed: true, cloudReady: true, provenance: 'sample', consent: true };

// Each reason is triggered by breaking exactly one condition.
const breakers: Record<CloudBlockReason, Partial<Input>> = {
  kill_switch: { killSwitch: true },
  region: { regionAllowed: false },
  user_bill: { provenance: 'user' },
  no_consent: { consent: false },
};

describe('cloudAvailability', () => {
  it('allows a consented sample when everything is open', () => {
    expect(cloudAvailability(open)).toEqual({ allowed: true });
  });

  it('blocks a pasted copy of the sample (user provenance) even with everything open', () => {
    expect(cloudAvailability({ ...open, provenance: 'user' })).toEqual({ allowed: false, reason: 'user_bill' });
  });

  it('asks for consent when the sample has none', () => {
    expect(cloudAvailability({ ...open, consent: false })).toEqual({ allowed: false, reason: 'no_consent' });
    expect(cloudAvailability({ killSwitch: false, regionAllowed: true, cloudReady: true, provenance: 'sample' })).toEqual({ allowed: false, reason: 'no_consent' });
  });

  it('treats cloudReady false as region (fail closed)', () => {
    expect(cloudAvailability({ ...open, cloudReady: false })).toEqual({ allowed: false, reason: 'region' });
  });

  for (const first of CLOUD_BLOCK_REASONS) {
    it(`reports ${first} alone`, () => {
      expect(cloudAvailability({ ...open, ...breakers[first] })).toEqual({ allowed: false, reason: first });
    });
    CLOUD_BLOCK_REASONS.forEach((second, index) => {
      if (CLOUD_BLOCK_REASONS.indexOf(first) >= index) return;
      it(`${first} wins over ${second}`, () => {
        const both = { ...open, ...breakers[first], ...breakers[second] };
        expect(cloudAvailability(both)).toEqual({ allowed: false, reason: first });
      });
    });
  }

  it('region wins over user_bill even when cloudReady is the cause', () => {
    expect(cloudAvailability({ ...open, cloudReady: false, provenance: 'user', consent: false }))
      .toEqual({ allowed: false, reason: 'region' });
  });
});

describe('gateError', () => {
  it.each([
    ['kill_switch', 'KILL_SWITCH'],
    ['no_consent', 'CONSENT_REQUIRED'],
    ['region', 'CLOUD_NOT_ALLOWED'],
    ['user_bill', 'CLOUD_NOT_ALLOWED'],
  ] as const)('maps %s to %s (not retryable, reason kept)', (reason, code) => {
    const error = gateError(reason);
    expect(error.name).toBe('ClearBillAIError');
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(false);
    expect(error.cloudReason).toBe(reason);
  });
});
