import type {
  AIMode,
  BillInput,
  RedactionApproval,
  RedactionDraft,
  RedactionValue,
  ResultSource,
} from '../ai/index.ts';

export type Step = 'import' | 'model' | 'working' | 'review' | 'consent' | 'results';
export type ResultsTab = 'explain' | 'questions' | 'audit' | 'letter';
export type ConsentState = 'notAsked' | 'agreed' | 'declined' | 'withdrawn';

export interface LogEntry {
  readonly at: number;
  readonly step: string;
  readonly source: ResultSource;
  readonly model: string;
  readonly mode: AIMode;
  readonly latencyMs: number;
  readonly fellBack: boolean;
}

export interface Session {
  readonly step: Step;
  readonly tab: ResultsTab;
  readonly consent: ConsentState;
  readonly input: BillInput | null;
  readonly draft: RedactionDraft | null;
  readonly draftSource: ResultSource | null;
  /**
   * Entity ids the user chose to KEEP (un-redact). This is the same set as
   * `RedactionReview.removedIds` in the AI contract, whose name refers to the ids
   * removed from redaction.
   */
  readonly keptIds: readonly string[];
  readonly added: readonly RedactionValue[];
  readonly approval: RedactionApproval | null;
  /** What the user has typed in the Questions field (kept across tabs; cleared with the bill). */
  readonly questionDraft: string;
  readonly log: readonly LogEntry[];
}

export function newSession(): Session {
  return {
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
  };
}

/** A new input invalidates everything derived from the previous one (the log is kept). */
export function withInput(s: Session, input: BillInput): Session {
  return {
    ...s,
    input,
    draft: null,
    draftSource: null,
    keptIds: [],
    added: [],
    approval: null,
    questionDraft: '',
    consent: 'notAsked',
  };
}

/** Back to an empty import step: the input and everything derived from it are dropped (the log is kept). */
export function withoutInput(s: Session): Session {
  return {
    ...s,
    step: 'import',
    input: null,
    draft: null,
    draftSource: null,
    keptIds: [],
    added: [],
    approval: null,
    questionDraft: '',
    consent: 'notAsked',
  };
}

/** A new draft has new entity ids, so earlier review choices, any approval and consent no longer apply. */
export function withDraft(s: Session, draft: RedactionDraft, source: ResultSource): Session {
  return { ...s, draft, draftSource: source, keptIds: [], added: [], approval: null, consent: 'notAsked' };
}

export function toggleKept(s: Session, id: string): Session {
  const keptIds = s.keptIds.includes(id) ? s.keptIds.filter((k) => k !== id) : [...s.keptIds, id];
  return { ...s, keptIds, approval: null, consent: 'notAsked' };
}

export function addDetail(s: Session, value: RedactionValue): Session {
  return { ...s, added: [...s.added, value], approval: null, consent: 'notAsked' };
}

/** Undoes one added detail (by its position in `added`); like any review change it drops the approval and consent. */
export function removeDetail(s: Session, index: number): Session {
  return { ...s, added: s.added.filter((_, i) => i !== index), approval: null, consent: 'notAsked' };
}

export function withApproval(s: Session, approval: RedactionApproval): Session {
  return { ...s, approval };
}

/** Granting, declining or withdrawing consent always replaces the existing approval. */
export function setConsent(s: Session, next: ConsentState): Session {
  return { ...s, consent: next, approval: null };
}

/** Switches the results tab (the step bar does the same for its results items). */
export function withTab(s: Session, tab: ResultsTab): Session {
  return { ...s, tab };
}

export function withQuestionDraft(s: Session, text: string): Session {
  return { ...s, questionDraft: text };
}

export function goTo(s: Session, step: Step): Session {
  return { ...s, step };
}

export function logResult(s: Session, entry: LogEntry): Session {
  return { ...s, log: [...s.log, entry] };
}

export function startOver(): Session {
  return newSession();
}
