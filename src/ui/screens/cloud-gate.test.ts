import { describe, expect, it } from 'vitest';
import { ClearBillAIError } from '../../ai/index.ts';
import { cloudGate, gateErrorCode, gateFromError, gateNoticeKey } from './cloud-gate.ts';

describe('cloudGate', () => {
  it('runs only when consent is agreed and the cloud is allowed', () => {
    expect(cloudGate('agreed', { allowed: true })).toEqual({ kind: 'run' });
  });
  it('never runs without agreed consent, even when the cloud is open', () => {
    for (const consent of ['notAsked', 'declined', 'withdrawn'] as const)
      expect(cloudGate(consent, { allowed: true })).toEqual({ kind: 'needConsent' });
  });
  it('asks for consent when the only thing missing is consent', () => {
    expect(cloudGate('declined', { allowed: false, reason: 'no_consent' })).toEqual({ kind: 'needConsent' });
    expect(cloudGate('agreed', { allowed: false, reason: 'no_consent' })).toEqual({ kind: 'needConsent' });
  });
  it('reports the current block reason whatever the consent state is', () => {
    for (const consent of ['notAsked', 'agreed', 'declined', 'withdrawn'] as const)
      for (const reason of ['kill_switch', 'region', 'user_bill'] as const)
        expect(cloudGate(consent, { allowed: false, reason })).toEqual({ kind: 'blocked', reason });
  });
});

describe('gateErrorCode', () => {
  it('maps each gate to the error copy it uses', () => {
    expect(gateErrorCode({ kind: 'needConsent' })).toBe('CONSENT_REQUIRED');
    expect(gateErrorCode({ kind: 'blocked', reason: 'kill_switch' })).toBe('KILL_SWITCH');
    expect(gateErrorCode({ kind: 'blocked', reason: 'region' })).toBe('CLOUD_NOT_ALLOWED');
    expect(gateErrorCode({ kind: 'blocked', reason: 'user_bill' })).toBe('CLOUD_NOT_ALLOWED');
  });
});

describe('gateNoticeKey', () => {
  it('adds the region and sample-only notices and nothing for the others', () => {
    expect(gateNoticeKey({ kind: 'blocked', reason: 'region' })).toBe('specialStates.regionUnavailable.body');
    expect(gateNoticeKey({ kind: 'blocked', reason: 'user_bill' })).toBe(
      'specialStates.cloudSampleOnly.body',
    );
    expect(gateNoticeKey({ kind: 'blocked', reason: 'kill_switch' })).toBeNull();
    expect(gateNoticeKey({ kind: 'needConsent' })).toBeNull();
  });
});

describe('gateFromError', () => {
  it('turns the cloud errors into the matching gate', () => {
    expect(gateFromError(new ClearBillAIError('CONSENT_REQUIRED', false, 'no_consent'))).toEqual({
      kind: 'needConsent',
    });
    expect(gateFromError(new ClearBillAIError('KILL_SWITCH', false, 'kill_switch'))).toEqual({
      kind: 'blocked',
      reason: 'kill_switch',
    });
    expect(gateFromError(new ClearBillAIError('CLOUD_NOT_ALLOWED', false, 'user_bill'))).toEqual({
      kind: 'blocked',
      reason: 'user_bill',
    });
    expect(gateFromError(new ClearBillAIError('CLOUD_NOT_ALLOWED', false, 'region'))).toEqual({
      kind: 'blocked',
      reason: 'region',
    });
  });
  it('is null for any other error', () => {
    expect(gateFromError(new ClearBillAIError('NETWORK', true))).toBeNull();
    expect(gateFromError(new Error('x'))).toBeNull();
  });
});
