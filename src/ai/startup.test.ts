import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClearBillAI } from './contract.ts';
import type { GenerateRequest, GenerateResult } from './real/generate.ts';
import { UNAVAILABLE_PROBE, createFailClosedAI, startRealAI } from './startup.ts';
import type { RealLoader } from './startup.ts';

const sample = { kind: 'sample', sampleId: 'itemized-er-laceration' } as const;
const SECRET_KEY = 'AIzaSy-secret-config-value';

function spyGenerate() {
  const calls: GenerateRequest[] = [];
  const generate = (req: GenerateRequest): Promise<GenerateResult> => {
    calls.push(req);
    return Promise.reject(new Error('must not be called'));
  };
  return { generate, calls };
}

async function approve(ai: ClearBillAI, consentToCloud = true) {
  const { data } = await ai.createRedactionDraft(sample);
  return ai.approveRedaction(data, { added: [], removedIds: [], consentToCloud }).bill;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('createFailClosedAI (Firebase could not start)', () => {
  it('reports the device as unavailable', async () => {
    await expect(createFailClosedAI().getDeviceStatus()).resolves.toMatchObject({ state: 'unavailable' });
  });

  it('redacts with rules only, zero model calls and no fallback flag', async () => {
    const { generate, calls } = spyGenerate();
    const result = await createFailClosedAI(generate).createRedactionDraft(sample);
    expect(result).toMatchObject({ source: 'LOCAL_RULES', mode: 'NONE', model: 'rules', fellBack: false });
    expect(result.data.entities.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(0);
  });

  it('rejects device-only explain and questions as DEVICE_MODEL_NOT_READY before any call', async () => {
    const { generate, calls } = spyGenerate();
    const ai = createFailClosedAI(generate);
    const bill = await approve(ai, false);
    await expect(ai.explainBill(bill)).rejects.toMatchObject({ code: 'DEVICE_MODEL_NOT_READY', retryable: true });
    await expect(ai.askQuestion(bill, 'What is line 1?')).rejects.toMatchObject({ code: 'DEVICE_MODEL_NOT_READY', retryable: true });
    const consented = await approve(ai, true);
    await expect(ai.explainBill(consented)).rejects.toMatchObject({ code: 'DEVICE_MODEL_NOT_READY' });
    expect(calls).toHaveLength(0);
  });

  it('keeps the cloud closed for audit and letter with zero calls', async () => {
    const { generate, calls } = spyGenerate();
    const ai = createFailClosedAI(generate);
    const bill = await approve(ai, true);
    expect(ai.getCloudAvailability(bill)).toEqual({ allowed: false, reason: 'region' });
    await expect(ai.auditBill(bill)).rejects.toMatchObject({ code: 'CLOUD_NOT_ALLOWED', cloudReason: 'region' });
    await expect(ai.draftLetter(bill, { flags: [] }, 'dispute')).rejects.toMatchObject({ code: 'CLOUD_NOT_ALLOWED', cloudReason: 'region' });
    expect(calls).toHaveLength(0);
  });

  it('prepareDeviceModel resolves unavailable and never starts a download', async () => {
    const create = vi.spyOn(UNAVAILABLE_PROBE, 'create');
    await expect(createFailClosedAI().prepareDeviceModel()).resolves.toMatchObject({ state: 'unavailable' });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('startRealAI', () => {
  function loader(overrides: Partial<Awaited<ReturnType<RealLoader>>> = {}): { load: RealLoader; createGenerate: ReturnType<typeof vi.fn> } {
    const createGenerate = vi.fn(() => spyGenerate().generate);
    const load: RealLoader = () => Promise.resolve({
      createGenerate,
      createDeviceProbe: () => ({ availability: () => Promise.resolve('available' as const), create: () => Promise.resolve() }),
      initializeFirebase: () => Promise.reject(Object.assign(new Error('Missing client config: ' + SECRET_KEY), { name: 'ConfigError' })),
      ...overrides,
    });
    return { load, createGenerate };
  }

  it('falls back fail-closed when initializeFirebase rejects, logging only the error name', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { load, createGenerate } = loader();
    const ai = await startRealAI(load);
    await expect(ai.getDeviceStatus()).resolves.toMatchObject({ state: 'unavailable' });
    await expect(ai.createRedactionDraft(sample)).resolves.toMatchObject({ source: 'LOCAL_RULES', fellBack: false });
    expect(createGenerate).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    const logged = log.mock.calls[0]?.map(String).join(' ') ?? '';
    expect(logged).toContain('ConfigError');
    expect(logged).not.toContain(SECRET_KEY);
    expect(logged).not.toContain('Barnaby');
    expect(log.mock.calls[0]?.every((arg) => typeof arg === 'string')).toBe(true);
  });

  it('falls back when the real modules cannot load', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ai = await startRealAI(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
    await expect(ai.getDeviceStatus()).resolves.toMatchObject({ state: 'unavailable' });
    await expect(ai.createRedactionDraft(sample)).resolves.toMatchObject({ source: 'LOCAL_RULES' });
    expect(log.mock.calls[0]?.map(String).join(' ')).toContain('TypeError');
  });

  it('wires the real runtime when Firebase starts', async () => {
    const { load, createGenerate } = loader({
      initializeFirebase: () => Promise.resolve({
        app: {} as never, auth: {} as never, appCheckReady: true, authReady: true, cloudReady: true,
        remoteConfig: { fetched: true, getBoolean: (_k, f) => f, getString: (_k, f) => f, getNumber: (_k, f) => f },
      }),
    });
    const ai = await startRealAI(load);
    expect(createGenerate).toHaveBeenCalledTimes(1);
    await expect(ai.getDeviceStatus()).resolves.toMatchObject({ state: 'available' });
  });
});
