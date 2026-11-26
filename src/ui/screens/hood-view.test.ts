import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../state.ts';
import { cloudModelOf, hoodRow, killSwitchPaused, stepLabel } from './hood-view.ts';

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  at: 0,
  step: 'explain',
  source: 'IN_CLOUD',
  model: 'gemini-x',
  mode: 'PREFER_IN_CLOUD',
  latencyMs: 412,
  fellBack: false,
  ...over,
});

describe('stepLabel', () => {
  it('uses the step names from the copy, including the redaction step', () => {
    expect(stepLabel('redaction')).toBe('Remove details');
    expect(stepLabel('explain')).toBe('Explain line');
    expect(stepLabel('audit')).toBe('Check for issues');
    expect(stepLabel('letter')).toBe('Draft letter');
    expect(stepLabel('question')).toBe('Question');
  });
  it('falls back to the raw step for an unknown one', () => {
    expect(stepLabel('mystery')).toBe('mystery');
  });
});

describe('hoodRow', () => {
  it('formats a log entry as text', () => {
    expect(hoodRow(entry())).toEqual({
      step: 'Explain line',
      source: 'In the cloud',
      model: 'gemini-x',
      mode: 'Cloud first',
      latency: '412 ms',
      fellBack: false,
    });
  });
  it('keeps the fellBack flag', () => {
    expect(hoodRow(entry({ fellBack: true, source: 'ON_DEVICE', mode: 'PREFER_ON_DEVICE' })).fellBack).toBe(
      true,
    );
  });
});

describe('cloudModelOf', () => {
  it('is the model of the latest cloud call, or null', () => {
    expect(cloudModelOf([])).toBeNull();
    expect(cloudModelOf([entry({ source: 'ON_DEVICE', model: 'nano' })])).toBeNull();
    expect(
      cloudModelOf([
        entry({ model: 'old' }),
        entry({ source: 'ON_DEVICE', model: 'nano' }),
        entry({ model: 'new' }),
      ]),
    ).toBe('new');
  });
});

describe('killSwitchPaused', () => {
  it('is paused only for the kill_switch reason', () => {
    expect(killSwitchPaused({ allowed: true })).toBe(false);
    expect(killSwitchPaused({ allowed: false, reason: 'region' })).toBe(false);
    expect(killSwitchPaused({ allowed: false, reason: 'no_consent' })).toBe(false);
    expect(killSwitchPaused({ allowed: false, reason: 'kill_switch' })).toBe(true);
  });
});
