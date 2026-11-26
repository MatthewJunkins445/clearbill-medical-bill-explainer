// Pure formatting for the Under the hood panel.
import type { CloudAvailability } from '../../ai/index.ts';
import { t } from '../copy.ts';
import type { LogEntry } from '../state.ts';

const STEP_KEYS: Readonly<Record<string, string>> = {
  redaction: 'redact',
  redact: 'redact',
  guard: 'guard',
  explain: 'explain',
  question: 'question',
  audit: 'audit',
  letter: 'letter',
};

export function stepLabel(step: string): string {
  const key = Object.hasOwn(STEP_KEYS, step) ? STEP_KEYS[step] : undefined;
  return key === undefined ? step : t(`underTheHood.stepNames.${key}`);
}

export interface HoodRow {
  readonly step: string;
  readonly source: string;
  readonly model: string;
  readonly mode: string;
  readonly latency: string;
  readonly fellBack: boolean;
}

export function hoodRow(entry: LogEntry): HoodRow {
  return {
    step: stepLabel(entry.step),
    source: t(`badges.${entry.source}.label`),
    model: entry.model,
    mode: t(`underTheHood.modeValues.${entry.mode}`),
    latency: t('underTheHood.latencyValue', { ms: entry.latencyMs }),
    fellBack: entry.fellBack,
  };
}

/** The model of the latest call that ran in the cloud, or null when none did. */
export function cloudModelOf(log: readonly LogEntry[]): string | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry?.source === 'IN_CLOUD') return entry.model;
  }
  return null;
}

export function killSwitchPaused(availability: CloudAvailability): boolean {
  return !availability.allowed && availability.reason === 'kill_switch';
}
