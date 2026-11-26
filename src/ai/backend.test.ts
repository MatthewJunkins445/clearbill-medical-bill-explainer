import { describe, expect, it } from 'vitest';
import { chooseBackend } from './index.ts';

describe('chooseBackend', () => {
  it.each([
    [true, true, 'development', 'mock'],
    [true, false, 'test', 'mock'],
    [true, true, 'test', 'mock'],
    [false, true, 'development', 'real'],
    [false, false, 'test', 'real'],
    [false, false, 'production', 'real'],
    // A production build never uses the mock, even when VITE_AI_MODE=mock is set.
    [true, false, 'production', 'real'],
    [true, false, 'staging', 'real'],
  ] as const)('mockRequested=%s dev=%s mode=%s -> %s', (mockRequested, dev, mode, expected) => {
    expect(chooseBackend({ mockRequested, dev, mode })).toBe(expected);
  });
});
