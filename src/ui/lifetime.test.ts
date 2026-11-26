import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmitter, createEpoch, createScope } from './lifetime.ts';

describe('createScope', () => {
  it('starts active, aborts its signal and runs onDispose callbacks exactly once', () => {
    const scope = createScope();
    const a = vi.fn();
    const b = vi.fn();
    scope.onDispose(a);
    scope.onDispose(b);
    expect(scope.active).toBe(true);
    expect(scope.signal.aborted).toBe(false);
    scope.dispose();
    scope.dispose();
    expect(scope.active).toBe(false);
    expect(scope.signal.aborted).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('runs a callback registered after disposal immediately', () => {
    const scope = createScope();
    scope.dispose();
    const late = vi.fn();
    scope.onDispose(late);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('keeps disposing when one callback throws', () => {
    const scope = createScope();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const after = vi.fn();
    scope.onDispose(() => {
      throw new Error('boom');
    });
    scope.onDispose(after);
    scope.dispose();
    expect(after).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe('createEmitter', () => {
  it('calls subscribers and stops after unsubscribe', () => {
    const emitter = createEmitter<number>();
    const listener = vi.fn();
    const off = emitter.subscribe(listener);
    emitter.emit(1);
    off();
    emitter.emit(2);
    expect(listener.mock.calls).toEqual([[1]]);
  });

  it('capture() notifies only listeners present before and still subscribed afterwards', () => {
    const emitter = createEmitter<number>();
    const kept = vi.fn();
    const removed = vi.fn();
    const added = vi.fn();
    emitter.subscribe(kept);
    const offRemoved = emitter.subscribe(removed);
    const notify = emitter.capture();
    offRemoved(); // e.g. the screen was disposed during the re-render
    emitter.subscribe(added); // e.g. the new screen subscribed while rendering
    notify(7);
    expect(kept).toHaveBeenCalledWith(7);
    expect(removed).not.toHaveBeenCalled();
    expect(added).not.toHaveBeenCalled();
  });
});

describe('createEpoch', () => {
  it('matches only the epoch that was current when it was captured', () => {
    const epoch = createEpoch();
    const first = epoch.current;
    expect(epoch.isCurrent(first)).toBe(true);
    epoch.advance();
    expect(epoch.isCurrent(first)).toBe(false);
    expect(epoch.isCurrent(epoch.current)).toBe(true);
  });
});

describe('emitter listener isolation', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it.each(['emit', 'capture'] as const)('a throwing listener does not stop the others (%s)', (path) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const emitter = createEmitter<number>();
    const seen: number[] = [];
    emitter.subscribe(() => { throw new RangeError('secret bill text'); });
    emitter.subscribe((value) => seen.push(value));
    const notify = path === 'emit' ? (value: number) => { emitter.emit(value); } : emitter.capture();
    expect(() => { notify(7); }).not.toThrow();
    expect(seen).toEqual([7]);
    expect(log).toHaveBeenCalledTimes(1);
    const args = log.mock.calls[0] ?? [];
    expect(args.every((arg) => typeof arg === 'string')).toBe(true);
    expect(args.join(' ')).toContain('RangeError');
    expect(args.join(' ')).not.toContain('secret');
  });
});
