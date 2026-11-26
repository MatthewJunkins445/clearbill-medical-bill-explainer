import { t } from '../copy.ts';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** A dollar amount as real text, or the "not shown on the bill" copy for `null`. */
export function formatMoney(amount: number | null): string {
  return amount === null ? t('explain.amountUnknown') : usd.format(amount);
}
