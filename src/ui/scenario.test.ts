import { describe, expect, it } from 'vitest';
import { parseScenario } from './scenario.ts';

const enc = (value: unknown): string => '?scenario=' + encodeURIComponent(JSON.stringify(value));

describe('parseScenario', () => {
  it('parses a url-encoded JSON object', () => {
    const scenario = { deviceStates: ['downloadable', 'available'], latencyMs: 5 };
    expect(parseScenario(enc(scenario))).toEqual(scenario);
  });

  it('works when other query parameters are present', () => {
    expect(parseScenario('?a=1&scenario=%7B%22latencyMs%22%3A1%7D&b=2')).toEqual({ latencyMs: 1 });
  });

  it('returns undefined for invalid JSON', () => {
    expect(parseScenario('?scenario=%7Bnot-json')).toBeUndefined();
  });

  it('returns undefined when the parameter is missing or empty', () => {
    expect(parseScenario('')).toBeUndefined();
    expect(parseScenario('?other=1')).toBeUndefined();
    expect(parseScenario('?scenario=')).toBeUndefined();
  });

  it.each([['"x"'], ['[]'], ['null'], ['42'], ['true']])(
    'returns undefined for non-object JSON %s',
    (json) => {
      expect(parseScenario('?scenario=' + encodeURIComponent(json))).toBeUndefined();
    },
  );
});
