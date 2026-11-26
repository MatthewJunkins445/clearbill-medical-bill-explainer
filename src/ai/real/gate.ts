import { ClearBillAIError } from '../contract.ts';
import type { BillProvenance, CloudAvailability, CloudBlockReason } from '../contract.ts';

export interface CloudGateInput {
  readonly killSwitch: boolean;
  readonly regionAllowed: boolean;
  readonly cloudReady: boolean;
  readonly provenance: BillProvenance;
  readonly consent?: boolean;
}

/** Precedence: kill_switch, region (also when cloud is not ready: fail closed), user_bill, no_consent. */
export function cloudAvailability(input: CloudGateInput): CloudAvailability {
  if (input.killSwitch) return { allowed: false, reason: 'kill_switch' };
  if (!input.regionAllowed || !input.cloudReady) return { allowed: false, reason: 'region' };
  if (input.provenance !== 'sample') return { allowed: false, reason: 'user_bill' };
  if (input.consent !== true) return { allowed: false, reason: 'no_consent' };
  return { allowed: true };
}

export function gateError(reason: CloudBlockReason): ClearBillAIError {
  const code = reason === 'kill_switch' ? 'KILL_SWITCH' : reason === 'no_consent' ? 'CONSENT_REQUIRED' : 'CLOUD_NOT_ALLOWED';
  return new ClearBillAIError(code, false, reason);
}
