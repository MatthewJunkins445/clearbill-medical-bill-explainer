// Pure description of the S03 device-model panel: which actions each state offers.
import type { DeviceModelState } from '../../ai/index.ts';

export type ModelAction = 'download' | 'rules' | 'recheck' | 'requirements' | 'continue';

export interface PanelSpec {
  readonly primary: ModelAction | null;
  readonly secondary: ModelAction | null;
  /** Whether `deviceModel.states.<state>.secondaryHint` exists and is tied to the secondary action. */
  readonly hint: boolean;
}

/**
 * Only `downloadable` offers `download`, and only as a button the user presses. `available` always
 * offers Continue (nothing moves on by itself), also when the check found the model already there.
 */
export function panelSpec(state: DeviceModelState): PanelSpec {
  switch (state) {
    case 'unsupported':
      return { primary: 'rules', secondary: 'requirements', hint: false };
    case 'unavailable':
      return { primary: 'rules', secondary: 'recheck', hint: false };
    case 'downloadable':
      return { primary: 'download', secondary: 'rules', hint: true };
    case 'downloading':
      return { primary: null, secondary: 'rules', hint: true };
    case 'available':
      return { primary: 'continue', secondary: null, hint: false };
  }
}

/** Progress is 0 to 1 when known. Returns whole percent, or null when the download is indeterminate. */
export function downloadPercent(progress: number | undefined): number | null {
  if (progress === undefined || !Number.isFinite(progress)) return null;
  return progress >= 1 ? 100 : Math.min(99, Math.round(Math.max(0, progress) * 100));
}

export interface FailurePlan {
  /** What the error alert's Retry button runs. */
  readonly retry: 'recheck' | 'download';
  /** True when no device state is known, so the panel needs a fallback with the rules action. */
  readonly fallbackPanel: boolean;
}

/**
 * Decides how to recover from a failed call. `downloadStarted` means the failure happened during a
 * download the user started, the only case where Retry may start a download again. A failed status
 * check always retries the check.
 */
export function failurePlan(opts: { downloadStarted: boolean; hasStatus: boolean }): FailurePlan {
  return { retry: opts.downloadStarted ? 'download' : 'recheck', fallbackPanel: !opts.hasStatus };
}
