import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const sampleDir = path.join(import.meta.dirname, '../../samples/bills/itemized-er-laceration');
const sampleText = readFileSync(path.join(sampleDir, 'bill.txt'), 'utf8');
const truth = JSON.parse(readFileSync(path.join(sampleDir, 'ground-truth.json'), 'utf8')) as {
  pii: { value: string; mustRedact?: boolean }[];
};
const rawPii = truth.pii.filter((p) => p.mustRedact === true).map((p) => p.value);

const cloudOpen = encodeURIComponent(JSON.stringify({ config: { cloudRegionAllowed: true } }));

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const agreeBox = (page: Page) => page.getByRole('checkbox');
const agree = (page: Page) => page.getByRole('button', { name: 'Agree and continue' });
const decline = (page: Page) => page.getByRole('button', { name: 'Keep everything on this computer' });

async function openConsent(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await page.getByRole('button', { name: 'Try a sample bill' }).click();
  await expect(h1(page)).toHaveText('Check details');
  await page.getByRole('button', { name: 'Looks right, continue' }).click();
  await expect(h1(page)).toHaveText('Your choice');
}

async function openConsentFromImport(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Try a sample bill' }).click();
  await expect(h1(page)).toHaveText('Check details');
  await page.getByRole('button', { name: 'Looks right, continue' }).click();
  await expect(h1(page)).toHaveText('Your choice');
}

const cloudPayloads = (page: Page) =>
  page.evaluate(() => {
    const ai = window.__clearbill?.current().ai as unknown as { cloudPayloads?: unknown[] } | undefined;
    if (!ai?.cloudPayloads) throw new Error('mock AI with cloudPayloads missing');
    return ai.cloudPayloads;
  });

const logSteps = (page: Page) =>
  page.evaluate(() => {
    const hook = window.__clearbill;
    if (!hook) throw new Error('test hook missing');
    return hook
      .current()
      .getSession()
      .log.map((entry) => entry.step);
  });

test.describe('consent, explanation and questions (mock AI)', () => {
  test('the checkbox starts unticked and Agree stays disabled until it is ticked', async ({ page }) => {
    await openConsent(page, `?scenario=${cloudOpen}`);
    await expect(agreeBox(page)).not.toBeChecked();
    await expect(agree(page)).toBeDisabled();
    await expect(decline(page)).toBeEnabled();
    await agreeBox(page).check();
    await expect(agree(page)).toBeEnabled();
    await agreeBox(page).uncheck();
    await expect(agree(page)).toBeDisabled();
    // The exact text is viewable on demand.
    await expect(page.locator('#consent-text')).toBeHidden();
    await page.getByRole('button', { name: 'See the exact text' }).click();
    await expect(page.locator('#consent-text')).toBeVisible();
    for (const value of rawPii)
      expect((await page.locator('#consent-text').textContent()) ?? '').not.toContain(value);
  });

  test('keeping everything on the computer goes to the results; a question gets an On this device answer', async ({
    page,
  }) => {
    await openConsent(page, `?scenario=${cloudOpen}`);
    await decline(page).click();
    await expect(h1(page)).toHaveText('Explanation');
    await expect(page.locator('.line-card').first()).toBeVisible();
    expect(await logSteps(page)).toEqual(['redaction', 'explain']);
    // Declining sends nothing, even though the region is open and the bill is the sample.
    expect(await cloudPayloads(page)).toEqual([]);
    expect(await page.evaluate(() => window.__clearbill?.current().getSession().consent)).toBe('declined');

    await page.getByRole('button', { name: 'Ask a question' }).click();
    await expect(h1(page)).toHaveText('Questions');
    // An empty question makes no call.
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    expect(await logSteps(page)).toEqual(['redaction', 'explain']);
    await page.getByLabel('Your question').fill('Why was I charged twice?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const card = page.locator('.answer-card');
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('heading', { name: 'Answer to: Why was I charged twice?' })).toBeFocused();
    await expect(card.locator('.badge-ON_DEVICE')).toBeVisible();
    expect(await logSteps(page)).toEqual(['redaction', 'explain', 'question']);
  });

  test('with the region closed only the device choice is offered, with the region notice', async ({
    page,
  }) => {
    await openConsent(page);
    await expect(page.getByText("Cloud features aren't available here right now.")).toBeVisible();
    await expect(agree(page)).toHaveCount(0);
    await expect(agreeBox(page)).toHaveCount(0);
    await expect(decline(page)).toBeVisible();
  });

  test('agreeing (sample, cloud allowed) shows line items with a badge and sends only the redacted text', async ({
    page,
  }) => {
    await openConsent(page, `?scenario=${cloudOpen}`);
    await agreeBox(page).check();
    await agree(page).click();
    await expect(h1(page)).toHaveText('Explanation');
    await expect(page.locator('.line-card').first()).toBeVisible();
    await expect(page.locator('.line-card .badge').first()).toBeVisible();
    await expect(page.locator('.totals')).toBeVisible();
    const payloads = await page.evaluate(() => {
      const ai = window.__clearbill?.current().ai as unknown as {
        cloudPayloads: { operation: string; text: string }[];
      };
      return ai.cloudPayloads;
    });
    expect(payloads.map((p) => p.operation)).toEqual(['explainBill']);
    const sent = payloads[0]?.text ?? '';
    expect(sent.length).toBeGreaterThan(0);
    for (const value of rawPii) expect(sent).not.toContain(value);
    expect(sent).toMatch(/\[PATIENT_NAME_1\]/);
  });

  test('a pasted copy of the sample is device-only: the sample-only notice and no agree button', async ({
    page,
  }) => {
    await page.goto(`/?scenario=${cloudOpen}`);
    await page.getByRole('textbox', { name: 'Bill text' }).fill(sampleText);
    await page.getByRole('button', { name: 'Check my bill' }).click();
    await expect(h1(page)).toHaveText('Check details');
    await page.getByRole('button', { name: 'Looks right, continue' }).click();
    await expect(h1(page)).toHaveText('Your choice');
    await expect(page.getByText('cloud features work only with the built-in sample bill')).toBeVisible();
    await expect(agree(page)).toHaveCount(0);
    await decline(page).click();
    await expect(h1(page)).toHaveText('Explanation');
    const payloads = await page.evaluate(
      () => (window.__clearbill?.current().ai as unknown as { cloudPayloads: unknown[] }).cloudPayloads,
    );
    expect(payloads).toEqual([]);
  });

  test('a Review revisit from the results works, and a consent screen without an approval shows a preview', async ({
    page,
  }) => {
    await openConsent(page);
    await decline(page).click();
    await expect(h1(page)).toHaveText('Explanation');
    await page.getByRole('link', { name: /Check details/ }).click();
    await expect(h1(page)).toHaveText('Check details');
    await page.getByRole('button', { name: 'Looks right, continue' }).click();
    await expect(h1(page)).toHaveText('Your choice');

    // No stored approval (as after a Review visit): results send the user to the choice, which previews the text.
    await page.evaluate(() => {
      const hook = window.__clearbill;
      if (!hook) throw new Error('test hook missing');
      hook.current().update((s) => ({ ...s, approval: null, step: 'results' }));
    });
    await expect(h1(page)).toHaveText('Your choice');
    await page.getByRole('button', { name: 'See the exact text' }).click();
    expect(((await page.locator('#consent-text').textContent()) ?? '').length).toBeGreaterThan(100);
    expect(await page.evaluate(() => window.__clearbill?.current().getSession().approval === null)).toBe(
      true,
    );
    await decline(page).click();
    await expect(h1(page)).toHaveText('Explanation');
  });

  test('switching tabs explain, questions, explain does not explain twice', async ({ page }) => {
    await openConsent(page, `?scenario=${cloudOpen}`);
    await decline(page).click();
    await expect(page.locator('.line-card').first()).toBeVisible();
    await page.getByRole('link', { name: /Questions/ }).click();
    await expect(h1(page)).toHaveText('Questions');
    await page.getByRole('link', { name: /Explanation/ }).click();
    await expect(h1(page)).toHaveText('Explanation');
    await expect(page.locator('.line-card').first()).toBeVisible();
    expect((await logSteps(page)).filter((step) => step === 'explain')).toHaveLength(1);
  });

  test('a missing on-device model shows the setup action on the explanation', async ({ page }) => {
    const scenario = encodeURIComponent(
      JSON.stringify({ errorCodes: { explainBill: 'DEVICE_MODEL_NOT_READY' } }),
    );
    await openConsent(page, `?scenario=${scenario}`);
    await decline(page).click();
    await expect(page.getByRole('heading', { name: "The on-device model isn't ready yet" })).toBeVisible();
    await page.getByRole('button', { name: 'Go to setup' }).click();
    await expect(h1(page)).toHaveText('Set up');
  });

  test('"Fill in my details" is not needed when the answer has no placeholders, and shows no unfilled braces', async ({
    page,
  }) => {
    await openConsent(page);
    await decline(page).click();
    await expect(page.locator('.line-card').first()).toBeVisible();
    expect(await page.evaluate(() => document.body.innerText)).not.toContain('{');
    await page.getByRole('button', { name: 'Ask a question' }).click();
    await expect(h1(page)).toHaveText('Questions');
    expect(await page.evaluate(() => document.body.innerText)).not.toContain('{');
  });

  test('a typed question does not survive Start over', async ({ page }) => {
    await openConsent(page);
    await decline(page).click();
    await page.getByRole('link', { name: /Questions/ }).click();
    await expect(h1(page)).toHaveText('Questions');
    const field = page.getByLabel('Your question');
    await field.focus();
    await page.keyboard.type('my private question');
    await expect(field).toHaveValue('my private question');
    await expect(field).toBeFocused();
    // Leaving and coming back keeps the draft within the same bill.
    await page.getByRole('link', { name: /Explanation/ }).click();
    await page.getByRole('link', { name: /Questions/ }).click();
    await expect(page.getByLabel('Your question')).toHaveValue('my private question');

    await page.getByRole('button', { name: 'Start over' }).click();
    await page.getByRole('button', { name: 'Yes, start over' }).click();
    await expect(h1(page)).toHaveText('Add your medical bill');
    await openConsentFromImport(page);
    await decline(page).click();
    await page.getByRole('link', { name: /Questions/ }).click();
    await expect(h1(page)).toHaveText('Questions');
    await expect(page.getByLabel('Your question')).toHaveValue('');
  });

  test('an explanation still running when the user switches tab is logged', async ({ page }) => {
    const slow = encodeURIComponent(JSON.stringify({ config: { cloudRegionAllowed: true }, latencyMs: 400 }));
    await openConsent(page, `?scenario=${slow}`);
    await agreeBox(page).check();
    await agree(page).click();
    await expect(h1(page)).toHaveText('Explanation');
    await page.getByRole('link', { name: /Questions/ }).click();
    await expect(h1(page)).toHaveText('Questions');
    await expect.poll(() => logSteps(page)).toContain('explain');
    // The cloud call really happened.
    expect((await cloudPayloads(page)).length).toBe(1);
  });

  test('an explanation that finishes after Start over does not land in the new session log', async ({
    page,
  }) => {
    const slow = encodeURIComponent(JSON.stringify({ config: { cloudRegionAllowed: true }, latencyMs: 400 }));
    await openConsent(page, `?scenario=${slow}`);
    await agreeBox(page).check();
    await agree(page).click();
    await expect(h1(page)).toHaveText('Explanation');
    await page.getByRole('button', { name: 'Start over' }).click();
    await page.getByRole('button', { name: 'Yes, start over' }).click();
    await expect(h1(page)).toHaveText('Add your medical bill');
    // Wait well past the mock latency, then check the new session stayed empty.
    await page.waitForTimeout(1200);
    expect(await logSteps(page)).toEqual([]);
  });
});
