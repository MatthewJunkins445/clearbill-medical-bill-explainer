import { ClearBillAIError, IMAGE_MIME_TYPES, LETTER_KINDS, SAMPLE_IDS } from '../contract.ts';
import type {
  AIErrorCode, AIMode, AIResult, ApprovedBill, AuditFlag, BillProvenance,
  ClearBillAI, CloudAvailability, DeviceModelState, DeviceStatus, LetterKind, RedactionDraft, ResultSource,
} from '../contract.ts';
import { SAMPLE_TEXTS } from '../samples.ts';
import { fixtures } from './fixtures.ts';
import type { BillFixture } from './fixtures.ts';
import { applyReview, redactionEntities } from './redaction.ts';

type CloudOperation = 'explainBill' | 'auditBill' | 'draftLetter';
type MockOperation = CloudOperation | 'prepareDeviceModel' | 'createRedactionDraft' | 'askQuestion';

export interface MockScenario {
  readonly deviceStates?: readonly DeviceModelState[];
  readonly downloadProgress?: readonly number[];
  readonly errorCodes?: Readonly<Partial<Record<MockOperation, AIErrorCode>>>;
  readonly latencyMs?: number;
  readonly imageFixtureId?: string;
  readonly config?: {
    readonly cloudRegionAllowed?: boolean;
    readonly killSwitch?: boolean;
  };
}

export interface MockCloudPayload {
  readonly operation: CloudOperation;
  readonly mode: 'PREFER_ON_DEVICE' | 'PREFER_IN_CLOUD';
  readonly text: string;
  readonly letterKind?: LetterKind;
  readonly flagIds?: readonly string[];
}

export interface MockClearBillAI extends ClearBillAI {
  readonly cloudPayloads: readonly MockCloudPayload[];
}

interface DraftState {
  readonly fixture: BillFixture | undefined;
  approved?: ApprovedBill;
}

const builtInSample = fixtures.find((fixture) => fixture.id === SAMPLE_IDS[0]);
if (builtInSample?.kind !== 'itemized_bill' || builtInSample.plantedIssues.length === 0) {
  throw new Error('ClearBill needs an itemized synthetic sample with planted issues.');
}

function auditFlags(fixture: BillFixture | undefined): AuditFlag[] {
  return (fixture?.plantedIssues ?? []).map((issue, index) => ({
    id: String(index + 1),
    severity: issue.type === 'DUPLICATE_CHARGE' || issue.type === 'MATH_ERROR' ? 'likely_error' : 'worth_asking',
    title: issue.type.toLowerCase().replaceAll('_', ' '),
    why: issue.note,
    ask: 'Could you review this item and explain the charge?',
    lineIndexes: issue.lineIndexes,
  }));
}

export function createMockAI(scenario: MockScenario = {}): MockClearBillAI {
  const [initialState = 'available', ...nextStates] = scenario.deviceStates ?? [];
  const latencyMs = Math.max(0, scenario.latencyMs ?? 0);
  let status: DeviceStatus = Object.freeze({ state: initialState, checkedAt: 0 });
  let preparation: Promise<DeviceStatus> | undefined;
  const listeners = new Set<(status: DeviceStatus) => void>();
  const drafts = new WeakMap<RedactionDraft, DraftState>();
  const approvals = new WeakMap<ApprovedBill, DraftState>();
  const cloudPayloads: MockCloudPayload[] = [];

  async function delay(): Promise<void> {
    if (latencyMs) await new Promise<void>((resolve) => setTimeout(resolve, latencyMs));
  }

  function failIfConfigured(operation: MockOperation): void {
    const code = scenario.errorCodes?.[operation];
    if (code) {
      throw new ClearBillAIError(code, code === 'NETWORK' || code === 'QUOTA_OR_RATE_LIMIT' || code === 'DEVICE_MODEL_NOT_READY');
    }
  }

  function updateStatus(state: DeviceModelState, progress?: number): void {
    status = Object.freeze({
      state,
      checkedAt: status.checkedAt + 1,
      ...(progress === undefined ? {} : { progress }),
    });
    for (const listener of listeners) listener(status);
  }

  function requireApproved(bill: ApprovedBill): DraftState {
    const state = approvals.get(bill);
    if (!state) throw new ClearBillAIError('UNSUPPORTED_INPUT', false);
    return state;
  }

  function getCloudAvailability(target: ApprovedBill | BillProvenance): CloudAvailability {
    const state = typeof target === 'string' ? undefined : requireApproved(target);
    const provenance = typeof target === 'string' ? target : target.provenance;
    if (scenario.config?.killSwitch) return { allowed: false, reason: 'kill_switch' };
    if (scenario.config?.cloudRegionAllowed !== true) return { allowed: false, reason: 'region' };
    // Plan B admits only the bundled synthetic sample, including in test observations.
    if (provenance !== 'sample') return { allowed: false, reason: 'user_bill' };
    if (typeof target !== 'string' && (!target.consentToCloud || state?.approved !== target)) {
      return { allowed: false, reason: 'no_consent' };
    }
    return { allowed: true };
  }

  function checkCloud(bill: ApprovedBill): void {
    const cloud = getCloudAvailability(bill);
    if (!cloud.allowed) {
      const { reason } = cloud;
      const code = reason === 'kill_switch' ? 'KILL_SWITCH' : reason === 'no_consent' ? 'CONSENT_REQUIRED' : 'CLOUD_NOT_ALLOWED';
      throw new ClearBillAIError(code, false, reason);
    }
  }

  function checkDevice(): void {
    if (status.state !== 'available') throw new ClearBillAIError('DEVICE_MODEL_NOT_READY', true);
  }

  async function result<T>(data: T, mode: AIMode, source: ResultSource): Promise<AIResult<T>> {
    await delay();
    return {
      data, source, mode, latencyMs, promptVersion: 'mock-v1',
      model: source === 'LOCAL_RULES' ? 'rules' : source === 'ON_DEVICE' ? 'mock-gemini-nano' : 'mock-gemini-cloud',
      fellBack: mode === 'PREFER_ON_DEVICE' && source === 'IN_CLOUD',
    };
  }

  async function prepare(): Promise<DeviceStatus> {
    failIfConfigured('prepareDeviceModel');
    const sequence = nextStates.length ? nextStates.splice(0) : status.state === 'downloadable' ? ['downloading', 'available'] as const : [];
    for (const state of sequence) {
      await delay();
      updateStatus(state);
      if (state === 'downloading') {
        for (const progress of scenario.downloadProgress ?? [0, 0.5, 1]) {
          await delay();
          updateStatus(state, Math.min(1, Math.max(0, progress)));
        }
      }
    }
    return status;
  }

  return {
    get cloudPayloads() { return [...cloudPayloads]; },
    getDeviceStatus: () => Promise.resolve(status),
    subscribeDeviceStatus(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    prepareDeviceModel() {
      preparation ??= prepare().finally(() => { preparation = undefined; });
      return preparation;
    },
    async createRedactionDraft(input) {
      const available = status.state === 'available';
      failIfConfigured('createRedactionDraft');
      let fixture: BillFixture | undefined;
      let text: string;
      if (input.kind === 'sample') {
        if (input.sampleId !== SAMPLE_IDS[0]) throw new ClearBillAIError('UNSUPPORTED_INPUT', false);
        fixture = builtInSample;
        text = SAMPLE_TEXTS[input.sampleId];
      } else if (input.kind === 'image') {
        if (!available || !IMAGE_MIME_TYPES.includes(input.mimeType) || input.blob.size === 0) {
          throw new ClearBillAIError('UNSUPPORTED_INPUT', false);
        }
        fixture = fixtures.find((item) => item.id === scenario.imageFixtureId && item.files.image);
        text = fixture?.text ?? '';
      } else {
        text = input.text;
        fixture = fixtures.find((item) => item.text === text);
      }
      if (text.split(/\r?\n/).some((line) => line.length > 16_000)) {
        throw new ClearBillAIError('INPUT_TOO_LONG', false);
      }
      if (fixture?.kind === 'not_medical' || !fixture && !/\b(?:hospital|medical|eob|benefits|patient|insurance|cpt)\b/i.test(text)) {
        throw new ClearBillAIError('NOT_A_BILL', false);
      }

      const draft: RedactionDraft = Object.freeze({
        provenance: input.kind === 'sample' ? 'sample' : 'user',
        kind: fixture?.kind ?? 'itemized_bill',
        text,
        entities: redactionEntities(text, fixture, available),
      });
      drafts.set(draft, { fixture });
      return result(draft, available ? 'ONLY_ON_DEVICE' : 'NONE', available ? 'ON_DEVICE' : 'LOCAL_RULES');
    },
    approveRedaction(draft, review) {
      const state = drafts.get(draft);
      if (!state) throw new ClearBillAIError('UNSUPPORTED_INPUT', false);
      const { text, vault, guardAppliedCount, applied } = applyReview(draft.text, draft.entities, review, state.fixture);
      const bill = Object.freeze({
        redactedText: text, kind: draft.kind, provenance: draft.provenance, consentToCloud: review.consentToCloud === true,
      }) as ApprovedBill;
      state.approved = bill;
      approvals.set(bill, state);
      return { bill, vault, guardAppliedCount, applied };
    },
    getCloudAvailability,
    async explainBill(bill) {
      const { fixture } = requireApproved(bill);
      const allowed = getCloudAvailability(bill).allowed;
      if (!allowed) checkDevice();
      failIfConfigured('explainBill');
      if (allowed) cloudPayloads.push({ operation: 'explainBill', mode: 'PREFER_ON_DEVICE', text: bill.redactedText });
      const lineItems = (fixture?.lineItems ?? []).map(({ code, charge }, lineIndex) => ({
        lineIndex, code, charge, description: 'Service ' + code,
        whatItIs: 'This billing code identifies a service on the statement.',
        whyCharged: 'Ask the billing office to confirm what service this charge represents.',
      }));
      const totals = {
        billed: fixture?.totals?.charges ?? null,
        insurancePaid: fixture?.totals?.insurancePaid ?? null,
        adjustments: fixture?.totals?.adjustments ?? null,
        patientMayOwe: fixture?.totals?.patientResponsibility ?? null,
      };
      return result(
        { summary: 'Review the listed charges and compare them with your coverage summary.', lineItems, totals },
        allowed ? 'PREFER_ON_DEVICE' : 'ONLY_ON_DEVICE',
        status.state === 'available' ? 'ON_DEVICE' : 'IN_CLOUD',
      );
    },
    async askQuestion(bill, question) {
      requireApproved(bill);
      checkDevice();
      failIfConfigured('askQuestion');
      if (!question.trim()) throw new ClearBillAIError('UNSUPPORTED_INPUT', false);
      return result(
        { answer: 'Check the service line on the bill and ask the billing office to verify the charge.' },
        'ONLY_ON_DEVICE',
        'ON_DEVICE',
      );
    },
    async auditBill(bill) {
      checkCloud(bill);
      failIfConfigured('auditBill');
      cloudPayloads.push({ operation: 'auditBill', mode: 'PREFER_IN_CLOUD', text: bill.redactedText });
      return result({ flags: auditFlags(requireApproved(bill).fixture) }, 'PREFER_IN_CLOUD', 'IN_CLOUD');
    },
    async draftLetter(bill, audit, kind) {
      checkCloud(bill);
      if (!LETTER_KINDS.includes(kind)) throw new ClearBillAIError('UNSUPPORTED_INPUT', false);
      failIfConfigured('draftLetter');
      const selected = new Set(audit.flags.map((flag) => flag.id));
      const flags = auditFlags(requireApproved(bill).fixture).filter((flag) => selected.has(flag.id));
      cloudPayloads.push({
        operation: 'draftLetter', mode: 'PREFER_IN_CLOUD', text: bill.redactedText, letterKind: kind,
        flagIds: flags.map((flag) => flag.id),
      });
      const account = bill.redactedText.match(/\[ACCOUNT_NUMBER_\d+\]/)?.[0];
      const request = {
        itemized: 'Could you send me an itemized statement?',
        dispute: 'Could you review the charges on this statement?',
        appeal: 'Could you review how this statement was processed?',
      }[kind];
      const text = [
        'Dear Billing Office,', '', request, ...(account ? ['Account: ' + account] : []),
        ...flags.map((flag) => 'Could you clarify this item: ' + flag.title + '?'), '', 'Thank you.',
      ].join('\n');
      return result({ text }, 'PREFER_IN_CLOUD', 'IN_CLOUD');
    },
  };
}
