// Routing table: one screen per `Step`. `results` renders by tab.
import type { Screen } from '../context.ts';
import type { Step } from '../state.ts';
import { consentScreen } from './consent.ts';
import { importScreen } from './import.ts';
import { modelScreen } from './model.ts';
import { resultsScreen } from './results.ts';
import { reviewScreen } from './review.ts';
import { workingScreen } from './working.ts';

export const screens: Record<Step, Screen> = {
  import: importScreen,
  model: modelScreen,
  working: workingScreen,
  review: reviewScreen,
  consent: consentScreen,
  results: resultsScreen,
};
