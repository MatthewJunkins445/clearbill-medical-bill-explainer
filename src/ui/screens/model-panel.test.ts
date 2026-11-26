import { describe, expect, it } from 'vitest';
import { DEVICE_MODEL_STATES } from '../../ai/index.ts';
import { downloadPercent, failurePlan, panelSpec } from './model-panel.ts';

describe('panelSpec', () => {
  it('offers rules or requirements when the model is unsupported', () => {
    expect(panelSpec('unsupported')).toEqual({ primary: 'rules', secondary: 'requirements', hint: false });
  });
  it('offers rules or a re-check when the model is unavailable', () => {
    expect(panelSpec('unavailable')).toEqual({ primary: 'rules', secondary: 'recheck', hint: false });
  });
  it('offers the download only as an explicit choice', () => {
    expect(panelSpec('downloadable')).toEqual({ primary: 'download', secondary: 'rules', hint: true });
  });
  it('has no primary action while downloading', () => {
    expect(panelSpec('downloading')).toEqual({ primary: null, secondary: 'rules', hint: true });
  });
  it('lets the user continue when the model is available', () => {
    expect(panelSpec('available')).toEqual({ primary: 'continue', secondary: null, hint: false });
  });
  it('never starts a download from any state except through the download action', () => {
    for (const state of DEVICE_MODEL_STATES) {
      const spec = panelSpec(state);
      expect(spec.secondary === 'download').toBe(false);
      expect(spec.primary === 'download').toBe(state === 'downloadable');
    }
  });
});

describe('downloadPercent', () => {
  it('is null when progress is unknown', () => {
    expect(downloadPercent(undefined)).toBeNull();
    expect(downloadPercent(Number.NaN)).toBeNull();
  });
  it('rounds and clamps to 0-100', () => {
    expect(downloadPercent(0.256)).toBe(26);
    expect(downloadPercent(0.999)).toBe(99);
    expect(downloadPercent(-1)).toBe(0);
    expect(downloadPercent(7)).toBe(100);
  });
});

describe('failurePlan', () => {
  it('re-checks (never downloads) when a status check fails with no known state, and shows the fallback panel', () => {
    expect(failurePlan({ downloadStarted: false, hasStatus: false })).toEqual({
      retry: 'recheck',
      fallbackPanel: true,
    });
  });
  it('re-checks when a status check fails and a state is already known', () => {
    expect(failurePlan({ downloadStarted: false, hasStatus: true })).toEqual({
      retry: 'recheck',
      fallbackPanel: false,
    });
  });
  it('offers download again only for a failure during a download the user started', () => {
    expect(failurePlan({ downloadStarted: true, hasStatus: true })).toEqual({
      retry: 'download',
      fallbackPanel: false,
    });
  });
});
