import { afterEach, describe, expect, it, vi } from 'vitest';
import sampleText from '../../../samples/bills/itemized-er-laceration/bill.txt?raw';
import sampleTruth from '../../../samples/bills/itemized-er-laceration/ground-truth.json';
import schema from '../../../samples/schema/ground-truth.schema.json';
import { PII_CATEGORIES, SAMPLE_IDS, createClearBillAI } from '../index.ts';
import type { ApprovedBill, BillInput, LetterKind, RedactionDraft } from '../contract.ts';
import { createMockAI } from './index.ts';

const sample: BillInput = { kind: 'sample', sampleId: SAMPLE_IDS[0] };

async function approve(ai: ReturnType<typeof createMockAI>, input = sample, consentToCloud = true) {
  const { data: draft } = await ai.createRedactionDraft(input);
  return {
    draft,
    ...ai.approveRedaction(draft, { added: [], removedIds: [], consentToCloud }),
  };
}

describe('W5 mock privacy boundary', () => {
  it('keeps a pasted copy of the synthetic sample on-device regardless of consent', async () => {
    const ai = createMockAI({ config: { cloudRegionAllowed: true } });
    const { bill } = await approve(ai, { kind: 'text', text: sampleText, origin: 'paste' });
    expect(bill.provenance).toBe('user');
    expect(ai.getCloudAvailability(bill)).toEqual({ allowed: false, reason: 'user_bill' });
    await expect(ai.explainBill(bill)).resolves.toMatchObject({ mode: 'ONLY_ON_DEVICE' });
    await expect(ai.askQuestion(bill, 'Explain this charge.')).resolves.toMatchObject({ mode: 'ONLY_ON_DEVICE' });
    await expect(ai.auditBill(bill)).rejects.toMatchObject({ code: 'CLOUD_NOT_ALLOWED', cloudReason: 'user_bill' });
    await expect(ai.draftLetter(bill, { flags: [] }, 'dispute')).rejects.toMatchObject({
      code: 'CLOUD_NOT_ALLOWED', cloudReason: 'user_bill',
    });
    expect(ai.cloudPayloads).toEqual([]);
  });

  it('fails closed without region configuration and reevaluates gate precedence at call time', async () => {
    const config = { killSwitch: false, cloudRegionAllowed: false };
    const ai = createMockAI({ config });
    const { bill, draft } = await approve(ai, sample, false);
    expect(createMockAI().getCloudAvailability('sample')).toEqual({ allowed: false, reason: 'region' });
    expect(ai.getCloudAvailability('user')).toEqual({ allowed: false, reason: 'region' });
    await expect(ai.auditBill(bill)).rejects.toMatchObject({ code: 'CLOUD_NOT_ALLOWED', cloudReason: 'region' });
    await expect(ai.draftLetter(bill, { flags: [] }, 'dispute')).rejects.toMatchObject({ cloudReason: 'region' });
    config.killSwitch = true;
    await expect(ai.auditBill(bill)).rejects.toMatchObject({ code: 'KILL_SWITCH', cloudReason: 'kill_switch' });
    config.killSwitch = false;
    config.cloudRegionAllowed = true;
    expect(ai.getCloudAvailability('sample')).toEqual({ allowed: true });
    await expect(ai.auditBill(bill)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED', cloudReason: 'no_consent' });

    const approved = ai.approveRedaction(draft, { added: [], removedIds: [], consentToCloud: true }).bill;
    expect(ai.getCloudAvailability(approved)).toEqual({ allowed: true });
    ai.approveRedaction(draft, { added: [], removedIds: [], consentToCloud: false });
    await expect(ai.auditBill(approved)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED', cloudReason: 'no_consent' });
    expect(ai.cloudPayloads).toEqual([]);
  });

  it.each(['available', 'unavailable'] as const)('keeps free-form questions device-only with the model %s', async (state) => {
    const ai = createMockAI({ config: { cloudRegionAllowed: true }, deviceStates: [state] });
    const { bill } = await approve(ai);
    expect(ai.getCloudAvailability(bill)).toEqual({ allowed: true });
    const answer = ai.askQuestion(bill, 'I received care for a private condition. Which charge is for that visit?');
    if (state === 'available') {
      await expect(answer).resolves.toMatchObject({ mode: 'ONLY_ON_DEVICE', source: 'ON_DEVICE', fellBack: false });
      expect(Object.keys((await answer).data)).toEqual(['answer']);
    } else {
      await expect(answer).rejects.toMatchObject({ code: 'DEVICE_MODEL_NOT_READY' });
    }
    expect(ai.cloudPayloads).toEqual([]);
  });

  it('observes only approved redacted sample text and canonical flag IDs', async () => {
    const ai = createMockAI({ config: { cloudRegionAllowed: true } });
    const { bill, vault, applied } = await approve(ai);
    expect(vault.rehydrate(bill.redactedText)).toBe(sampleText);
    expect(applied.length).toBeGreaterThan(0);
    for (const { placeholder, sourceRange, redactedRange } of applied) {
      expect(bill.redactedText.slice(redactedRange.start, redactedRange.end)).toBe(placeholder);
      expect(vault.rehydrate(placeholder)).toBe(sampleText.slice(sourceRange.start, sourceRange.end));
    }
    await expect(ai.draftLetter(bill, { flags: [] }, 'invalid' as LetterKind))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_INPUT' });
    expect(ai.cloudPayloads).toEqual([]);
    const explanation = await ai.explainBill(bill);
    expect(explanation).toMatchObject({ mode: 'PREFER_ON_DEVICE', source: 'ON_DEVICE' });
    expect(explanation.data.lineItems.map(({ code, charge }) => ({ code, charge }))).toEqual(
      sampleTruth.lineItems.map(({ code, charge }) => ({ code, charge })),
    );
    const audit = await ai.auditBill(bill);
    expect(audit.data.flags).toHaveLength(sampleTruth.plantedIssues.length);
    const flags = audit.data.flags.slice(0, 1).map((flag) => ({ ...flag, why: 'editable note with private details' }));
    const letter = await ai.draftLetter(bill, { flags }, 'dispute');
    expect(letter.data.text).toContain('[ACCOUNT_NUMBER_1]');
    expect(letter.data.text).not.toContain('editable note');
    expect(ai.cloudPayloads).toEqual([
      { operation: 'explainBill', mode: 'PREFER_ON_DEVICE', text: bill.redactedText },
      { operation: 'auditBill', mode: 'PREFER_IN_CLOUD', text: bill.redactedText },
      { operation: 'draftLetter', mode: 'PREFER_IN_CLOUD', text: bill.redactedText, flagIds: ['1'], letterKind: 'dispute' },
    ]);
    for (const { value } of sampleTruth.pii.filter((item) => item.mustRedact)) {
      expect(bill.redactedText).not.toContain(value);
    }
  });

  it('rejects forged or cross-instance approvals and prevents changing sample provenance or text', async () => {
    const ai = createMockAI({ config: { cloudRegionAllowed: true } });
    const { bill, draft } = await approve(ai);
    const forgedDraft = { ...draft, text: 'Some private health information' } satisfies RedactionDraft;
    expect(() => ai.approveRedaction(forgedDraft, { added: [], removedIds: [], consentToCloud: true }))
      .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_INPUT' }));
    const forgedBill = { ...bill, redactedText: 'Some private health information' } satisfies ApprovedBill;
    await expect(ai.auditBill(forgedBill)).rejects.toMatchObject({ code: 'UNSUPPORTED_INPUT' });
    await expect(createMockAI().auditBill(bill)).rejects.toMatchObject({ code: 'UNSUPPORTED_INPUT' });
    expect(ai.cloudPayloads).toEqual([]);
  });
});

describe('W5 mock redaction and device scenarios', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('exposes agreed PII categories through the dev factory and keeps removable spans reversible', async () => {
    expect(PII_CATEGORIES).toEqual(schema.$defs.pii.properties.category.enum);
    // The factory returns the mock only when it is requested in a dev or test run.
    vi.stubEnv('VITE_AI_MODE', 'mock');
    const ai = await createClearBillAI();
    const { data: draft } = await ai.createRedactionDraft(sample);
    const removedIds = draft.entities.filter((item) => item.category === 'PATIENT_NAME' || item.category === 'SSN' ||
      item.category === 'ACCOUNT_NUMBER').map((item) => item.id);
    const { bill, vault, guardAppliedCount } = ai.approveRedaction(draft, {
      added: [{ category: 'OTHER_ID', value: 'Insurance' }], removedIds, consentToCloud: false,
    });
    expect(bill.redactedText).toContain('Barnaby Fizzlewick');
    expect(bill.redactedText).not.toContain('NV81995635');
    expect(guardAppliedCount).toBe(1);
    expect(vault.rehydrate(bill.redactedText)).toBe(sampleText);
  });

  it('uses rules while a mock download is scheduled and updates subscribers deterministically', async () => {
    const ai = createMockAI({ deviceStates: ['downloadable', 'downloading', 'available'], downloadProgress: [0.25, 1] });
    const progress: number[] = [];
    const unsubscribe = ai.subscribeDeviceStatus((status) => {
      if (status.progress !== undefined) progress.push(status.progress);
    });
    const download = ai.prepareDeviceModel();
    expect(ai.prepareDeviceModel()).toBe(download);
    await expect(ai.createRedactionDraft(sample)).resolves.toMatchObject({ mode: 'NONE', source: 'LOCAL_RULES' });
    await expect(download).resolves.toMatchObject({ state: 'available', checkedAt: 4 });
    expect(progress).toEqual([0.25, 1]);
    unsubscribe();
    await expect(ai.createRedactionDraft(sample)).resolves.toMatchObject({ source: 'ON_DEVICE' });
  });
});
