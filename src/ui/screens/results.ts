// The results step is one screen that renders by `session.tab`. Every tab needs an approval (made on the
// consent step); without one the user is sent back there. Things to check and Letter also need consent to be
// `agreed` before they call the AI (see cloud-gate.ts).
import type { Screen } from '../context.ts';
import { auditScreen } from './audit.ts';
import { explainScreen } from './explain.ts';
import { letterScreen } from './letter.ts';
import { questionsScreen } from './questions.ts';
import { redirectScreen } from './results-common.ts';

export const resultsScreen: Screen = (ctx) => {
  const { approval, tab } = ctx.getSession();
  if (!approval) return redirectScreen(ctx, 'consent');
  switch (tab) {
    case 'explain':
      return explainScreen(ctx, approval);
    case 'questions':
      return questionsScreen(ctx, approval);
    case 'audit':
      return auditScreen(ctx, approval);
    case 'letter':
      return letterScreen(ctx, approval);
  }
};
