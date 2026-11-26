import { ClearBillAIError, LETTER_KINDS, SAMPLE_IDS } from '../contract.ts';
import type {
  AIMode, AIResult, ApprovedBill, BillAudit, BillKind, BillProvenance, ClearBillAI, CloudAvailability,
  DeviceModelState, DeviceStatus, RedactionApproval, RedactionDraft, RedactionEntity, ResultSource,
} from '../contract.ts';
import type { RemoteConfigReader } from '../../firebase/index.ts';
import { applyReview } from '../mock/redaction.ts';
import { SAMPLE_TEXTS } from '../samples.ts';
import { DEVICE_MODEL_NAME } from './device.ts';
import type { DeviceProbe } from './device.ts';
import { mapError } from './errors.ts';
import { cloudAvailability, gateError } from './gate.ts';
import type { Generate, GenerateRequest } from './generate.ts';
import { detectBillKind, validateBillText } from './input.ts';
import { parseAnswer, parseAudit, parseEntities, parseExplanation, parseLetter } from './parse.ts';
import {
  ANSWER_SCHEMA, AUDIT_SCHEMA, EXPLANATION_SCHEMA, LETTER_SCHEMA, PROMPT_VERSION, REDACTION_SCHEMA,
  auditPrompt, explainPrompt, letterPrompt, questionPrompt, redactPrompt,
} from './prompts.ts';
import { entitiesFromValues, mergeEntities, rulesEntities } from './redact.ts';

export interface RealAIDeps {
  readonly generate: Generate;
  readonly probe: DeviceProbe;
  readonly remoteConfig: RemoteConfigReader;
  /** App Check and Anonymous Auth are both ready. False keeps the cloud closed (reason `region`). */
  readonly cloudReady: boolean;
  /** Clock for DeviceStatus.checkedAt. Latency always uses performance.now(). */
  readonly now?: () => number;
}

// Remote Config keys and their in-app fallbacks (fail closed on region).
const CLOUD_MODEL_FALLBACK = 'gemini-3.8-flash';
const MAX_DEVICE_INPUT_CHARS_FALLBACK = 16_000;

interface Outcome {
  readonly source: ResultSource;
  readonly mode: AIMode;
  readonly model: string;
  /** Set only by the rules fallback after a failed on-device redaction; otherwise derived from mode and source. */
  readonly fellBack?: boolean;
}

export function createRealAI(deps: RealAIDeps): ClearBillAI {
  const { generate, probe, remoteConfig: config, cloudReady } = deps;
  const now = deps.now ?? Date.now;
  const listeners = new Set<(status: DeviceStatus) => void>();
  const drafts = new WeakSet<RedactionDraft>();
  const bills = new WeakSet<ApprovedBill>();
  let status: DeviceStatus | undefined;
  let preparation: Promise<DeviceStatus> | undefined;

  // The reader is a snapshot from startup; a kill switch applies on the next page load, within ~10 minutes
  // (production fetch interval). Values are still read per call, so each request uses the current snapshot.
  const cloudModel = (): string => config.getString('cloud_model', CLOUD_MODEL_FALLBACK) || CLOUD_MODEL_FALLBACK;
  const promptVersion = (): string => config.getString('prompt_version', PROMPT_VERSION) || PROMPT_VERSION;
  const maxChars = (): number => {
    const value = config.getNumber('max_device_input_chars', MAX_DEVICE_INPUT_CHARS_FALLBACK);
    return Number.isFinite(value) && value > 0 ? value : MAX_DEVICE_INPUT_CHARS_FALLBACK;
  };

  function setStatus(state: DeviceModelState, progress?: number): DeviceStatus {
    const next: DeviceStatus = Object.freeze({ state, checkedAt: now(), ...(progress === undefined ? {} : { progress }) });
    const changed = status?.state !== next.state || status.progress !== next.progress;
    status = next;
    if (changed) for (const listener of listeners) listener(next);
    return next;
  }

  async function refreshDevice(): Promise<DeviceStatus> {
    let state: DeviceModelState;
    try {
      state = await probe.availability();
    } catch {
      state = 'unavailable';
    }
    return setStatus(state, state === 'downloading' ? status?.progress : undefined);
  }

  async function prepare(): Promise<DeviceStatus> {
    const current = await refreshDevice();
    if (current.state !== 'downloadable' && current.state !== 'downloading') return current;
    setStatus('downloading');
    try {
      await probe.create((loaded) => {
        setStatus('downloading', Number.isFinite(loaded) ? Math.min(1, Math.max(0, loaded)) : undefined);
      });
    } catch (e) {
      // A failed create (lost user activation, low disk) is not proof the model is unavailable: publish what
      // Chrome reports now (often still 'downloadable') and reject, so the model screen offers Try again.
      const after = await refreshDevice();
      if (after.state === 'available') return after;
      throw mapError(e);
    }
    return refreshDevice();
  }

  async function requireDevice(): Promise<void> {
    if ((await refreshDevice()).state !== 'available') throw new ClearBillAIError('DEVICE_MODEL_NOT_READY', true);
  }

  function requireIssued(bill: ApprovedBill): ApprovedBill {
    if (!bills.has(bill)) throw new ClearBillAIError('UNSUPPORTED_INPUT', false);
    return bill;
  }

  function getCloudAvailability(target: ApprovedBill | BillProvenance): CloudAvailability {
    const bill = typeof target === 'string' ? undefined : requireIssued(target);
    if (bill === undefined && target !== 'sample' && target !== 'user') throw new ClearBillAIError('UNSUPPORTED_INPUT', false);
    return cloudAvailability({
      killSwitch: !config.getBoolean('cloud_features_enabled', true),
      regionAllowed: config.getBoolean('cloud_region_allowed', false),
      cloudReady,
      provenance: bill ? bill.provenance : (target as BillProvenance),
      ...(bill ? { consent: bill.consentToCloud } : {}),
    });
  }

  function requireCloud(bill: ApprovedBill): void {
    const gate = getCloudAvailability(bill);
    if (!gate.allowed) throw gateError(gate.reason);
  }

  function result<T>(data: T, outcome: Outcome, started: number): AIResult<T> {
    const { source, mode, model, fellBack } = outcome;
    return Object.freeze({
      data, source, mode, model,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      fellBack: fellBack ?? ((mode === 'PREFER_ON_DEVICE' && source === 'IN_CLOUD') || (mode === 'PREFER_IN_CLOUD' && source === 'ON_DEVICE')),
      promptVersion: promptVersion(),
    });
  }

  /** One model call, its errors mapped, labelled by where it actually ran. */
  async function run<T>(
    mode: GenerateRequest['mode'], prompt: string, schema: object, parse: (raw: string) => T,
  ): Promise<AIResult<T>> {
    const started = performance.now();
    const model = cloudModel();
    let reply;
    try {
      reply = await generate({ prompt, schema, mode, cloudModel: model });
    } catch (e) {
      throw mapError(e);
    }
    const data = parse(reply.text);
    const label = reply.source === 'ON_DEVICE' ? DEVICE_MODEL_NAME : model;
    return result(data, { source: reply.source, mode, model: label }, started);
  }

  function resolveInput(input: Parameters<ClearBillAI['createRedactionDraft']>[0]): {
    text: string; provenance: BillProvenance; kind: BillKind;
  } {
    if (input.kind === 'sample') {
      if (!SAMPLE_IDS.includes(input.sampleId)) throw new ClearBillAIError('UNSUPPORTED_INPUT', false);
      return { text: SAMPLE_TEXTS[input.sampleId], provenance: 'sample', kind: 'itemized_bill' };
    }
    // Photo import is cut for the hackathon build: only text reaches the model.
    if (input.kind !== 'text' || typeof input.text !== 'string') throw new ClearBillAIError('UNSUPPORTED_INPUT', false);
    return { text: input.text, provenance: 'user', kind: detectBillKind(input.text) };
  }

  function draftResult(
    text: string, provenance: BillProvenance, kind: BillKind, entities: readonly RedactionEntity[], outcome: Outcome, started: number,
  ): AIResult<RedactionDraft> {
    const draft: RedactionDraft = Object.freeze({ provenance, kind, text, entities });
    drafts.add(draft);
    return result(draft, outcome, started);
  }

  return {
    getDeviceStatus: refreshDevice,
    subscribeDeviceStatus(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    prepareDeviceModel() {
      preparation ??= prepare().finally(() => { preparation = undefined; });
      return preparation;
    },
    async createRedactionDraft(input) {
      const { text, provenance, kind } = resolveInput(input);
      validateBillText(text, maxChars());
      const started = performance.now();
      const rules: Outcome = { source: 'LOCAL_RULES', mode: 'NONE', model: 'rules' };
      // Redaction never goes to the cloud: the on-device model or the rules, nothing else.
      if ((await refreshDevice()).state !== 'available') {
        return draftResult(text, provenance, kind, rulesEntities(text), rules, started);
      }
      try {
        const found = await run('ONLY_ON_DEVICE', redactPrompt(text), REDACTION_SCHEMA, (raw) => parseEntities(raw, text));
        if (found.source !== 'ON_DEVICE') throw new ClearBillAIError('UNKNOWN', true);
        const entities = mergeEntities(entitiesFromValues(text, found.data), rulesEntities(text));
        return draftResult(text, provenance, kind, entities, found, started);
      } catch (e) {
        const error = mapError(e);
        if (error.code === 'ABORTED') throw error;
        // A bad on-device reply must not end the demo: the rules still find the guarded identifiers.
        return draftResult(text, provenance, kind, rulesEntities(text), { ...rules, fellBack: true }, started);
      }
    },
    approveRedaction(draft, review): RedactionApproval {
      if (!drafts.has(draft)) throw new ClearBillAIError('UNSUPPORTED_INPUT', false);
      const { text, vault, guardAppliedCount, applied } = applyReview(draft.text, draft.entities, review);
      const bill = Object.freeze({
        redactedText: text, kind: draft.kind, provenance: draft.provenance, consentToCloud: Object.is(review.consentToCloud, true),
      }) as ApprovedBill;
      bills.add(bill);
      return Object.freeze({ applied: Object.freeze(applied), bill, vault: Object.freeze(vault), guardAppliedCount });
    },
    getCloudAvailability,
    async explainBill(bill) {
      const allowed = getCloudAvailability(bill).allowed;
      if (!allowed) await requireDevice();
      return run(allowed ? 'PREFER_ON_DEVICE' : 'ONLY_ON_DEVICE', explainPrompt(bill.redactedText), EXPLANATION_SCHEMA, parseExplanation);
    },
    async askQuestion(bill, question) {
      requireIssued(bill);
      if (typeof question !== 'string' || !question.trim()) throw new ClearBillAIError('UNSUPPORTED_INPUT', false);
      if (question.length > maxChars()) throw new ClearBillAIError('INPUT_TOO_LONG', false);
      await requireDevice();
      // Questions are free text from the user, so they never leave the device.
      return run('ONLY_ON_DEVICE', questionPrompt(bill.redactedText, question), ANSWER_SCHEMA, parseAnswer);
    },
    async auditBill(bill) {
      requireCloud(bill);
      return run('PREFER_IN_CLOUD', auditPrompt(bill.redactedText), AUDIT_SCHEMA, parseAudit);
    },
    async draftLetter(bill, audit: BillAudit, kind) {
      requireCloud(bill);
      if (!LETTER_KINDS.includes(kind) || !Array.isArray(audit.flags)) throw new ClearBillAIError('UNSUPPORTED_INPUT', false);
      return run('PREFER_IN_CLOUD', letterPrompt(bill.redactedText, audit.flags, kind), LETTER_SCHEMA, parseLetter);
    },
  };
}
