import { PII_CATEGORIES } from '../contract.ts';
import type { LocalVault, PiiCategory, RedactionEntity, RedactionReview, TextRange } from '../contract.ts';
import type { BillFixture } from './fixtures.ts';

export const guardPatterns = {
  SSN: /\b(\d{3}[- ]\d{2}[- ]\d{4}|XXX[- ]XX[- ]\d{4})\b/gi,
  PHONE: /(?:\+?1[- .]?)?(?:\(\d{3}\)\s*|\b\d{3}[- .])\d{3}[- .]\d{4}\b/g,
  EMAIL: /[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/gi,
  MEMBER_ID: /\b(?:member|subscriber)[ \t]+(?:id|number|no\.?)[ \t]*:?[ \t]*([a-z0-9-]*\d[a-z0-9-]*)/gi,
  ACCOUNT_NUMBER: /\b(?:account|acct)(?:[ \t]+(?:number|no\.?|id))?[ \t]*:?[ \t]*([a-z0-9-]*\d[a-z0-9-]*)/gi,
  DOB: /\b(?:dob|date of birth|birth date)[ \t]*:?[ \t]*(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}-[a-z]{3}-\d{4}|[a-z]{3,9} +\d{1,2},? +\d{4}|\d{8})\b/gi,
} satisfies Partial<Record<PiiCategory, RegExp>>;
// The six categories the guard always redacts, derived from guardPatterns so they cannot drift.
export const lockedCategories: ReadonlySet<PiiCategory> = new Set<PiiCategory>(Object.keys(guardPatterns) as (keyof typeof guardPatterns)[]);
const locked = lockedCategories;

export type Candidate = Pick<RedactionEntity, 'category' | 'value' | 'occurrences'>;

// shortcut: common fixture identifier formats, replace with the full redaction rules in W6.
export function rules(text: string, fixture?: BillFixture): Candidate[] {
  const result: Candidate[] = [];
  for (const category of Object.keys(guardPatterns) as (keyof typeof guardPatterns)[]) {
    for (const match of text.matchAll(guardPatterns[category])) {
      const value = match[1] ?? match[0];
      const start = match.index + match[0].lastIndexOf(value);
      if (fixture?.pii.some((item) => !item.mustRedact && item.category === category &&
        item.occurrences.some((span) => span.start === start && span.end === start + value.length))) continue;
      result.push({ category, value, occurrences: [{ start, end: start + value.length }] });
    }
  }
  return result;
}

export function redactionEntities(text: string, fixture: BillFixture | undefined, onDevice: boolean): readonly RedactionEntity[] {
  const matches = [
    ...(onDevice ? fixture?.pii.filter((item) => item.mustRedact) ?? [] : []),
    ...rules(text, fixture),
  ];
  const groups = new Map<string, RedactionEntity>();
  for (const { category, value, occurrences } of matches) {
    const key = category + '\0' + value;
    const previous = groups.get(key);
    const spans = [...(previous?.occurrences ?? [])];
    for (const span of occurrences) {
      if (!spans.some(({ start, end }) => start === span.start && end === span.end)) spans.push(Object.freeze({ ...span }));
    }
    groups.set(key, Object.freeze({
      id: previous?.id ?? String(groups.size + 1), category, value, occurrences: Object.freeze(spans),
      selected: true, locked: locked.has(category),
    }));
  }
  return Object.freeze([...groups.values()]);
}

export function findOccurrences(text: string, value: string): TextRange[] {
  const matches: TextRange[] = [];
  for (let start = text.indexOf(value); start !== -1; start = text.indexOf(value, start + value.length)) {
    matches.push({ start, end: start + value.length });
  }
  return matches;
}

export function applyReview(
  text: string, entities: readonly RedactionEntity[], review: RedactionReview, fixture?: BillFixture,
): { text: string; vault: LocalVault; guardAppliedCount: number; applied: import('../contract.ts').AppliedRedaction[] } {
  const kept = new Set(review.removedIds);
  const manuallyAdded = review.added.flatMap(({ category, value }) =>
    value && PII_CATEGORIES.includes(category) ? [{ category, value, occurrences: findOccurrences(text, value) }] : [],
  );
  const spans = [...entities.filter((entity) => entity.locked || !kept.has(entity.id)), ...manuallyAdded, ...rules(text, fixture)]
    .flatMap(({ category, occurrences }) => occurrences.map((range) => ({ ...range, category })))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const ranges: typeof spans = [];
  for (const span of spans) {
    const previous = ranges.at(-1);
    if (previous && span.start < previous.end) {
      previous.end = Math.max(previous.end, span.end);
    } else {
      ranges.push(span);
    }
  }

  const counts = new Map<PiiCategory, number>();
  const originals = new Map<string, string>();
  const placeholders = new Map<string, string>();
  let cursor = 0;
  let redacted = '';
  const applied: import('../contract.ts').AppliedRedaction[] = [];
  for (const { start, end, category } of ranges) {
    const original = text.slice(start, end);
    const key = category + '\0' + original;
    let token = placeholders.get(key);
    if (!token) {
      let count = counts.get(category) ?? 0;
      do { token = '[' + category + '_' + String(++count) + ']'; } while (text.includes(token));
      counts.set(category, count);
      placeholders.set(key, token);
      originals.set(token, original);
    }
    redacted += text.slice(cursor, start);
    applied.push({ category, placeholder: token, sourceRange: { start, end },
      redactedRange: { start: redacted.length, end: redacted.length + token.length } });
    redacted += token;
    cursor = end;
  }
  const vault: LocalVault = {
    rehydrate: (value) => value.replace(/\[[A-Z_]+_\d+\]/g, (token) => originals.get(token) ?? token),
  };
  return {
    text: redacted + text.slice(cursor),
    vault,
    applied,
    guardAppliedCount: entities.filter((entity) => entity.locked && kept.has(entity.id)).length,
  };
}
