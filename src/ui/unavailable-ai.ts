import { ClearBillAIError, type ClearBillAI } from '../ai/index.ts';

/** Stand-in used when the real AI could not be created: every call fails with UNKNOWN. */
export function unavailableAI(): ClearBillAI {
  const fail = (): never => {
    throw new ClearBillAIError('UNKNOWN', false);
  };
  const failAsync = (): Promise<never> => Promise.reject(new ClearBillAIError('UNKNOWN', false));
  return {
    getDeviceStatus: failAsync,
    subscribeDeviceStatus: () => () => undefined,
    prepareDeviceModel: failAsync,
    createRedactionDraft: failAsync,
    approveRedaction: fail,
    getCloudAvailability: fail,
    explainBill: failAsync,
    askQuestion: failAsync,
    auditBill: failAsync,
    draftLetter: failAsync,
  };
}
