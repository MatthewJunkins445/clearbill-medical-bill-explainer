import { describe, expect, it } from 'vitest';
import { auditUnavailableKey, consentChoices } from './consent-view.ts';

describe('consentChoices', () => {
  it('offers the cloud choice when cloud is allowed', () => {
    expect(consentChoices({ allowed: true })).toEqual({ offerAgree: true, noticeKey: null });
  });
  it('maps each blocking reason to its notice and never offers agree', () => {
    expect(consentChoices({ allowed: false, reason: 'kill_switch' })).toEqual({
      offerAgree: false,
      noticeKey: 'specialStates.killSwitch.bannerBody',
    });
    expect(consentChoices({ allowed: false, reason: 'region' })).toEqual({
      offerAgree: false,
      noticeKey: 'specialStates.regionUnavailable.body',
    });
    expect(consentChoices({ allowed: false, reason: 'user_bill' })).toEqual({
      offerAgree: false,
      noticeKey: 'specialStates.cloudSampleOnly.body',
    });
  });
  it('treats no_consent as still askable (consent is what this screen collects)', () => {
    expect(consentChoices({ allowed: false, reason: 'no_consent' })).toEqual({
      offerAgree: true,
      noticeKey: null,
    });
  });
});

describe('auditUnavailableKey', () => {
  it('is null when cloud is allowed', () => {
    expect(auditUnavailableKey({ allowed: true })).toBeNull();
  });
  it('explains each reason', () => {
    expect(auditUnavailableKey({ allowed: false, reason: 'no_consent' })).toBe('explain.auditOffDeclined');
    expect(auditUnavailableKey({ allowed: false, reason: 'kill_switch' })).toBe('explain.auditOffKillSwitch');
    expect(auditUnavailableKey({ allowed: false, reason: 'region' })).toBe(
      'specialStates.regionUnavailable.body',
    );
    expect(auditUnavailableKey({ allowed: false, reason: 'user_bill' })).toBe(
      'specialStates.cloudSampleOnly.body',
    );
  });
});
