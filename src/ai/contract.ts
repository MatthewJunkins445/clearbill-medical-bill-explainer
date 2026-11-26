export const INFERENCE_SOURCES = ['ON_DEVICE', 'IN_CLOUD'] as const;
export type InferenceSource = (typeof INFERENCE_SOURCES)[number];
export const RESULT_SOURCES = [...INFERENCE_SOURCES, 'LOCAL_RULES'] as const;
export type ResultSource = (typeof RESULT_SOURCES)[number];
export const AI_MODES = ['ONLY_ON_DEVICE', 'PREFER_ON_DEVICE', 'PREFER_IN_CLOUD', 'NONE'] as const;
export type AIMode = (typeof AI_MODES)[number];
export const DEVICE_MODEL_STATES = ['unsupported', 'unavailable', 'downloadable', 'downloading', 'available'] as const;
export type DeviceModelState = (typeof DEVICE_MODEL_STATES)[number];
export const AI_ERROR_CODES = [
  'DEVICE_MODEL_NOT_READY', 'INPUT_TOO_LONG', 'NOT_A_BILL', 'UNSUPPORTED_INPUT', 'CONSENT_REQUIRED',
  'SCHEMA_PARSE_FAILED', 'SAFETY_BLOCKED', 'QUOTA_OR_RATE_LIMIT', 'APP_CHECK_FAILED', 'NETWORK',
  'KILL_SWITCH', 'ABORTED', 'UNKNOWN', 'CLOUD_NOT_ALLOWED',
] as const;
export type AIErrorCode = (typeof AI_ERROR_CODES)[number];
export const PII_CATEGORIES = [
  'PATIENT_NAME', 'PERSON_NAME', 'PROVIDER_NAME', 'FACILITY_NAME', 'DOB', 'ADDRESS', 'PHONE',
  'EMAIL', 'SSN', 'MEMBER_ID', 'ACCOUNT_NUMBER', 'DIAGNOSIS', 'OTHER_ID',
] as const;
export type PiiCategory = (typeof PII_CATEGORIES)[number];
export const BILL_PROVENANCES = ['sample', 'user'] as const;
export type BillProvenance = (typeof BILL_PROVENANCES)[number];
export const BILL_KINDS = ['itemized_bill', 'eob', 'summary_statement'] as const;
export type BillKind = (typeof BILL_KINDS)[number];
export const CLOUD_BLOCK_REASONS = ['kill_switch', 'region', 'user_bill', 'no_consent'] as const;
export type CloudBlockReason = (typeof CLOUD_BLOCK_REASONS)[number];
export const SAMPLE_IDS = ['itemized-er-laceration'] as const;
export type SampleId = (typeof SAMPLE_IDS)[number];
export const TEXT_ORIGINS = ['paste', 'pdf'] as const;
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png'] as const;
export const AUDIT_SEVERITIES = ['likely_error', 'worth_asking'] as const;
export const LETTER_KINDS = ['itemized', 'dispute', 'appeal'] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];

export interface DeviceStatus {
  readonly state: DeviceModelState;
  readonly progress?: number;
  readonly detail?: string;
  readonly checkedAt: number;
}

export interface AIResult<T> {
  readonly data: T;
  readonly source: ResultSource;
  readonly model: string;
  readonly mode: AIMode;
  readonly latencyMs: number;
  readonly fellBack: boolean;
  readonly promptVersion: string;
}

export class ClearBillAIError extends Error {
  override readonly name = 'ClearBillAIError';

  constructor(
    readonly code: AIErrorCode,
    readonly retryable: boolean,
    readonly cloudReason?: CloudBlockReason,
  ) {
    super(code);
  }
}

export type BillInput =
  | { readonly kind: 'text'; readonly text: string; readonly origin: (typeof TEXT_ORIGINS)[number] }
  | { readonly kind: 'image'; readonly blob: Blob; readonly mimeType: (typeof IMAGE_MIME_TYPES)[number] }
  | { readonly kind: 'sample'; readonly sampleId: SampleId };

export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export interface RedactionValue {
  readonly category: PiiCategory;
  readonly value: string;
}

export interface RedactionEntity extends RedactionValue {
  readonly id: string;
  readonly occurrences: readonly TextRange[];
  readonly selected: boolean;
  readonly locked: boolean;
}

export interface RedactionDraft {
  readonly provenance: BillProvenance;
  readonly kind: BillKind;
  readonly text: string;
  readonly entities: readonly RedactionEntity[];
}

export interface RedactionReview {
  readonly added: readonly RedactionValue[];
  readonly removedIds: readonly string[];
  readonly consentToCloud: boolean;
}

declare const approvedBillBrand: unique symbol;
export interface ApprovedBill {
  readonly [approvedBillBrand]: true;
  readonly provenance: BillProvenance;
  readonly kind: BillKind;
  readonly redactedText: string;
  readonly consentToCloud: boolean;
}

export interface LocalVault {
  rehydrate(text: string): string;
}

export interface AppliedRedaction {
  readonly category: PiiCategory;
  readonly placeholder: string;
  readonly sourceRange: TextRange;
  readonly redactedRange: TextRange;
}

export interface RedactionApproval {
  readonly applied: readonly AppliedRedaction[];
  readonly bill: ApprovedBill;
  readonly vault: LocalVault;
  readonly guardAppliedCount: number;
}

export type CloudAvailability = { readonly allowed: true } | { readonly allowed: false; readonly reason: CloudBlockReason };

export interface LineExplanation {
  readonly lineIndex: number;
  readonly code: string | null;
  readonly description: string;
  readonly charge: number;
  readonly whatItIs: string;
  readonly whyCharged: string;
}

export interface BillExplanation {
  readonly summary: string;
  readonly lineItems: readonly LineExplanation[];
  readonly totals: {
    readonly billed: number | null;
    readonly insurancePaid: number | null;
    readonly adjustments: number | null;
    readonly patientMayOwe: number | null;
  };
}

export interface QuestionAnswer {
  readonly answer: string;
}

export interface AuditFlag {
  readonly id: string;
  readonly severity: (typeof AUDIT_SEVERITIES)[number];
  readonly title: string;
  readonly why: string;
  readonly ask: string;
  // Zero-based source bill indexes, matching LineExplanation.lineIndex.
  readonly lineIndexes: readonly number[];
}

export interface BillAudit {
  readonly flags: readonly AuditFlag[];
}

export interface LetterDraft {
  readonly text: string;
}

export interface ClearBillAI {
  // Refresh availability without starting a download.
  getDeviceStatus(): Promise<DeviceStatus>;
  subscribeDeviceStatus(listener: (status: DeviceStatus) => void): () => void;
  prepareDeviceModel(): Promise<DeviceStatus>;
  createRedactionDraft(input: BillInput): Promise<AIResult<RedactionDraft>>;
  approveRedaction(draft: RedactionDraft, review: RedactionReview): RedactionApproval;
  getCloudAvailability(target: ApprovedBill | BillProvenance): CloudAvailability;
  explainBill(bill: ApprovedBill): Promise<AIResult<BillExplanation>>;
  askQuestion(bill: ApprovedBill, question: string): Promise<AIResult<QuestionAnswer>>;
  auditBill(bill: ApprovedBill): Promise<AIResult<BillAudit>>;
  draftLetter(bill: ApprovedBill, audit: BillAudit, kind: LetterKind): Promise<AIResult<LetterDraft>>;
}
