import text from '../../samples/bills/itemized-er-laceration/bill.txt?raw';
import type { SampleId } from './contract.ts';

export const SAMPLE_TEXTS = { 'itemized-er-laceration': text } satisfies Record<SampleId, string>;
