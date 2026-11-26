/*
 * Screen-authoring contract
 *
 * - A `Screen` builds its DOM once per render and returns it. The shell re-renders a screen only when
 *   the step or the results tab changes; `ctx.update()` does NOT rebuild it. To repaint after a
 *   same-step change (including `record()` and changes made elsewhere), use `ctx.subscribe()`.
 * - Every render gets a fresh `AppContext`. When the screen is discarded (step or tab change, Start
 *   over) its `signal` is aborted, its `onDispose` callbacks run exactly once and its `subscribe`
 *   listeners are removed. Pass `ctx.signal` to abortable work and use `ctx.onDispose` to release
 *   anything else (for example the unsubscribe function of `ai.subscribeDeviceStatus`).
 * - After disposal, `update`, `announce` and `showError` on that context do nothing, so a late async result
 *   cannot touch the screen that replaced it. `getSession()` still works.
 * - `record` is the exception: an AI call that happened must reach the session log even if the screen that made
 *   it is gone (the user can see what was sent in Under the hood). It is dropped only when the user has started
 *   over since the context was created (a new session epoch), so a stale call never lands in a new session.
 *   Screens must therefore call `record` before any `signal.aborted` early return, and skip only their DOM work.
 * - `showError` writes to the assertive region above `main`; `announce` to the polite status region.
 */
import type { AIErrorCode, AIResult, ClearBillAI } from '../ai/index.ts';
import type { Session } from './state.ts';

/** What the shell hands to every screen. */
export interface AppContext {
  readonly ai: ClearBillAI;
  /** Aborted when this screen is discarded. */
  readonly signal: AbortSignal;
  /** Registers cleanup to run once when this screen is discarded. */
  onDispose(fn: () => void): void;
  getSession(): Session;
  /** Replaces the session. The screen is re-rendered only when the step or results tab changes. */
  update(fn: (s: Session) => Session): void;
  /**
   * Calls `listener` with the new session after every `update()` and `record()`, including same-step
   * changes. Returns an unsubscribe function; it is also called automatically on disposal.
   */
  subscribe(listener: (s: Session) => void): () => void;
  /** Polite live region: progress and confirmations. Keep messages short. */
  announce(msg: string): void;
  /** Assertive live region: errors after a user action. Optionally offers a retry button. */
  showError(code: AIErrorCode, retry?: () => void): void;
  /** Adds a call to the session log (shown in Under the hood). */
  record(step: string, result: AIResult<unknown>): void;
}

/** A screen renders the content of `main`, starting with exactly one `h1`. */
export type Screen = (ctx: AppContext) => HTMLElement;
