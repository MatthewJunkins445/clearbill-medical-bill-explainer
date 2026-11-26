import { expect, test, type Page } from '@playwright/test';

const cloudOpen = encodeURIComponent(JSON.stringify({ config: { cloudRegionAllowed: true } }));

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const agreeBox = (page: Page) => page.getByRole('checkbox');
const agree = (page: Page) => page.getByRole('button', { name: 'Agree and continue' });
const decline = (page: Page) => page.getByRole('button', { name: 'Keep everything on this computer' });
const tab = (page: Page, name: RegExp) => page.getByRole('link', { name });

async function openConsent(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await page.getByRole('button', { name: 'Try a sample bill' }).click();
  await expect(h1(page)).toHaveText('Check details');
  await page.getByRole('button', { name: 'Looks right, continue' }).click();
  await expect(h1(page)).toHaveText('Your choice');
}

/** Sample bill, cloud open, consent agreed: lands on the explanation. */
async function openAgreed(page: Page): Promise<void> {
  await openConsent(page, `?scenario=${cloudOpen}`);
  await agreeBox(page).check();
  await agree(page).click();
  await expect(h1(page)).toHaveText('Explanation');
  await expect(page.locator('.line-card').first()).toBeVisible();
}

const cloudPayloads = (page: Page) =>
  page.evaluate(() => {
    const ai = window.__clearbill?.current().ai as unknown as
      { cloudPayloads?: { operation: string }[] } | undefined;
    if (!ai?.cloudPayloads) throw new Error('mock AI with cloudPayloads missing');
    return ai.cloudPayloads.map((p) => p.operation);
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

/**
 * Counts attempts, not payloads: wraps the shared mock's `auditBill` and `draftLetter` so a test can tell that the UI
 * never even asked (the mock's own gate would reject a call before it recorded a payload).
 */
const installAttemptCounter = (page: Page) =>
  page.evaluate(() => {
    const ai = window.__clearbill?.current().ai as unknown as Record<string, (...args: unknown[]) => unknown>;
    const counts: Record<string, number> = { auditBill: 0, draftLetter: 0 };
    for (const name of Object.keys(counts)) {
      const original = ai[name]?.bind(ai);
      if (!original) throw new Error(`${name} missing`);
      ai[name] = (...args: unknown[]) => {
        counts[name] = (counts[name] ?? 0) + 1;
        return original(...args);
      };
    }
    (window as unknown as { __attempts: typeof counts }).__attempts = counts;
  });

const attempts = (page: Page) =>
  page.evaluate(() => ({ ...(window as unknown as { __attempts: Record<string, number> }).__attempts }));

const bodyText = (page: Page) => page.evaluate(() => document.body.innerText);

test.describe('things to check, letter and under the hood (mock AI)', () => {
  test('the audit shows cloud flags with a severity text, never a bare "error"', async ({ page }) => {
    await openAgreed(page);
    await tab(page, /Things to check/).click();
    await expect(h1(page)).toHaveText('Things to check');
    const cards = page.locator('.flag-card');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(0);
    await expect(page.locator('.audit-summary .badge-IN_CLOUD')).toBeVisible();
    const severities = await page.locator('.severity').allTextContents();
    expect(severities.length).toBe(await cards.count());
    for (const text of severities) expect(text).toMatch(/Likely error|Worth asking about/);
    // Each flag has a checkbox named after it.
    const first = cards.first();
    const title = (await first.locator('h3').textContent()) ?? '';
    await expect(
      first.getByRole('checkbox', { name: new RegExp(`^Include in letter.*${escapeRegExp(title)}$`) }),
    ).not.toBeChecked();
    expect(await bodyText(page)).not.toContain('{');
    expect(await cloudPayloads(page)).toEqual(['explainBill', 'auditBill']);
  });

  test('a ticked flag goes into the drafted letter, which is editable and shows its badge', async ({
    page,
  }) => {
    await openAgreed(page);
    await tab(page, /Things to check/).click();
    const first = page.locator('.flag-card').first();
    await expect(first).toBeVisible();
    const title = (await first.locator('h3').textContent()) ?? '';
    await first.getByRole('checkbox').check();
    await expect(first.getByText('In letter', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Draft a letter' }).click();
    await expect(h1(page)).toHaveText('Letter');
    const editor = page.getByLabel('Letter text, you can edit it');
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue(new RegExp(`Could you clarify this item: ${escapeRegExp(title)}\\?`));
    await expect(page.locator('.letter-editor .badge-IN_CLOUD')).toBeVisible();
    await expect(page.getByText('This letter is a draft, not legal advice.')).toBeVisible();
    await editor.fill('My own words');
    await expect(editor).toHaveValue('My own words');
    expect(await cloudPayloads(page)).toEqual(['explainBill', 'auditBill', 'draftLetter']);
  });

  test('going straight to the Letter tab drafts an itemized-bill letter with no flags', async ({ page }) => {
    await openAgreed(page);
    await tab(page, /Letter/).click();
    await expect(h1(page)).toHaveText('Letter');
    const editor = page.getByLabel('Letter text, you can edit it');
    await expect(editor).toHaveValue(/Could you send me an itemized statement\?/);
    await expect(editor).not.toHaveValue(/Could you clarify this item/);
    await expect(page.getByRole('radio', { name: 'Ask for an itemized bill' })).toBeChecked();
    // Another type drafts again (nothing was edited, so nothing is lost).
    await page.getByRole('radio', { name: 'Question specific charges' }).check();
    await expect(editor).toHaveValue(/Could you review the charges on this statement\?/);
    expect((await cloudPayloads(page)).filter((op) => op === 'draftLetter')).toHaveLength(2);
  });

  test('changing the letter type after editing asks before replacing the edits', async ({ page }) => {
    await openAgreed(page);
    await tab(page, /Letter/).click();
    const editor = page.getByLabel('Letter text, you can edit it');
    await expect(editor).toBeVisible();
    await editor.fill('My own words');
    await page.getByRole('radio', { name: 'Ask my insurer to review a claim' }).check();
    await expect(page.getByText('Your edits will be replaced by a new draft.')).toBeVisible();
    await expect(editor).toHaveValue('My own words');
    expect((await cloudPayloads(page)).filter((op) => op === 'draftLetter')).toHaveLength(1);
    await page.getByRole('button', { name: 'Draft again' }).click();
    await expect(editor).toHaveValue(/Could you review how this statement was processed\?/);
  });

  test('with consent declined neither tab calls the cloud, and both offer to review the choice', async ({
    page,
  }) => {
    await openConsent(page, `?scenario=${cloudOpen}`);
    await installAttemptCounter(page);
    await decline(page).click();
    await expect(h1(page)).toHaveText('Explanation');
    await tab(page, /Things to check/).click();
    await expect(h1(page)).toHaveText('Things to check');
    await expect(page.getByRole('heading', { name: 'This needs your OK first' })).toBeVisible();
    await tab(page, /Letter/).click();
    await expect(h1(page)).toHaveText('Letter');
    await expect(page.getByRole('heading', { name: 'This needs your OK first' })).toBeVisible();
    await expect(page.getByLabel('Letter text, you can edit it')).toHaveCount(0);
    expect(await cloudPayloads(page)).toEqual([]);
    // The UI never even asked the AI layer.
    expect(await attempts(page)).toEqual({ auditBill: 0, draftLetter: 0 });
    expect(await logSteps(page)).toEqual(['redaction', 'explain']);
    await page.getByRole('button', { name: 'Review my choice' }).click();
    await expect(h1(page)).toHaveText('Your choice');
  });

  test('with the region closed the cloud tabs show the region notice and make no cloud call', async ({
    page,
  }) => {
    await openConsent(page);
    await installAttemptCounter(page);
    await decline(page).click();
    await tab(page, /Things to check/).click();
    await expect(h1(page)).toHaveText('Things to check');
    await tab(page, /Letter/).click();
    await expect(h1(page)).toHaveText('Letter');
    await tab(page, /Things to check/).click();
    await expect(h1(page)).toHaveText('Things to check');
    await expect(page.getByText("Cloud features aren't available here right now.").first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review my choice' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Go to the explanation' }).click();
    await expect(h1(page)).toHaveText('Explanation');
    expect(await cloudPayloads(page)).toEqual([]);
    expect(await attempts(page)).toEqual({ auditBill: 0, draftLetter: 0 });
  });

  test('a paused cloud shows the paused notice instead of the flags', async ({ page }) => {
    const paused = encodeURIComponent(
      JSON.stringify({ config: { cloudRegionAllowed: true, killSwitch: true } }),
    );
    await openConsent(page, `?scenario=${paused}`);
    await installAttemptCounter(page);
    await decline(page).click();
    await tab(page, /Things to check/).click();
    await expect(page.getByRole('heading', { name: 'Cloud features are paused' })).toBeVisible();
    await expect(page.getByText('The check is paused. Please try again later.')).toBeVisible();
    await tab(page, /Letter/).click();
    await expect(page.getByText('The letter is paused. Please try again later.')).toBeVisible();
    expect(await cloudPayloads(page)).toEqual([]);
    expect(await attempts(page)).toEqual({ auditBill: 0, draftLetter: 0 });
  });

  test('"Fill in my details" fills the placeholders on this computer, without a cloud call', async ({
    page,
  }) => {
    await openAgreed(page);
    await tab(page, /Letter/).click();
    const editor = page.getByLabel('Letter text, you can edit it');
    await expect(editor).toHaveValue(/\[ACCOUNT_NUMBER_1\]/);
    await expect(page.getByText('1 label is left to fill in, like [ACCOUNT_NUMBER_1].')).toBeVisible();
    const before = await cloudPayloads(page);
    await page.getByRole('button', { name: 'Fill in my details' }).click();
    await expect(editor).not.toHaveValue(/\[ACCOUNT_NUMBER_1\]/);
    await expect(editor).toHaveValue(/Account: \S+/);
    await expect(page.getByText('The removed details are filled in on this computer.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fill in my details' })).toBeHidden();
    // Keyboard focus moves to the letter, not to the page, when the button goes away.
    await expect(editor).toBeFocused();
    expect(await cloudPayloads(page)).toEqual(before);
    // The filled text is only in the textarea: it is not in the session or the log.
    const filled = await editor.inputValue();
    const account = /Account: (\S+)/.exec(filled)?.[1] ?? '';
    expect(account).not.toBe('');
    expect(
      await page.evaluate(() => JSON.stringify(window.__clearbill?.current().getSession().log)),
    ).not.toContain(account);
  });

  test('the attempt counter sees the real calls when consent is agreed (positive control)', async ({
    page,
  }) => {
    await openConsent(page, `?scenario=${cloudOpen}`);
    await installAttemptCounter(page);
    await agreeBox(page).check();
    await agree(page).click();
    await expect(h1(page)).toHaveText('Explanation');
    await tab(page, /Things to check/).click();
    await expect(page.locator('.flag-card').first()).toBeVisible();
    await tab(page, /Letter/).click();
    await expect(page.getByLabel('Letter text, you can edit it')).toBeVisible();
    expect(await attempts(page)).toEqual({ auditBill: 1, draftLetter: 1 });
  });

  test('leaving the Letter tab and coming back reuses the draft: one cloud call, one log row', async ({
    page,
  }) => {
    await openAgreed(page);
    await tab(page, /Letter/).click();
    const editor = page.getByLabel('Letter text, you can edit it');
    await expect(editor).toBeVisible();
    await expect(
      page.getByText('Your edits and filled-in details are not kept if you leave this tab.'),
    ).toBeVisible();
    await editor.fill('typed text that is not kept');
    await tab(page, /Questions/).click();
    await expect(h1(page)).toHaveText('Questions');
    await tab(page, /Letter/).click();
    await expect(editor).toHaveValue(/Could you send me an itemized statement\?/);
    await tab(page, /Things to check/).click();
    await expect(page.locator('.flag-card').first()).toBeVisible();
    await tab(page, /Letter/).click();
    await expect(editor).toBeVisible();
    expect((await cloudPayloads(page)).filter((op) => op === 'draftLetter')).toHaveLength(1);
    expect((await logSteps(page)).filter((step) => step === 'letter')).toHaveLength(1);
    // "Draft again" is what asks the cloud again.
    await page.getByRole('button', { name: 'Draft again' }).click();
    await expect(editor).toBeVisible();
    expect((await cloudPayloads(page)).filter((op) => op === 'draftLetter')).toHaveLength(2);
    expect((await logSteps(page)).filter((step) => step === 'letter')).toHaveLength(2);
  });

  test('a letter still being drafted when the user leaves is logged once, and not drafted again on return', async ({
    page,
  }) => {
    const slow = encodeURIComponent(JSON.stringify({ config: { cloudRegionAllowed: true }, latencyMs: 400 }));
    await openConsent(page, `?scenario=${slow}`);
    await agreeBox(page).check();
    await agree(page).click();
    await expect(h1(page)).toHaveText('Explanation');
    await tab(page, /Letter/).click();
    await tab(page, /Questions/).click();
    await expect(h1(page)).toHaveText('Questions');
    await expect.poll(() => logSteps(page)).toContain('letter');
    await tab(page, /Letter/).click();
    await expect(page.getByLabel('Letter text, you can edit it')).toBeVisible();
    expect((await logSteps(page)).filter((step) => step === 'letter')).toHaveLength(1);
    expect((await cloudPayloads(page)).filter((op) => op === 'draftLetter')).toHaveLength(1);
  });

  test('switching Audit, Questions, Audit does not call the audit twice', async ({ page }) => {
    await openAgreed(page);
    await tab(page, /Things to check/).click();
    await expect(page.locator('.flag-card').first()).toBeVisible();
    await page.locator('.flag-card').first().getByRole('checkbox').check();
    await tab(page, /Questions/).click();
    await expect(h1(page)).toHaveText('Questions');
    await tab(page, /Things to check/).click();
    await expect(page.locator('.flag-card').first()).toBeVisible();
    // The ticked flag is remembered for this bill.
    await expect(page.locator('.flag-card').first().getByRole('checkbox')).toBeChecked();
    expect((await logSteps(page)).filter((step) => step === 'audit')).toHaveLength(1);
    expect((await cloudPayloads(page)).filter((op) => op === 'auditBill')).toHaveLength(1);
  });

  test('Under the hood lists every executed step with where it ran, plus the consent and device state', async ({
    page,
  }) => {
    await openAgreed(page);
    await tab(page, /Things to check/).click();
    await expect(page.locator('.flag-card').first()).toBeVisible();
    await tab(page, /Letter/).click();
    await expect(page.getByLabel('Letter text, you can edit it')).toBeVisible();

    await page.getByRole('button', { name: 'Under the hood' }).click();
    const aside = page.getByRole('complementary', { name: 'Under the hood' });
    await expect(aside).toBeVisible();
    const rows = aside.locator('tbody tr');
    await expect(rows).toHaveCount(4);
    const steps = await rows.locator('td:first-child').allTextContents();
    expect(steps).toEqual(['Remove details', 'Explain line', 'Check for issues', 'Draft letter']);
    for (const row of await rows.all())
      await expect(row).toContainText(/On this device|In the cloud|Simple rules/);
    await expect(rows.nth(2)).toContainText('In the cloud');
    await expect(rows.nth(2)).toContainText('Cloud first');
    await expect(rows.nth(2)).toContainText(/\d+ ms/);
    await expect(aside.getByRole('columnheader', { name: 'Step' })).toBeVisible();
    await expect(aside.locator('dl')).toContainText('Cloud consent');
    await expect(aside.locator('dl')).toContainText('Agreed');
    await expect(aside.locator('dl')).toContainText('Ready');
    await expect(aside.locator('dl')).toContainText('mock-gemini-cloud');
    await expect(aside.locator('dl')).toContainText('On');
    await expect(aside).toContainText('Calls this session: 4');
    await page.keyboard.press('Escape');
    await expect(aside).toBeHidden();
    expect(await bodyText(page)).not.toContain('{');
  });

  test('Under the hood shows no calls before anything ran', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Under the hood' }).click();
    const aside = page.getByRole('complementary', { name: 'Under the hood' });
    await expect(aside).toContainText('No calls yet.');
    await expect(aside.locator('dl')).toContainText('Not asked yet');
    await expect(aside.locator('dl')).toContainText('—');
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
