// Application entry point. Firebase is initialised by createClearBillAI (src/ai), not here.
import './styles.css';
import { createClearBillAI, type ClearBillAI, type MockScenario } from '../ai/index.ts';
import { mountApp } from './app.ts';
import { parseScenario } from './scenario.ts';
import { unavailableAI } from './unavailable-ai.ts';

async function start(root: HTMLElement): Promise<void> {
  // The ?scenario= query parameter configures the mock AI for tests. It is ignored otherwise.
  const scenario: MockScenario | undefined =
    import.meta.env.VITE_AI_MODE === 'mock' && !import.meta.env.PROD ? parseScenario(location.search) : undefined;
  let ai: ClearBillAI;
  let startupError = false;
  try {
    ai = await createClearBillAI(scenario);
  } catch (error) {
    console.error('ClearBill could not start its AI layer.', error);
    ai = unavailableAI();
    startupError = true;
  }
  mountApp(root, ai, { startupError });
}

const root = document.getElementById('app');
if (root) void start(root);
