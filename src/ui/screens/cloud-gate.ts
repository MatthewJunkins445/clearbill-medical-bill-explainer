// Pure gate for the cloud-only tabs (Things to check, Letter): the AI is called only when consent is `agreed` and the
// cloud is open for this approval. Otherwise the screen explains the current reason and offers the matching action.
import { ClearBillAIError, type AIErrorCode, type CloudAvailability } from '../../ai/index.ts';
import type { ConsentState } from '../state.ts';

export type CloudGate =
  | { readonly kind: 'run' }
  | { readonly kind: 'needConsent' }
  | { readonly kind: 'blocked'; readonly reason: 'kill_switch' | 'region' | 'user_bill' };

/** `availability` comes from `getCloudAvailability(approval.bill)`. */
export function cloudGate(consent: ConsentState, availability: CloudAvailability): CloudGate {
  // A closed cloud is reported as it is now, whatever the user chose earlier.
  if (!availability.allowed && availability.reason !== 'no_consent')
    return { kind: 'blocked', reason: availability.reason };
  if (consent !== 'agreed' || !availability.allowed) return { kind: 'needConsent' };
  return { kind: 'run' };
}

/** The `errors.<code>` copy that explains a gate that did not open. */
export function gateErrorCode(gate: ClosedGate): AIErrorCode {
  if (gate.kind === 'needConsent') return 'CONSENT_REQUIRED';
  return gate.reason === 'kill_switch' ? 'KILL_SWITCH' : 'CLOUD_NOT_ALLOWED';
}

/** Copy key of the extra notice shown under the error card (region and sample-only), or null. */
export function gateNoticeKey(gate: ClosedGate): string | null {
  if (gate.kind !== 'blocked') return null;
  if (gate.reason === 'region') return 'specialStates.regionUnavailable.body';
  return gate.reason === 'user_bill' ? 'specialStates.cloudSampleOnly.body' : null;
}

export type ClosedGate = Exclude<CloudGate, { kind: 'run' }>;

/** The gate an error from the AI layer stands for (the cloud closed after the screen checked), or null for any other error. */
export function gateFromError(error: unknown): ClosedGate | null {
  if (!(error instanceof ClearBillAIError)) return null;
  switch (error.code) {
    case 'CONSENT_REQUIRED':
      return { kind: 'needConsent' };
    case 'KILL_SWITCH':
      return { kind: 'blocked', reason: 'kill_switch' };
    case 'CLOUD_NOT_ALLOWED':
      return { kind: 'blocked', reason: error.cloudReason === 'user_bill' ? 'user_bill' : 'region' };
    default:
      return null;
  }
}
