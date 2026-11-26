import { describe, expect, it } from 'vitest';
import { CLOUD_REQUEST_TIMEOUT_MS, toInferenceMode, toResultSource } from './generate.ts';

describe('toInferenceMode', () => {
  it('maps each requested mode to the Firebase AI Logic inference mode', () => {
    expect(toInferenceMode('ONLY_ON_DEVICE')).toBe('only_on_device');
    expect(toInferenceMode('PREFER_ON_DEVICE')).toBe('prefer_on_device');
    expect(toInferenceMode('PREFER_IN_CLOUD')).toBe('prefer_in_cloud');
  });
});

describe('toResultSource', () => {
  it('maps the reported inference source one to one', () => {
    expect(toResultSource('on_device', 'prefer_in_cloud')).toBe('ON_DEVICE');
    expect(toResultSource('in_cloud', 'prefer_on_device')).toBe('IN_CLOUD');
  });

  it('assumes the cloud only for a cloud-only request with no reported source', () => {
    expect(toResultSource(undefined, 'only_in_cloud')).toBe('IN_CLOUD');
  });

  it.each(['only_on_device', 'prefer_on_device', 'prefer_in_cloud'] as const)(
    'refuses to invent a label when %s reports no source',
    (mode) => {
      expect(() => toResultSource(undefined, mode)).toThrow(expect.objectContaining({ code: 'UNKNOWN' }));
    },
  );

  it('refuses an unknown reported source', () => {
    expect(() => toResultSource('somewhere' as never, 'prefer_on_device')).toThrow(expect.objectContaining({ code: 'UNKNOWN' }));
  });
});

describe('CLOUD_REQUEST_TIMEOUT_MS', () => {
  it('fails a hung cloud call after 45 seconds instead of the SDK default of 180', () => {
    expect(CLOUD_REQUEST_TIMEOUT_MS).toBe(45_000);
  });
});
