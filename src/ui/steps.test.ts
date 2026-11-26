import { describe, expect, it } from 'vitest';
import { barItems, stepTitle } from './steps.ts';

describe('stepTitle', () => {
  it('uses the steps.* copy for bar steps and the redacting title while working', () => {
    expect(stepTitle({ step: 'import', tab: 'explain' })).toBe('Add bill');
    expect(stepTitle({ step: 'working', tab: 'explain' })).toBe('Removing your personal details');
    expect(stepTitle({ step: 'results', tab: 'audit' })).toBe('Things to check');
  });
});

describe('barItems', () => {
  const status = (s: Parameters<typeof barItems>[0]) => barItems(s).map((i) => i.status);

  it('marks earlier steps done and later steps upcoming', () => {
    expect(status({ step: 'review', tab: 'explain' })).toEqual([
      'completed',
      'completed',
      'current',
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
  });

  it('maps the working step onto Set up', () => {
    expect(barItems({ step: 'working', tab: 'explain' }).find((i) => i.status === 'current')?.key).toBe(
      'model',
    );
  });

  it('on results, the tab is current and the other tabs are open links', () => {
    expect(status({ step: 'results', tab: 'questions' })).toEqual([
      'completed',
      'completed',
      'completed',
      'completed',
      'open',
      'current',
      'open',
      'open',
    ]);
  });
});
