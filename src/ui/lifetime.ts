// Small pure helpers for the screen lifecycle (no DOM), so they can be unit tested.

/** The lifetime of one rendered screen. */
export interface Scope {
  readonly signal: AbortSignal;
  readonly active: boolean;
  /** Runs `fn` when the scope is disposed (immediately if it already is). */
  onDispose(fn: () => void): void;
  /** Aborts the signal and runs the registered callbacks, exactly once. */
  dispose(): void;
}

export function createScope(): Scope {
  const controller = new AbortController();
  const callbacks: (() => void)[] = [];
  let active = true;
  return {
    signal: controller.signal,
    get active() {
      return active;
    },
    onDispose(fn) {
      if (active) callbacks.push(fn);
      else fn();
    },
    dispose() {
      if (!active) return;
      active = false;
      controller.abort();
      for (const fn of callbacks.splice(0)) {
        try {
          fn();
        } catch (error) {
          console.error(error);
        }
      }
    },
  };
}

export interface Emitter<T> {
  subscribe(listener: (value: T) => void): () => void;
  emit(value: T): void;
  /**
   * Snapshots the current listeners. The returned function notifies those that are still
   * subscribed when it is called, so listeners removed in between (a disposed screen) are skipped and
   * listeners added in between (the new screen) are not called for a change they did not witness.
   */
  capture(): (value: T) => void;
}

/** Calls one listener; a throwing listener is logged by error name only (never its message) and skipped. */
function notifySafely<T>(listener: (value: T) => void, value: T): void {
  try {
    listener(value);
  } catch (error) {
    console.error('A ClearBill listener failed.', error instanceof Error ? error.name : 'unknown error');
  }
}

export function createEmitter<T>(): Emitter<T> {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(value) {
      for (const listener of [...listeners]) notifySafely(listener, value);
    },
    capture() {
      const snapshot = [...listeners];
      return (value) => {
        for (const listener of snapshot) if (listeners.has(listener)) notifySafely(listener, value);
      };
    },
  };
}

/**
 * Counts sessions. A screen context remembers the epoch it was created in; work that finishes after the user
 * started over carries an old epoch, so it can be told apart from work that belongs to the current session.
 */
export interface Epoch {
  readonly current: number;
  /** Starts a new session: every epoch captured so far stops being current. */
  advance(): void;
  isCurrent(captured: number): boolean;
}

export function createEpoch(): Epoch {
  let current = 0;
  return {
    get current() {
      return current;
    },
    advance() {
      current += 1;
    },
    isCurrent: (captured) => captured === current,
  };
}
