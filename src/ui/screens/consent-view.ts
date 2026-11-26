// Pure mapping from cloud availability to what the consent and results screens show.
import type { CloudAvailability } from '../../ai/index.ts';

export interface ConsentChoices {
  /** Whether "Agree and continue" (and its checkbox) is offered at all. */
  readonly offerAgree: boolean;
  /** Copy key of the notice that replaces the cloud disclosure, or null when the cloud choice is offered. */
  readonly noticeKey: string | null;
}

const NOTICE = {
  kill_switch: 'specialStates.killSwitch.bannerBody',
  region: 'specialStates.regionUnavailable.body',
  user_bill: 'specialStates.cloudSampleOnly.body',
} as const;

/**
 * `availability` comes from `getCloudAvailability(provenance)`. Only the kill switch, the region and a
 * user bill block the cloud choice; `no_consent` is what this screen is there to collect.
 */
export function consentChoices(availability: CloudAvailability): ConsentChoices {
  if (availability.allowed || availability.reason === 'no_consent')
    return { offerAgree: true, noticeKey: null };
  return { offerAgree: false, noticeKey: NOTICE[availability.reason] };
}

/** Copy key explaining why the cloud check (Things to check, Letter) is off for an approved bill; null when it is on. */
export function auditUnavailableKey(availability: CloudAvailability): string | null {
  if (availability.allowed) return null;
  const { reason } = availability;
  if (reason === 'no_consent') return 'explain.auditOffDeclined';
  return reason === 'kill_switch' ? 'explain.auditOffKillSwitch' : NOTICE[reason];
}
