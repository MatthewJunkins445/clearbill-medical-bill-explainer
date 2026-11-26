import type { ClearBillAI } from './contract.ts';
import type { MockScenario } from './mock/index.ts';

export * from './contract.ts';
export type { MockScenario } from './mock/index.ts';

export async function createClearBillAI(scenario?: MockScenario): Promise<ClearBillAI> {
  if (import.meta.env.PROD || !(import.meta.env.DEV || import.meta.env.VITE_AI_MODE === 'mock')) {
    throw new Error('ClearBill inference is unavailable in this build.');
  }
  const { createMockAI } = await import('./mock/index.ts');
  return createMockAI(scenario);
}
