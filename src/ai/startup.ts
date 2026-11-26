// Real-mode startup. The pure real AI (and the rules-only fallback) is imported statically so the fallback
// works even if a lazy chunk fails to load; only Firebase and firebase/ai are loaded on demand.
import { ClearBillAIError } from './contract.ts';
import type { ClearBillAI } from './contract.ts';
import type { FirebaseRuntime, RemoteConfigReader } from '../firebase/index.ts';
import type { DeviceProbe } from './real/device.ts';
import type { Generate } from './real/generate.ts';
import { createRealAI } from './real/index.ts';

export interface RealModules {
  readonly createGenerate: (app: FirebaseRuntime['app']) => Generate;
  readonly createDeviceProbe: () => DeviceProbe;
  readonly initializeFirebase: () => Promise<FirebaseRuntime>;
}

export type RealLoader = () => Promise<RealModules>;

const loadRealModules: RealLoader = async () => {
  const [{ createGenerate }, { createDeviceProbe }, { initializeFirebase }] = await Promise.all([
    import('./real/generate.ts'), import('./real/device.ts'), import('../firebase/index.ts'),
  ]);
  return { createGenerate, createDeviceProbe, initializeFirebase: () => initializeFirebase() };
};

// Every key resolves to the caller's fallback, so the region gate fails closed.
const FAIL_CLOSED_READER: RemoteConfigReader = {
  fetched: false,
  getBoolean: (_key, fallback) => fallback,
  getString: (_key, fallback) => fallback,
  getNumber: (_key, fallback) => fallback,
};

/**
 * Without a Firebase app there is no Firebase AI Logic client, so even on-device inference cannot run. The
 * device is reported unavailable (truthfully, for this app) and a download is never started.
 */
export const UNAVAILABLE_PROBE: DeviceProbe = {
  availability: () => Promise.resolve('unavailable'),
  create: () => Promise.reject(new Error('The on-device model cannot be prepared without Firebase.')),
};

const noClient: Generate = () => Promise.reject(new ClearBillAIError('UNKNOWN', false));

/** Rules-only redaction, device steps report DEVICE_MODEL_NOT_READY, the cloud is closed (region). */
export function createFailClosedAI(generate: Generate = noClient): ClearBillAI {
  return createRealAI({ generate, probe: UNAVAILABLE_PROBE, remoteConfig: FAIL_CLOSED_READER, cloudReady: false });
}

export async function startRealAI(load: RealLoader = loadRealModules): Promise<ClearBillAI> {
  try {
    const modules = await load();
    const runtime = await modules.initializeFirebase();
    return createRealAI({
      generate: modules.createGenerate(runtime.app), probe: modules.createDeviceProbe(),
      remoteConfig: runtime.remoteConfig, cloudReady: runtime.cloudReady,
    });
  } catch (error) {
    // The error name only: messages may carry configuration details.
    console.error('ClearBill could not start Firebase; continuing with rules-only redaction.',
      error instanceof Error ? error.name : 'unknown error');
    return createFailClosedAI();
  }
}
