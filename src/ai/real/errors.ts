import { ClearBillAIError } from '../contract.ts';

/*
 * Pure duck-typed mapping of whatever a generation call throws. It must not import firebase/ai.
 * Real shapes (@firebase/ai AIError, a FirebaseError): code 'fetch-error' (HTTP failure, with
 * customErrorData.status), 'response-error' (blocked prompt or candidate, with customErrorData.response),
 * 'error' (any other failure while fetching, message carries the cause), 'parse-failed', 'api-not-enabled', ...
 * Messages are only inspected, never copied: they can echo request data.
 */
const BLOCKED_FINISH_REASONS = new Set([
  'SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'RECITATION', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT',
]);
const NETWORK_MESSAGE = /failed to fetch|load failed|networkerror|network request failed|network error/i;
// A busy or overloaded model (HTTP 500/503, "high demand"): wait and retry, the device still works.
const BUSY_STATUSES = new Set([500, 503]);
const BUSY_MESSAGE = /high demand|overloaded|try again later|temporarily/i;
// The SDK aborts its own request timeout with DOMException('Timeout has expired.', 'AbortError').
const TIMEOUT_MESSAGE = /timeout has expired/i;

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function isBlockedResponse(response: unknown): boolean {
  if (field(field(response, 'promptFeedback'), 'blockReason')) return true;
  const candidates = field(response, 'candidates');
  const reason = Array.isArray(candidates) ? field(candidates[0], 'finishReason') : undefined;
  return typeof reason === 'string' && BLOCKED_FINISH_REASONS.has(reason);
}

export function mapError(e: unknown): ClearBillAIError {
  if (e instanceof ClearBillAIError) return e;
  const name = field(e, 'name');
  const code = field(e, 'code');
  const rawMessage = field(e, 'message');
  const message = typeof rawMessage === 'string' ? rawMessage : '';
  const data = field(e, 'customErrorData');
  const status = field(data, 'status');

  if (name === 'AbortError') {
    // The SDK's own timeout while online means the service is slow or busy: show the busy card, not "offline".
    return TIMEOUT_MESSAGE.test(message) ? new ClearBillAIError('QUOTA_OR_RATE_LIMIT', true) : new ClearBillAIError('ABORTED', false);
  }
  if (code === 'fetch-error') {
    if (status === 429 || /resource.?exhausted|quota/i.test(message)) return new ClearBillAIError('QUOTA_OR_RATE_LIMIT', true);
    if ((status === 401 || status === 403) && /app\s*check/i.test(message)) return new ClearBillAIError('APP_CHECK_FAILED', false);
    if ((typeof status === 'number' && BUSY_STATUSES.has(status)) || BUSY_MESSAGE.test(message)) {
      return new ClearBillAIError('QUOTA_OR_RATE_LIMIT', true);
    }
    if (typeof status !== 'number' || status === 408 || status >= 500) return new ClearBillAIError('NETWORK', true);
  } else if (code === 'response-error') {
    if (isBlockedResponse(field(data, 'response')) || /blocked/i.test(message)) return new ClearBillAIError('SAFETY_BLOCKED', false);
  } else if (code === 'parse-failed') {
    return new ClearBillAIError('SCHEMA_PARSE_FAILED', true);
  } else if (NETWORK_MESSAGE.test(message) && (code === 'error' || e instanceof TypeError)) {
    return new ClearBillAIError('NETWORK', true);
  }
  return new ClearBillAIError('UNKNOWN', true);
}
