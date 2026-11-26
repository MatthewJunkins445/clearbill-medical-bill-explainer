import type { ClearBillAI } from './contract.ts';
import type { MockScenario } from './mock/index.ts';
import { startRealAI } from './startup.ts';

export * from './contract.ts';
export type { MockScenario } from './mock/index.ts';

export interface BackendEnv {
  /** `import.meta.env.VITE_AI_MODE === 'mock'` */
  readonly mockRequested: boolean;
  readonly dev: boolean;
  readonly mode: string;
}

/** The mock only when asked for in a dev server or a test run. A production build always gets the real AI. */
export function chooseBackend(env: BackendEnv): 'mock' | 'real' {
  return env.mockRequested && (env.dev || env.mode === 'test') ? 'mock' : 'real';
}

export async function createClearBillAI(scenario?: MockScenario): Promise<ClearBillAI> {
  // The leading static check folds to false in any production build (including `vite build --mode test`),
  // so the mock and its fixtures are dropped from the bundle.
  if (!import.meta.env.PROD && (import.meta.env.DEV || import.meta.env.MODE === 'test') &&
    chooseBackend({ mockRequested: import.meta.env.VITE_AI_MODE === 'mock', dev: import.meta.env.DEV, mode: import.meta.env.MODE }) === 'mock') {
    const { createMockAI } = await import('./mock/index.ts');
    return createMockAI(scenario);
  }
  return startRealAI();
}
