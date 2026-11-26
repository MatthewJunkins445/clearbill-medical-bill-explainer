// Pure mapping from an AI error code to the recovery actions an inline error card offers.
import type { AIErrorCode } from '../../ai/index.ts';

export type RecoveryKind = 'retry' | 'differentBill' | 'edit' | 'setup' | 'reload' | 'startOver' | 'consent';

export interface RecoveryAction {
  readonly kind: RecoveryKind;
  /** Key into design/copy.json for the button label. */
  readonly labelKey: string;
}

export function recoveryActions(code: AIErrorCode): readonly RecoveryAction[] {
  const primary = `errors.${code}.primaryAction`;
  switch (code) {
    // File import is not offered, so "choose another file" becomes "use a different bill".
    case 'NOT_A_BILL':
    case 'UNSUPPORTED_INPUT':
      return [{ kind: 'differentBill', labelKey: 'specialStates.notABill.primaryAction' }];
    case 'INPUT_TOO_LONG':
      return [{ kind: 'edit', labelKey: primary }];
    case 'DEVICE_MODEL_NOT_READY':
      return [{ kind: 'setup', labelKey: primary }];
    case 'CONSENT_REQUIRED':
      return [{ kind: 'consent', labelKey: primary }];
    case 'APP_CHECK_FAILED':
      return [{ kind: 'reload', labelKey: primary }];
    case 'UNKNOWN':
      return [
        { kind: 'retry', labelKey: primary },
        { kind: 'startOver', labelKey: 'errors.UNKNOWN.secondaryAction' },
      ];
    default:
      return [{ kind: 'retry', labelKey: primary }];
  }
}
