import type { MockScenario } from '../ai/index.ts';

/**
 * Reads `?scenario=<url-encoded JSON>` for the AI mock (used by e2e tests). Anything that is not a
 * JSON object is ignored. The caller decides whether the parameter applies (mock mode only).
 */
export function parseScenario(search: string): MockScenario | undefined {
  const raw = new URLSearchParams(search).get('scenario');
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}
