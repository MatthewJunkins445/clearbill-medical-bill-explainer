import { describe, expect, it } from 'vitest';
import type { ApprovedBill, DeviceModelState, DeviceStatus, RedactionDraft } from '../contract.ts';
import { ClearBillAIError } from '../contract.ts';
import { SAMPLE_TEXTS } from '../samples.ts';
import type { RemoteConfigReader } from '../../firebase/index.ts';
import { lockedCategories } from '../mock/redaction.ts';
import type { DeviceProbe } from './device.ts';
import type { GenerateRequest, GenerateResult } from './generate.ts';
import { createRealAI } from './index.ts';
import { ANSWER_SCHEMA, AUDIT_SCHEMA, EXPLANATION_SCHEMA, LETTER_SCHEMA, PROMPT_VERSION, REDACTION_SCHEMA } from './prompts.ts';

const sampleText = SAMPLE_TEXTS['itemized-er-laceration'];
const sample = { kind: 'sample', sampleId: 'itemized-er-laceration' } as const;
const pasted = (text: string) => ({ kind: 'text', text, origin: 'paste' } as const);

const replies = new Map<object, string>([
  [REDACTION_SCHEMA, JSON.stringify({ entities: [
    { category: 'PATIENT_NAME', value: 'Barnaby Fizzlewick' },
    { category: 'FACILITY_NAME', value: 'Nonesuch Valley General Hospital' },
    { category: 'PROVIDER_NAME', value: 'Dr. Hortense Noodleman' },
  ] })],
  [EXPLANATION_SCHEMA, JSON.stringify({
    summary: 'An ER visit.',
    lineItems: [{ lineIndex: 0, code: '99285', description: 'ER visit', charge: 2450, whatItIs: 'A visit.', whyCharged: 'You were seen.' }],
    totals: { billed: 4124, insurancePaid: 1855.8, adjustments: 1649.6, patientMayOwe: 618.6 },
  })],
  [ANSWER_SCHEMA, JSON.stringify({ answer: 'It is the vaccine line.' })],
  [AUDIT_SCHEMA, JSON.stringify({ flags: [
    { id: '1', severity: 'likely_error', title: 'Duplicate vaccine', why: 'Listed twice.', ask: 'Was it given twice?', lineIndexes: [2, 3] },
  ] })],
  [LETTER_SCHEMA, JSON.stringify({ text: 'Dear Billing Office,\n\nCould you review line 3?\n\nThank you.' })],
]);

type Reply = (req: GenerateRequest) => Partial<GenerateResult> | Promise<Partial<GenerateResult>>;

function fakeGenerate(reply?: Reply) {
  const calls: GenerateRequest[] = [];
  const generate = async (req: GenerateRequest): Promise<GenerateResult> => {
    calls.push(req);
    const source: GenerateResult['source'] = req.mode === 'PREFER_IN_CLOUD' ? 'IN_CLOUD' : 'ON_DEVICE';
    const base: GenerateResult = {
      text: replies.get(req.schema) ?? '{}', source, model: source === 'ON_DEVICE' ? 'gemini-nano' : req.cloudModel,
    };
    return { ...base, ...(reply ? await reply(req) : {}) };
  };
  return { generate, calls };
}

function fakeProbe(initial: DeviceModelState, after: DeviceModelState = 'available', progress: readonly number[] = [0.5, 1]) {
  let state = initial;
  let creates = 0;
  const probe: DeviceProbe = {
    availability: () => Promise.resolve(state),
    async create(onProgress) {
      creates += 1;
      for (const loaded of progress) onProgress(loaded);
      await Promise.resolve();
      state = after;
    },
  };
  return { probe, creates: () => creates, set: (next: DeviceModelState) => { state = next; } };
}

function reader(values: Record<string, boolean | string | number> = {}): RemoteConfigReader {
  const pick = <T,>(key: string, fallback: T): T => (key in values ? (values[key] as T) : fallback);
  return { fetched: true, getBoolean: pick, getString: pick, getNumber: pick };
}

const openCloud = { cloud_region_allowed: true, cloud_features_enabled: true };

function setup(options: {
  device?: DeviceModelState; config?: Record<string, boolean | string | number>; cloudReady?: boolean; reply?: Reply;
} = {}) {
  const gen = fakeGenerate(options.reply);
  const device = fakeProbe(options.device ?? 'available');
  const ai = createRealAI({
    generate: gen.generate, probe: device.probe, remoteConfig: reader(options.config ?? openCloud),
    cloudReady: options.cloudReady ?? true, now: () => 42,
  });
  return { ai, calls: gen.calls, device };
}

async function approved(ai: ReturnType<typeof createRealAI>, consentToCloud: boolean, input: Parameters<typeof ai.createRedactionDraft>[0] = sample) {
  const { data: draft } = await ai.createRedactionDraft(input);
  return ai.approveRedaction(draft, { added: [], removedIds: [], consentToCloud }).bill;
}

describe('createRedactionDraft', () => {
  it('redacts the sample on the device with one ONLY_ON_DEVICE call and keeps the rules entities', async () => {
    const { ai, calls } = setup();
    const result = await ai.createRedactionDraft(sample);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.mode).toBe('ONLY_ON_DEVICE');
    expect(calls[0]?.schema).toBe(REDACTION_SCHEMA);
    expect(calls[0]?.prompt).toContain('Barnaby Fizzlewick');
    expect(result).toMatchObject({ source: 'ON_DEVICE', mode: 'ONLY_ON_DEVICE', model: 'gemini-nano', fellBack: false, promptVersion: PROMPT_VERSION });
    expect(result.data).toMatchObject({ provenance: 'sample', kind: 'itemized_bill', text: sampleText });
    const categories = new Set(result.data.entities.map((entity) => entity.category));
    for (const category of ['PATIENT_NAME', 'FACILITY_NAME', 'PROVIDER_NAME']) expect(categories).toContain(category);
    // The locked guard categories the sample contains (it has no SSN) come from the rules side.
    for (const category of ['PHONE', 'EMAIL', 'MEMBER_ID', 'ACCOUNT_NUMBER', 'DOB']) expect(categories).toContain(category);
    expect(result.data.entities.filter((entity) => lockedCategories.has(entity.category)).every((entity) => entity.locked)).toBe(true);
    expect(Object.isFrozen(result.data)).toBe(true);
  });

  it.each(['unsupported', 'unavailable', 'downloadable', 'downloading'] as const)(
    'uses rules only with zero model calls when the device is %s', async (state) => {
      const { ai, calls } = setup({ device: state });
      const result = await ai.createRedactionDraft(sample);
      expect(calls).toHaveLength(0);
      expect(result).toMatchObject({ source: 'LOCAL_RULES', mode: 'NONE', model: 'rules', fellBack: false });
      expect(result.data.entities.some((entity) => entity.category === 'ACCOUNT_NUMBER')).toBe(true);
    });

  it.each([
    ['rejects', () => Promise.reject(new Error('device crashed'))],
    ['returns garbage', () => ({ text: 'not json at all' })],
  ] as const)('falls back to rules when the on-device call %s', async (_name, reply) => {
    const { ai, calls } = setup({ reply });
    const result = await ai.createRedactionDraft(sample);
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ source: 'LOCAL_RULES', mode: 'NONE', model: 'rules', fellBack: true });
    expect(result.data.entities.length).toBeGreaterThan(0);
  });

  it('surfaces an abort instead of falling back', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const { ai } = setup({ reply: () => Promise.reject(abort) });
    await expect(ai.createRedactionDraft(sample)).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('gives pasted text user provenance and detects its kind', async () => {
    const { ai } = setup({ device: 'unsupported' });
    const { data } = await ai.createRedactionDraft(pasted(sampleText));
    expect(data).toMatchObject({ provenance: 'user', kind: 'itemized_bill' });
    const eob = await ai.createRedactionDraft(pasted('EXPLANATION OF BENEFITS - THIS IS NOT A BILL\nPatient: A'));
    expect(eob.data.kind).toBe('eob');
  });

  it('rejects over-long input with zero model calls', async () => {
    const { ai, calls } = setup({ config: { ...openCloud, max_device_input_chars: 500 } });
    await expect(ai.createRedactionDraft(pasted('hospital charge line\n'.repeat(40)))).rejects.toMatchObject({ code: 'INPUT_TOO_LONG' });
    await expect(ai.createRedactionDraft(pasted('hospital ' + 'x'.repeat(600)))).rejects.toMatchObject({ code: 'INPUT_TOO_LONG' });
    await expect(ai.createRedactionDraft(sample)).rejects.toMatchObject({ code: 'INPUT_TOO_LONG' });
    expect(calls).toHaveLength(0);
  });

  it('uses the 16000 character fallback limit', async () => {
    const { ai, calls } = setup({ config: {} });
    await expect(ai.createRedactionDraft(pasted('hospital ' + 'x'.repeat(16_000)))).rejects.toMatchObject({ code: 'INPUT_TOO_LONG' });
    expect(calls).toHaveLength(0);
  });

  it('rejects empty, non-bill and image input with zero model calls', async () => {
    const { ai, calls } = setup();
    await expect(ai.createRedactionDraft(pasted('   '))).rejects.toMatchObject({ code: 'UNSUPPORTED_INPUT' });
    await expect(ai.createRedactionDraft(pasted('Electric utility statement, amount due 40.00'))).rejects.toMatchObject({ code: 'NOT_A_BILL' });
    await expect(ai.createRedactionDraft({ kind: 'image', blob: new Blob(['x']), mimeType: 'image/png' })).rejects.toMatchObject({ code: 'UNSUPPORTED_INPUT' });
    await expect(ai.createRedactionDraft({ kind: 'sample', sampleId: 'nope' as never })).rejects.toMatchObject({ code: 'UNSUPPORTED_INPUT' });
    expect(calls).toHaveLength(0);
  });

  it('never puts bill text in error messages', async () => {
    const { ai } = setup({ config: { ...openCloud, max_device_input_chars: 50 } });
    const secret = 'Patient Zebulon Quux hospital 123-45-6789';
    for (const text of [secret + ' '.repeat(60), 'Zebulon Quux was here']) {
      const error = await ai.createRedactionDraft(pasted(text)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ClearBillAIError);
      expect((error as Error).message).not.toContain('Zebulon');
    }
  });
});

describe('approveRedaction', () => {
  it('builds a frozen approval and treats consent strictly', async () => {
    const { ai } = setup();
    const { data: draft } = await ai.createRedactionDraft(sample);
    const approval = ai.approveRedaction(draft, { added: [], removedIds: [], consentToCloud: 'yes' as unknown as boolean });
    expect(approval.bill.consentToCloud).toBe(false);
    expect(Object.isFrozen(approval)).toBe(true);
    expect(Object.isFrozen(approval.bill)).toBe(true);
    expect(approval.bill.redactedText).not.toContain('NV81995635');
    expect(approval.bill.redactedText).not.toContain('Barnaby Fizzlewick');
    expect(approval.vault.rehydrate(approval.bill.redactedText)).toBe(sampleText);
    expect(approval.bill).toMatchObject({ provenance: 'sample', kind: 'itemized_bill' });
  });

  it('refuses a draft it did not create', async () => {
    const { ai } = setup();
    const { data: draft } = await ai.createRedactionDraft(sample);
    const forged: RedactionDraft = { ...draft };
    expect(() => ai.approveRedaction(forged, { added: [], removedIds: [], consentToCloud: true }))
      .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_INPUT' }));
  });
});

describe('getCloudAvailability', () => {
  it('refuses a forged ApprovedBill', async () => {
    const { ai } = setup();
    const bill = await approved(ai, true);
    const forged = { ...bill } as ApprovedBill;
    expect(() => ai.getCloudAvailability(forged)).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_INPUT' }));
    expect(() => setup().ai.getCloudAvailability(bill)).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_INPUT' }));
  });

  it('answers the pre-consent gate for a bare provenance', () => {
    expect(setup().ai.getCloudAvailability('sample')).toEqual({ allowed: false, reason: 'no_consent' });
    expect(setup().ai.getCloudAvailability('user')).toEqual({ allowed: false, reason: 'user_bill' });
    expect(setup({ config: {} }).ai.getCloudAvailability('sample')).toEqual({ allowed: false, reason: 'region' });
  });

  it('reads Remote Config at call time', async () => {
    const values: Record<string, boolean> = { ...openCloud };
    const ai = createRealAI({ generate: fakeGenerate().generate, probe: fakeProbe('available').probe, remoteConfig: reader(values), cloudReady: true });
    const bill = await approved(ai, true);
    expect(ai.getCloudAvailability(bill)).toEqual({ allowed: true });
    values['cloud_features_enabled'] = false;
    expect(ai.getCloudAvailability(bill)).toEqual({ allowed: false, reason: 'kill_switch' });
  });

  it('keeps any consented approval it issued eligible', async () => {
    const { ai } = setup();
    const { data: draft } = await ai.createRedactionDraft(sample);
    const first = ai.approveRedaction(draft, { added: [], removedIds: [], consentToCloud: true }).bill;
    const second = ai.approveRedaction(draft, { added: [], removedIds: [], consentToCloud: false }).bill;
    expect(ai.getCloudAvailability(first)).toEqual({ allowed: true });
    expect(ai.getCloudAvailability(second)).toEqual({ allowed: false, reason: 'no_consent' });
  });
});

describe('explainBill', () => {
  it('prefers the device when the cloud is allowed and labels the actual source', async () => {
    const { ai, calls } = setup();
    const bill = await approved(ai, true);
    calls.length = 0;
    const result = await ai.explainBill(bill);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ mode: 'PREFER_ON_DEVICE', schema: EXPLANATION_SCHEMA, cloudModel: 'gemini-3.8-flash' });
    expect(calls[0]?.prompt).toContain(bill.redactedText);
    expect(result).toMatchObject({ source: 'ON_DEVICE', mode: 'PREFER_ON_DEVICE', model: 'gemini-nano', fellBack: false });
    expect(result.data.summary).toBe('An ER visit.');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('labels a cloud answer to a PREFER_ON_DEVICE request as IN_CLOUD and fell back', async () => {
    const { ai } = setup({ config: { ...openCloud, cloud_model: 'gemini-test' }, reply: (req) => (req.mode === 'PREFER_ON_DEVICE' ? { source: 'IN_CLOUD' } : {}) });
    const result = await ai.explainBill(await approved(ai, true));
    expect(result).toMatchObject({ source: 'IN_CLOUD', mode: 'PREFER_ON_DEVICE', model: 'gemini-test', fellBack: true });
  });

  it('stays on the device without consent and needs a ready model', async () => {
    const { ai, calls, device } = setup();
    const bill = await approved(ai, false);
    calls.length = 0;
    await expect(ai.explainBill(bill)).resolves.toMatchObject({ mode: 'ONLY_ON_DEVICE', source: 'ON_DEVICE', fellBack: false });
    expect(calls[0]?.mode).toBe('ONLY_ON_DEVICE');
    device.set('downloadable');
    calls.length = 0;
    await expect(ai.explainBill(bill)).rejects.toMatchObject({ code: 'DEVICE_MODEL_NOT_READY', retryable: true });
    expect(calls).toHaveLength(0);
  });

  it('rejects malformed JSON as SCHEMA_PARSE_FAILED', async () => {
    const { ai } = setup({ reply: (req) => (req.schema === EXPLANATION_SCHEMA ? { text: '{"summary": 3' } : {}) });
    await expect(ai.explainBill(await approved(ai, true))).rejects.toMatchObject({ code: 'SCHEMA_PARSE_FAILED' });
  });

  it('maps generator errors', async () => {
    const quota = Object.assign(new Error('quota'), { code: 'fetch-error', customErrorData: { status: 429 } });
    const { ai } = setup({ reply: (req) => (req.schema === EXPLANATION_SCHEMA ? Promise.reject(quota) : {}) });
    await expect(ai.explainBill(await approved(ai, true))).rejects.toMatchObject({ code: 'QUOTA_OR_RATE_LIMIT' });
  });
});

describe('askQuestion', () => {
  it('always runs ONLY_ON_DEVICE even with the cloud open and consent given', async () => {
    const { ai, calls } = setup();
    const bill = await approved(ai, true);
    expect(ai.getCloudAvailability(bill)).toEqual({ allowed: true });
    calls.length = 0;
    const result = await ai.askQuestion(bill, 'What is line 3?');
    expect(calls.map((call) => call.mode)).toEqual(['ONLY_ON_DEVICE']);
    expect(calls[0]?.schema).toBe(ANSWER_SCHEMA);
    expect(result).toMatchObject({ source: 'ON_DEVICE', mode: 'ONLY_ON_DEVICE', data: { answer: 'It is the vaccine line.' } });
  });

  it('needs a ready model and a question', async () => {
    const { ai, calls, device } = setup();
    const bill = await approved(ai, true);
    calls.length = 0;
    await expect(ai.askQuestion(bill, '  ')).rejects.toMatchObject({ code: 'UNSUPPORTED_INPUT' });
    device.set('unsupported');
    await expect(ai.askQuestion(bill, 'Why?')).rejects.toMatchObject({ code: 'DEVICE_MODEL_NOT_READY' });
    expect(calls).toHaveLength(0);
  });
});

describe('auditBill and draftLetter cloud gate', () => {
  const blocked: [string, Parameters<typeof setup>[0], boolean, unknown][] = [
    ['a pasted copy of the sample', {}, true, { code: 'CLOUD_NOT_ALLOWED', cloudReason: 'user_bill' }],
    ['the sample without consent', {}, false, { code: 'CONSENT_REQUIRED', cloudReason: 'no_consent' }],
    ['the kill switch', { config: { ...openCloud, cloud_features_enabled: false } }, true, { code: 'KILL_SWITCH', cloudReason: 'kill_switch' }],
    ['a disallowed region', { config: { cloud_region_allowed: false } }, true, { code: 'CLOUD_NOT_ALLOWED', cloudReason: 'region' }],
    ['missing region config', { config: {} }, true, { code: 'CLOUD_NOT_ALLOWED', cloudReason: 'region' }],
    ['cloud not ready', { cloudReady: false }, true, { code: 'CLOUD_NOT_ALLOWED', cloudReason: 'region' }],
  ];

  it.each(blocked)('blocks %s with zero model calls', async (name, options, consent, expected) => {
    const { ai, calls } = setup(options);
    const bill = await approved(ai, consent, name === 'a pasted copy of the sample' ? pasted(sampleText) : sample);
    calls.length = 0;
    await expect(ai.auditBill(bill)).rejects.toMatchObject(expected as object);
    await expect(ai.draftLetter(bill, { flags: [] }, 'dispute')).rejects.toMatchObject(expected as object);
    expect(calls).toHaveLength(0);
  });

  it('runs the consented sample in the cloud once per call', async () => {
    const { ai, calls } = setup();
    const bill = await approved(ai, true);
    calls.length = 0;
    const audit = await ai.auditBill(bill);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ mode: 'PREFER_IN_CLOUD', schema: AUDIT_SCHEMA });
    expect(audit).toMatchObject({ source: 'IN_CLOUD', mode: 'PREFER_IN_CLOUD', model: 'gemini-3.8-flash', fellBack: false });
    expect(audit.data.flags[0]?.lineIndexes).toEqual([2, 3]);

    const letter = await ai.draftLetter(bill, audit.data, 'dispute');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ mode: 'PREFER_IN_CLOUD', schema: LETTER_SCHEMA });
    expect(calls[1]?.prompt).toContain('Duplicate vaccine');
    expect(letter.data.text).toContain('Dear Billing Office');
  });

  it('labels an on-device answer to a PREFER_IN_CLOUD request truthfully', async () => {
    const { ai } = setup({ reply: () => ({ source: 'ON_DEVICE' }) });
    const result = await ai.auditBill(await approved(ai, true));
    expect(result).toMatchObject({ source: 'ON_DEVICE', model: 'gemini-nano', fellBack: true });
  });

  it('rejects an unknown letter kind and forged bills without calls', async () => {
    const { ai, calls } = setup();
    const bill = await approved(ai, true);
    calls.length = 0;
    await expect(ai.draftLetter(bill, { flags: [] }, 'threat' as never)).rejects.toMatchObject({ code: 'UNSUPPORTED_INPUT' });
    await expect(ai.auditBill({ ...bill })).rejects.toMatchObject({ code: 'UNSUPPORTED_INPUT' });
    expect(calls).toHaveLength(0);
  });
});

describe('device status', () => {
  it('reports the probe state without starting a download', async () => {
    const { ai, device } = setup({ device: 'downloadable' });
    await expect(ai.getDeviceStatus()).resolves.toEqual({ state: 'downloadable', checkedAt: 42 });
    expect(device.creates()).toBe(0);
  });

  it('downloads on request, reports progress to subscribers and shares one in-flight call', async () => {
    const { ai, device } = setup({ device: 'downloadable' });
    const seen: DeviceStatus[] = [];
    const unsubscribe = ai.subscribeDeviceStatus((status) => seen.push(status));
    const first = ai.prepareDeviceModel();
    expect(ai.prepareDeviceModel()).toBe(first);
    await expect(first).resolves.toMatchObject({ state: 'available' });
    expect(device.creates()).toBe(1);
    expect(seen.filter((s) => s.progress !== undefined).map((s) => s.progress)).toEqual([0.5, 1]);
    expect(seen.at(-1)?.state).toBe('available');
    unsubscribe();
    const count = seen.length;
    device.set('unavailable');
    await ai.getDeviceStatus();
    expect(seen).toHaveLength(count);
  });

  it('returns an unsupported status from prepare without throwing or creating', async () => {
    const { ai, device } = setup({ device: 'unsupported' });
    await expect(ai.prepareDeviceModel()).resolves.toMatchObject({ state: 'unsupported' });
    expect(device.creates()).toBe(0);
  });

  it('re-probes and rejects with a mapped error when the download fails', async () => {
    const probe: DeviceProbe = { availability: () => Promise.resolve('downloadable'), create: () => Promise.reject(new Error('disk full')) };
    const ai = createRealAI({ generate: fakeGenerate().generate, probe, remoteConfig: reader(), cloudReady: false });
    const seen: DeviceStatus[] = [];
    ai.subscribeDeviceStatus((status) => seen.push(status));
    const error = await ai.prepareDeviceModel().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClearBillAIError);
    expect(error).toMatchObject({ code: 'UNKNOWN' });
    expect((error as Error).message).not.toContain('disk full');
    // The published state is the re-probed one (still downloadable, so the user can try again), not 'unavailable'.
    expect(seen.at(-1)?.state).toBe('downloadable');
    await expect(ai.getDeviceStatus()).resolves.toMatchObject({ state: 'downloadable' });
    // A later attempt is not stuck on the failed in-flight promise.
    await expect(ai.prepareDeviceModel()).rejects.toBeInstanceOf(ClearBillAIError);
  });

  it('resolves available when the download failed but the model is ready on re-probe', async () => {
    let state: DeviceModelState = 'downloadable';
    const probe: DeviceProbe = {
      availability: () => Promise.resolve(state),
      create: () => { state = 'available'; return Promise.reject(new Error('late')); },
    };
    const ai = createRealAI({ generate: fakeGenerate().generate, probe, remoteConfig: reader(), cloudReady: false });
    await expect(ai.prepareDeviceModel()).resolves.toMatchObject({ state: 'available' });
  });
});
