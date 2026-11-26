import { AUDIT_SEVERITIES, ClearBillAIError, PII_CATEGORIES } from '../contract.ts';
import type {
  AuditFlag, BillAudit, BillExplanation, LetterDraft, LineExplanation, PiiCategory, QuestionAnswer, RedactionValue,
} from '../contract.ts';

type Json = Record<string, unknown>;

function fail(): never {
  throw new ClearBillAIError('SCHEMA_PARSE_FAILED', true);
}

// Tolerates one fenced json block around the reply, nothing else.
function parseJson(raw: string): unknown {
  if (typeof raw !== 'string') return fail();
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i.exec(trimmed);
  try {
    return JSON.parse(fenced?.[1] ?? trimmed);
  } catch {
    return fail();
  }
}

function object(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : fail();
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : fail();
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : fail();
}

function nonEmptyString(value: unknown): string {
  const text = string(value);
  return text.trim() ? text : fail();
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fail();
}

function nullableFinite(value: unknown): number | null {
  return value === null ? null : finite(value);
}

function index(value: unknown): number {
  const n = finite(value);
  return Number.isInteger(n) && n >= 0 ? n : fail();
}

const isCategory = (value: unknown): value is PiiCategory => PII_CATEGORIES.includes(value as PiiCategory);

export function parseEntities(raw: string, text: string): RedactionValue[] {
  const entries = array(object(parseJson(raw))['entities']);
  const seen = new Set<string>();
  const result: RedactionValue[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { category, value } = entry as Json;
    if (!isCategory(category) || typeof value !== 'string' || !value.trim() || !text.includes(value)) continue;
    const key = category + '\0' + value;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ category, value });
  }
  return result;
}

export function parseExplanation(raw: string): BillExplanation {
  const root = object(parseJson(raw));
  const lineItems = array(root['lineItems']).map((item): LineExplanation => {
    const line = object(item);
    return {
      lineIndex: index(line['lineIndex']),
      code: line['code'] === null ? null : string(line['code']),
      description: string(line['description']),
      charge: finite(line['charge']),
      whatItIs: string(line['whatItIs']),
      whyCharged: string(line['whyCharged']),
    };
  });
  const totals = object(root['totals']);
  return {
    summary: string(root['summary']),
    lineItems,
    totals: {
      billed: nullableFinite(totals['billed']),
      insurancePaid: nullableFinite(totals['insurancePaid']),
      adjustments: nullableFinite(totals['adjustments']),
      patientMayOwe: nullableFinite(totals['patientMayOwe']),
    },
  };
}

export function parseAudit(raw: string): BillAudit {
  const flags = array(object(parseJson(raw))['flags']).map((item): AuditFlag => {
    const flag = object(item);
    const severity = AUDIT_SEVERITIES.find((candidate) => candidate === flag['severity']) ?? fail();
    return {
      id: string(flag['id']),
      severity,
      title: string(flag['title']),
      why: string(flag['why']),
      ask: string(flag['ask']),
      lineIndexes: array(flag['lineIndexes']).map(index),
    };
  });
  // Flag ids key the UI's selection and the letter: drop empty ids and keep only the first of a duplicate id.
  const seen = new Set<string>();
  return {
    flags: flags.filter(({ id }) => {
      if (!id.trim() || seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  };
}

export function parseLetter(raw: string): LetterDraft {
  return { text: nonEmptyString(object(parseJson(raw))['text']) };
}

export function parseAnswer(raw: string): QuestionAnswer {
  return { answer: nonEmptyString(object(parseJson(raw))['answer']) };
}
