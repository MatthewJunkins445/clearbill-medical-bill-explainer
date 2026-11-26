import type { DeviceModelState } from '../contract.ts';

/** Availability and download of Chrome's on-device model (Gemini Nano through the Prompt API). */
export interface DeviceProbe {
  availability(): Promise<DeviceModelState>;
  /** Creates (and so downloads, if needed) a session. `loaded` is the download fraction, 0..1. */
  create(onProgress: (loaded: number) => void): Promise<void>;
}

/** The model label for on-device results. */
export const DEVICE_MODEL_NAME = 'gemini-nano';

type ChromeAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface ExpectedIO {
  type: 'text';
  languages: string[];
}

export interface NanoCreateOptions {
  expectedInputs: ExpectedIO[];
  expectedOutputs: ExpectedIO[];
}

interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', listener: (event: { loaded: number }) => void): void;
}

/** The minimal slice of Chrome's global `LanguageModel` (Prompt API) that ClearBill uses. */
interface ChromeLanguageModel {
  availability(options?: NanoCreateOptions): Promise<ChromeAvailability>;
  create(options?: NanoCreateOptions & { monitor?: (monitor: DownloadMonitor) => void }): Promise<{ destroy(): void }>;
}

/**
 * English text in and out. The same options go to Firebase AI Logic's on-device params (generate.ts), so the
 * availability this probe reports is the one the SDK sees. Fresh objects each call: the SDK may mutate them.
 */
export function nanoCreateOptions(): NanoCreateOptions {
  return {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  };
}

const STATES: readonly ChromeAvailability[] = ['unavailable', 'downloadable', 'downloading', 'available'];

function languageModel(): ChromeLanguageModel | undefined {
  const candidate = (globalThis as { LanguageModel?: unknown }).LanguageModel;
  return typeof candidate === 'function' || (typeof candidate === 'object' && candidate !== null)
    ? (candidate as ChromeLanguageModel)
    : undefined;
}

export function createDeviceProbe(): DeviceProbe {
  return {
    async availability() {
      const model = languageModel();
      if (!model) return 'unsupported';
      try {
        const state = await model.availability(nanoCreateOptions());
        return STATES.includes(state) ? state : 'unavailable';
      } catch {
        return 'unavailable';
      }
    },
    async create(onProgress) {
      const model = languageModel();
      if (!model) throw new Error('The on-device model is not supported in this browser.');
      const session = await model.create({
        ...nanoCreateOptions(),
        monitor(monitor) {
          monitor.addEventListener('downloadprogress', (event) => {
            onProgress(event.loaded);
          });
        },
      });
      // Only the download was wanted; the SDK opens its own sessions for prompts.
      session.destroy();
    },
  };
}
