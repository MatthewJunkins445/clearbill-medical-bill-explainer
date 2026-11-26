import { describe, expect, it } from 'vitest';
import { ClearBillAIError } from '../contract.ts';
import { mapError } from './errors.ts';

// Shapes copied from @firebase/ai: AIError { name: 'FirebaseError', code: 'fetch-error' | 'response-error' | 'error' | ...,
// message, customErrorData?: { status?, statusText?, response?, errorDetails? } }.
function aiError(code: string, message: string, customErrorData?: unknown): Error {
  return Object.assign(new Error(message), { name: 'FirebaseError', code, customErrorData });
}
const blockedPrompt = { promptFeedback: { blockReason: 'SAFETY' } };
const blockedCandidate = { candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] };

describe('mapError', () => {
  const table: [string, unknown, string, boolean][] = [
    ['AbortError DOMException', new DOMException('aborted', 'AbortError'), 'ABORTED', false],
    ['abort-named Error', Object.assign(new Error('x'), { name: 'AbortError' }), 'ABORTED', false],
    ['429 fetch-error', aiError('fetch-error', 'Error fetching [429 Too Many Requests] quota', { status: 429 }), 'QUOTA_OR_RATE_LIMIT', true],
    ['403 App Check fetch-error', aiError('fetch-error', 'Error fetching [403 Forbidden] Firebase App Check token is invalid.', { status: 403 }), 'APP_CHECK_FAILED', false],
    ['401 appcheck fetch-error', aiError('fetch-error', 'Error fetching [401] AppCheck token missing', { status: 401 }), 'APP_CHECK_FAILED', false],
    // Task 11a / final wave: a busy model or an SDK timeout while online is a wait-and-retry condition (the
    // busy card), not a connection problem.
    ['500 fetch-error with high demand text', aiError('fetch-error', 'Error fetching from https://x: [500 ] This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.', { status: 500 }), 'QUOTA_OR_RATE_LIMIT', true],
    ['503 fetch-error', aiError('fetch-error', 'Error fetching [503 Service Unavailable]', { status: 503 }), 'QUOTA_OR_RATE_LIMIT', true],
    ['500 fetch-error without text', aiError('fetch-error', 'Error fetching [500 Internal Server Error]', { status: 500 }), 'QUOTA_OR_RATE_LIMIT', true],
    ['fetch-error overloaded text, no status', aiError('fetch-error', 'The model is overloaded'), 'QUOTA_OR_RATE_LIMIT', true],
    ['502 fetch-error', aiError('fetch-error', 'Error fetching [502 Bad Gateway]', { status: 502 }), 'NETWORK', true],
    ['SDK timeout DOMException', new DOMException('Timeout has expired.', 'AbortError'), 'QUOTA_OR_RATE_LIMIT', true],
    ['SDK timeout with surrounding text', Object.assign(new Error('Request failed: timeout has expired. (45000ms)'), { name: 'AbortError' }), 'QUOTA_OR_RATE_LIMIT', true],
    ['plain user AbortError', new DOMException('The user aborted a request.', 'AbortError'), 'ABORTED', false],
    ['fetch-error without status', aiError('fetch-error', 'Error event raised on WebSocket'), 'NETWORK', true],
    ['generic error wrapping a failed fetch', aiError('error', 'Error fetching from https://x: Failed to fetch'), 'NETWORK', true],
    ['TypeError: Failed to fetch', new TypeError('Failed to fetch'), 'NETWORK', true],
    ['Safari TypeError: Load failed', new TypeError('Load failed'), 'NETWORK', true],
    ['response-error blocked prompt', aiError('response-error', 'Response error: Response was blocked due to SAFETY', { response: blockedPrompt }), 'SAFETY_BLOCKED', false],
    ['response-error bad finish reason', aiError('response-error', 'Response error: Candidate was blocked due to PROHIBITED_CONTENT', { response: blockedCandidate }), 'SAFETY_BLOCKED', false],
    ['response-error blocked (message only)', aiError('response-error', 'Text not available. Response was blocked due to OTHER'), 'SAFETY_BLOCKED', false],
    ['response-error other', aiError('response-error', 'Server connection handshake failed.'), 'UNKNOWN', true],
    ['parse-failed', aiError('parse-failed', 'parse'), 'SCHEMA_PARSE_FAILED', true],
    ['api-not-enabled', aiError('api-not-enabled', 'enable the API'), 'UNKNOWN', true],
    ['plain string', 'boom', 'UNKNOWN', true],
    ['undefined', undefined, 'UNKNOWN', true],
    ['null', null, 'UNKNOWN', true],
    ['plain object', { foo: 1 }, 'UNKNOWN', true],
    ['generic Error', new Error('something'), 'UNKNOWN', true],
  ];

  it.each(table)('%s', (_name, input, code, retryable) => {
    const error = mapError(input);
    expect(error).toBeInstanceOf(ClearBillAIError);
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
  });

  it('passes an existing ClearBillAIError through unchanged', () => {
    const original = new ClearBillAIError('KILL_SWITCH', false, 'kill_switch');
    expect(mapError(original)).toBe(original);
  });

  it('never leaks the original message into the mapped error', () => {
    expect(mapError(aiError('fetch-error', 'secret bill text SSN 123-45-6789', { status: 429 })).message).not.toContain('123-45');
    expect(mapError(aiError('fetch-error', 'high demand for SSN 123-45-6789', { status: 500 })).message).not.toContain('123-45');
    expect(mapError(new DOMException('Timeout has expired. SSN 123-45-6789', 'AbortError')).message).not.toContain('123-45');
  });
});
