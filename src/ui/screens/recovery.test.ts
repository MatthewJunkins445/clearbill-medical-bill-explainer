import { describe, expect, it } from 'vitest';
import { AI_ERROR_CODES } from '../../ai/index.ts';
import { recoveryActions } from './recovery.ts';

describe('recoveryActions', () => {
  it('sends NOT_A_BILL and UNSUPPORTED_INPUT back to import with the different-bill label', () => {
    for (const code of ['NOT_A_BILL', 'UNSUPPORTED_INPUT'] as const) {
      expect(recoveryActions(code)).toEqual([
        { kind: 'differentBill', labelKey: 'specialStates.notABill.primaryAction' },
      ]);
    }
  });
  it('sends INPUT_TOO_LONG to the editable text', () => {
    expect(recoveryActions('INPUT_TOO_LONG')).toEqual([
      { kind: 'edit', labelKey: 'errors.INPUT_TOO_LONG.primaryAction' },
    ]);
  });
  it('sends a missing model to setup, and a failed check to reload', () => {
    expect(recoveryActions('DEVICE_MODEL_NOT_READY')[0]).toEqual({
      kind: 'setup',
      labelKey: 'errors.DEVICE_MODEL_NOT_READY.primaryAction',
    });
    expect(recoveryActions('APP_CHECK_FAILED')[0]?.kind).toBe('reload');
  });
  it('offers start over next to retry for UNKNOWN', () => {
    expect(recoveryActions('UNKNOWN').map((a) => a.kind)).toEqual(['retry', 'startOver']);
  });
  it('gives every code at least one action', () => {
    for (const code of AI_ERROR_CODES) expect(recoveryActions(code).length).toBeGreaterThan(0);
  });
});

describe('recoveryActions for results screens', () => {
  it('sends CONSENT_REQUIRED back to the consent step', () => {
    expect(recoveryActions('CONSENT_REQUIRED')[0]).toEqual({
      kind: 'consent',
      labelKey: 'errors.CONSENT_REQUIRED.primaryAction',
    });
  });
});
