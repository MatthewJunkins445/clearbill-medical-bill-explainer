import { describe, expect, it } from 'vitest';
import type { BillInput, RedactionApproval, RedactionDraft, RedactionValue } from '../ai/index.ts';
import {
  addDetail,
  goTo,
  logResult,
  newSession,
  removeDetail,
  setConsent,
  startOver,
  toggleKept,
  withApproval,
  withDraft,
  withoutInput,
  withInput,
  withQuestionDraft,
  withTab,
  type LogEntry,
  type Session,
} from './state.ts';

const input: BillInput = { kind: 'sample', sampleId: 'itemized-er-laceration' };
const draft: RedactionDraft = { provenance: 'sample', kind: 'itemized_bill', text: 'x', entities: [] };
const approval = { applied: [], guardAppliedCount: 0 } as unknown as RedactionApproval;
const otherInput: BillInput = { kind: 'text', text: 'other bill', origin: 'paste' };
const detail: RedactionValue = { category: 'PHONE', value: '555-0100' };
const otherDetail: RedactionValue = { category: 'EMAIL', value: 'a@b.example' };
const entry: LogEntry = {
  at: 1,
  step: 'explain',
  source: 'LOCAL_RULES',
  model: 'm',
  mode: 'NONE',
  latencyMs: 5,
  fellBack: false,
};

function fullSession(): Session {
  let s = withInput(newSession(), input);
  s = withDraft(s, draft, 'ON_DEVICE');
  s = toggleKept(s, 'e1');
  s = addDetail(s, detail);
  s = withApproval(s, approval);
  s = setConsent(s, 'agreed');
  s = withApproval(s, approval);
  return logResult(s, entry);
}

function deepFreeze<T extends object>(o: T): T {
  for (const v of Object.values(o)) {
    if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) deepFreeze(v);
  }
  return Object.freeze(o);
}

describe('newSession', () => {
  it('starts at import with nothing set', () => {
    expect(newSession()).toEqual({
      step: 'import',
      tab: 'explain',
      consent: 'notAsked',
      input: null,
      draft: null,
      draftSource: null,
      keptIds: [],
      added: [],
      approval: null,
      questionDraft: '',
      log: [],
    });
  });

  it('returns a fresh object each call', () => {
    expect(newSession()).not.toBe(newSession());
  });
});

describe('withInput', () => {
  it('stores the input and clears everything downstream, including consent', () => {
    const s = withInput(fullSession(), otherInput);
    expect(s.input).toBe(otherInput);
    expect(s.draft).toBeNull();
    expect(s.draftSource).toBeNull();
    expect(s.keptIds).toEqual([]);
    expect(s.added).toEqual([]);
    expect(s.approval).toBeNull();
    expect(s.consent).toBe('notAsked');
  });

  it('does not clear the log', () => {
    expect(withInput(fullSession(), input).log).toEqual([entry]);
  });
});

describe('withDraft', () => {
  it('stores the draft and its source', () => {
    const s = withDraft(newSession(), draft, 'IN_CLOUD');
    expect(s.draft).toBe(draft);
    expect(s.draftSource).toBe('IN_CLOUD');
  });

  it('resets the review choices and approval that belonged to a previous draft', () => {
    const s = withDraft(fullSession(), draft, 'ON_DEVICE');
    expect(s.keptIds).toEqual([]);
    expect(s.added).toEqual([]);
    expect(s.approval).toBeNull();
  });

  it('resets consent to notAsked and drops the approval', () => {
    const before = fullSession();
    expect(before.consent).toBe('agreed');
    expect(before.approval).not.toBeNull();
    const s = withDraft(before, draft, 'ON_DEVICE');
    expect(s.consent).toBe('notAsked');
    expect(s.approval).toBeNull();
  });
});

describe('toggleKept', () => {
  it('adds then removes an id', () => {
    const a = toggleKept(newSession(), 'e1');
    expect(a.keptIds).toEqual(['e1']);
    const b = toggleKept(a, 'e1');
    expect(b.keptIds).toEqual([]);
  });

  it('keeps other ids when removing one', () => {
    const s = toggleKept(toggleKept(newSession(), 'e1'), 'e2');
    expect(toggleKept(s, 'e1').keptIds).toEqual(['e2']);
  });

  it('resets consent to notAsked and drops the approval', () => {
    const before = fullSession();
    expect(before.consent).toBe('agreed');
    expect(before.approval).not.toBeNull();
    const s = toggleKept(before, 'e1');
    expect(s.consent).toBe('notAsked');
    expect(s.approval).toBeNull();
  });
});

describe('addDetail', () => {
  it('appends the value', () => {
    expect(addDetail(newSession(), detail).added).toEqual([detail]);
  });

  it('resets consent to notAsked and drops the approval', () => {
    const before = fullSession();
    expect(before.consent).toBe('agreed');
    expect(before.approval).not.toBeNull();
    const s = addDetail(before, otherDetail);
    expect(s.consent).toBe('notAsked');
    expect(s.approval).toBeNull();
  });
});

describe('removeDetail', () => {
  it('removes the added detail at that index and resets consent and approval', () => {
    const before = addDetail(fullSession(), otherDetail);
    const s = removeDetail(before, 0);
    expect(s.added).toEqual([otherDetail]);
    expect(s.consent).toBe('notAsked');
    expect(s.approval).toBeNull();
  });
});

describe('withApproval', () => {
  it('stores the approval', () => {
    expect(withApproval(newSession(), approval).approval).toBe(approval);
  });
});

describe('setConsent', () => {
  it('sets consent and always drops the existing approval', () => {
    for (const next of ['agreed', 'declined', 'withdrawn', 'notAsked'] as const) {
      const s = setConsent(withApproval(newSession(), approval), next);
      expect(s.consent).toBe(next);
      expect(s.approval).toBeNull();
    }
  });

  it('drops the approval even when consent is unchanged', () => {
    const agreed = setConsent(newSession(), 'agreed');
    expect(setConsent(withApproval(agreed, approval), 'agreed').approval).toBeNull();
  });
});

describe('goTo', () => {
  it('changes only the step', () => {
    const s = fullSession();
    expect(goTo(s, 'review')).toEqual({ ...s, step: 'review' });
  });
});

describe('logResult', () => {
  it('appends without mutating the previous log', () => {
    const s = newSession();
    const next = logResult(s, entry);
    expect(next.log).toEqual([entry]);
    expect(s.log).toEqual([]);
    const again = logResult(next, { ...entry, at: 2 });
    expect(again.log.map((e) => e.at)).toEqual([1, 2]);
    expect(next.log).toHaveLength(1);
  });
});

describe('startOver', () => {
  it('equals a fresh session with an empty log', () => {
    expect(startOver()).toEqual(newSession());
    expect(startOver().log).toEqual([]);
  });
});

describe('purity', () => {
  it('returns new objects and never mutates frozen arguments', () => {
    const s = deepFreeze(fullSession());
    const results = [
      withInput(s, input),
      withDraft(s, draft, 'ON_DEVICE'),
      toggleKept(s, 'e1'),
      toggleKept(s, 'e9'),
      addDetail(s, detail),
      withApproval(s, approval),
      setConsent(s, 'withdrawn'),
      goTo(s, 'results'),
      logResult(s, entry),
    ];
    for (const r of results) expect(r).not.toBe(s);
    expect(s.keptIds).toEqual(['e1']);
    expect(s.added).toEqual([detail]);
    expect(s.log).toEqual([entry]);
    expect(s.consent).toBe('agreed');
    expect(s.approval).toBe(approval);
  });
});

describe('withoutInput', () => {
  it('clears the input and everything derived from it, and keeps the log', () => {
    const entry = {
      at: 1,
      step: 'redaction',
      source: 'ON_DEVICE',
      model: 'm',
      mode: 'NONE',
      latencyMs: 1,
      fellBack: false,
    } as const;
    const s = logResult(withDraft(withInput(newSession(), input), draft, 'ON_DEVICE'), entry);
    const next = withoutInput(s);
    expect(next.input).toBeNull();
    expect(next.draft).toBeNull();
    expect(next.step).toBe('import');
    expect(next.log).toEqual([entry]);
  });
});

describe('withTab', () => {
  it('switches the results tab and keeps everything else', () => {
    const s = withApproval(newSession(), approval);
    const next = withTab(s, 'questions');
    expect(next.tab).toBe('questions');
    expect(next.approval).toBe(approval);
    expect(next.step).toBe(s.step);
    expect(s.tab).toBe('explain');
  });
});

describe('question draft', () => {
  it('withQuestionDraft sets the text and changes nothing else', () => {
    const s = fullSession();
    const next = withQuestionDraft(s, 'Why twice?');
    expect(next.questionDraft).toBe('Why twice?');
    expect(next.approval).toBe(approval);
    expect(next.consent).toBe('agreed');
    expect(s.questionDraft).toBe('');
  });

  it('is cleared by withInput, withoutInput and startOver', () => {
    const typed = withQuestionDraft(fullSession(), 'my private question');
    expect(withInput(typed, otherInput).questionDraft).toBe('');
    expect(withoutInput(typed).questionDraft).toBe('');
    expect(startOver().questionDraft).toBe('');
  });
});
