import { ClearBillAIError } from '../contract.ts';
import type { BillKind } from '../contract.ts';

/** The same medical wording check the mock uses, so both backends agree on what is bill-like. */
const MEDICAL_WORDING = /\b(?:hospital|medical|eob|benefits|patient|insurance|cpt)\b/i;
const EOB_WORDING = /\bexplanation of benefits\b|\bthis is not a bill\b/i;
// "itemized statement" and "amount due" also appear on itemized bills, so a summary needs summary wording.
const SUMMARY_WORDING = /\b(?:account summary|summary statement|statement summary|final notice)\b/i;

/** A light heuristic for pasted text. The built-in sample's kind is known and does not use it. */
export function detectBillKind(text: string): BillKind {
  if (EOB_WORDING.test(text)) return 'eob';
  if (SUMMARY_WORDING.test(text)) return 'summary_statement';
  return 'itemized_bill';
}

/**
 * Checks run before any model call, in this order: empty, too long (in total or on one line), not bill-like.
 * Errors carry only a code, never the text.
 */
export function validateBillText(text: string, maxChars: number): void {
  if (!text.trim()) throw new ClearBillAIError('UNSUPPORTED_INPUT', false);
  if (text.length > maxChars || text.split(/\r?\n/).some((line) => line.length > maxChars)) {
    throw new ClearBillAIError('INPUT_TOO_LONG', false);
  }
  if (!MEDICAL_WORDING.test(text)) throw new ClearBillAIError('NOT_A_BILL', false);
}
