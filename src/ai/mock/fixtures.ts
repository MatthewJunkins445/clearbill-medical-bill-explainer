import type { BillKind, RedactionEntity } from '../contract.ts';

interface FixtureGroundTruth {
  readonly id: string;
  readonly synthetic: true;
  readonly kind: BillKind | 'not_medical';
  readonly files: { readonly image?: string };
  readonly pii: readonly (Pick<RedactionEntity, 'category' | 'value' | 'occurrences'> & { readonly mustRedact: boolean })[];
  readonly lineItems: readonly { readonly code: string; readonly description: string; readonly charge: number }[];
  readonly totals: {
    readonly charges: number;
    readonly insurancePaid: number;
    readonly adjustments: number;
    readonly patientResponsibility: number;
  } | null;
  readonly plantedIssues: readonly {
    readonly type: string;
    readonly lineIndexes: readonly number[];
    readonly note: string;
  }[];
}

export interface BillFixture extends FixtureGroundTruth {
  readonly text: string;
}

const texts = import.meta.glob<string>('../../../samples/bills/*/bill.txt', {
  eager: true,
  import: 'default',
  query: '?raw',
});
const groundTruth = import.meta.glob<FixtureGroundTruth>('../../../samples/bills/*/ground-truth.json', {
  eager: true,
  import: 'default',
});

export const fixtures = Object.entries(groundTruth).map(([path, truth]): BillFixture => {
  const text = texts[path.replace('ground-truth.json', 'bill.txt')];
  if (!truth.synthetic || text === undefined) throw new Error('Invalid ClearBill mock fixture.');
  return { ...truth, text };
});
