import type { FirebaseApp } from 'firebase/app';
import { GoogleAIBackend, InferenceMode, InferenceSource, getAI, getGenerativeModel } from 'firebase/ai';
import type { AI } from 'firebase/ai';
import { ClearBillAIError } from '../contract.ts';
import type { InferenceSource as ResultInferenceSource } from '../contract.ts';
import { DEVICE_MODEL_NAME, nanoCreateOptions } from './device.ts';

export interface GenerateRequest {
  readonly prompt: string;
  readonly schema: object;
  readonly mode: 'ONLY_ON_DEVICE' | 'PREFER_ON_DEVICE' | 'PREFER_IN_CLOUD';
  readonly cloudModel: string;
}

export interface GenerateResult {
  readonly text: string;
  readonly source: ResultInferenceSource;
  readonly model: string;
}

export type Generate = (req: GenerateRequest) => Promise<GenerateResult>;

/**
 * Request timeout for the cloud fetch (the SDK default is 180 s). In @firebase/ai 13.4 it is applied only in
 * makeRequest, the cloud fetch; the on-device call never receives request options, so Nano is not affected.
 * On expiry the SDK aborts with DOMException('Timeout has expired.', 'AbortError'), which mapError maps to QUOTA_OR_RATE_LIMIT (the busy card).
 */
export const CLOUD_REQUEST_TIMEOUT_MS = 45_000;

export function toInferenceMode(mode: GenerateRequest['mode']): InferenceMode {
  switch (mode) {
    case 'ONLY_ON_DEVICE': return InferenceMode.ONLY_ON_DEVICE;
    case 'PREFER_ON_DEVICE': return InferenceMode.PREFER_ON_DEVICE;
    case 'PREFER_IN_CLOUD': return InferenceMode.PREFER_IN_CLOUD;
  }
}

/**
 * The label comes only from what the SDK reports. With no reported source a label is never guessed, except
 * for a cloud-only request, which cannot have run anywhere else.
 */
export function toResultSource(source: InferenceSource | undefined, mode: InferenceMode): ResultInferenceSource {
  switch (source) {
    case InferenceSource.ON_DEVICE: return 'ON_DEVICE';
    case InferenceSource.IN_CLOUD: return 'IN_CLOUD';
    case undefined: if (mode === InferenceMode.ONLY_IN_CLOUD) return 'IN_CLOUD';
  }
  throw new ClearBillAIError('UNKNOWN', true);
}

/**
 * The thin Firebase AI Logic wrapper: one hybrid model per call, so each step gets its own mode and schema.
 * Gemini Developer API backend (GoogleAIBackend); App Check is picked up from the app automatically.
 */
export function createGenerate(app: FirebaseApp): Generate {
  let ai: AI | undefined;
  return async ({ prompt, schema, mode, cloudModel }) => {
    ai ??= getAI(app, { backend: new GoogleAIBackend() });
    const inferenceMode = toInferenceMode(mode);
    const model = getGenerativeModel(ai, {
      mode: inferenceMode,
      onDeviceParams: { createOptions: nanoCreateOptions(), promptOptions: { responseConstraint: schema } },
      inCloudParams: { model: cloudModel, generationConfig: { responseMimeType: 'application/json' } },
    }, { timeout: CLOUD_REQUEST_TIMEOUT_MS });
    const { response } = await model.generateContent(prompt);
    const source = toResultSource(response.inferenceSource, inferenceMode);
    return { text: response.text(), source, model: source === 'ON_DEVICE' ? DEVICE_MODEL_NAME : cloudModel };
  };
}
