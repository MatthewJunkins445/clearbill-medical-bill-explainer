// Task 8: the whole app on the mock AI, start to finish. Three paths: the full demo path with the cloud open, the
// rules-only path on a device with no model, and Start over after reaching the results.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const sampleDir = path.join(import.meta.dirname, '../../samples/bills/itemized-er-laceration');
const sampleText = readFileSync(path.join(sampleDir, 'bill.txt'), 'utf8');
const truth = JSON.parse(readFileSync(path.join(sampleDir, 'ground-truth.json'), 'utf8')) as {
  pii: { value: string; mustRedact?: boolean }[];
};
const rawPii = truth.pii.filter((p) => p.mustRedact === true).map((p) => p.value);

const copy = JSON.parse(readFileSync(path.join(import.meta.dirname, '../../design/copy.json'), 'utf8')) as {
  explain: { explaining: string };
  questions: { asking: string };
  audit: { running: string };
  letter: { drafting: string };
};

const scenario = (value: unknown) => `?scenario=${encodeURIComponent(JSON.stringify(value))}`;

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
// The shell's live region (screens may have their own role=status paragraphs).
const status = (page: Page) => page.locator('div.live[role="status"]');
const tab = (page: Page, name: RegExp) => page.getByRole('link', { name });
const bodyText = (page: Page) => page.evaluate(() => document.body.innerText);

/** Collects console errors and page errors; the arrays are asserted empty at the end of a test. */
function watchErrors(page: Page): { console: string[]; page: string[] } {
  const errors = { console: [] as string[], page: [] as string[] };
  page.on('console', (message) => {
    if (message.type() === 'error') errors.console.push(message.text() + ' @ ' + message.location().url);
  });
  page.on('pageerror', (error) => {
    errors.page.push(error.message);
  });
  return errors;
}

/**
 * What every step must satisfy: the heading text, the page title built from it, focus on the heading (not on the
 * first render, which keeps the browser's own focus) and no unfilled `{placeholder}` anywhere on the page.
 */
async function expectStep(page: Page, heading: string, options: { focus?: boolean } = {}): Promise<void> {
  await expect(h1(page)).toHaveText(heading);
  await expect(h1(page)).toHaveAttribute('tabindex', '-1');
  await expect(page).toHaveTitle(`${heading} · ClearBill`);
  if (options.focus !== false) await expect(h1(page)).toBeFocused();
  expect(await bodyText(page)).not.toContain('{');
}

interface MockPayload {
  operation: string;
  text: string;
}

/** Every string anywhere in a payload object (text and any other field that carries text). */
function payloadStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(payloadStrings);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(payloadStrings);
  return [];
}

/**
 * The raw values (and, for a multi-line value, each non-empty line of it) that appear in any string of the payload.
 * Strings are compared as they are, never through JSON.stringify (it turns a real newline into backslash-n).
 */
function leaksIn(payload: unknown, rawValues: readonly string[]): string[] {
  const strings = payloadStrings(payload);
  const leaked: string[] = [];
  for (const value of rawValues) {
    const needles = [value, ...value.split(/\r?\n/).map((line) => line.trim())].filter((n) => n !== '');
    for (const needle of needles) if (strings.some((text) => text.includes(needle))) leaked.push(needle);
  }
  return leaked;
}
const cloudPayloads = (page: Page) =>
  page.evaluate(() => {
    const ai = window.__clearbill?.current().ai as unknown as { cloudPayloads?: unknown[] } | undefined;
    if (!ai?.cloudPayloads) throw new Error('mock AI with cloudPayloads missing');
    return ai.cloudPayloads as MockPayload[];
  });

const session = (page: Page) =>
  page.evaluate(() => {
    const hook = window.__clearbill;
    if (!hook) throw new Error('test hook missing');
    const s = hook.current().getSession();
    return {
      step: s.step,
      consent: s.consent,
      hasDraft: s.draft !== null,
      hasApproval: s.approval !== null,
      hasInput: s.input !== null,
      logLength: s.log.length,
      questionDraft: s.questionDraft,
    };
  });

/** Counts attempts at the cloud-only calls (the mock's own gate would refuse before recording a payload). */
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

/** Sample bill, cloud open, device ready: every screen up to and including the explanation. */
async function reachExplanation(page: Page): Promise<void> {
  await page.goto(`/${scenario({ config: { cloudRegionAllowed: true } })}`);
  await expectStep(page, 'Add your medical bill', { focus: false });
  await page.getByRole('button', { name: 'Try a sample bill' }).click();
  await expectStep(page, 'Check details');
  await page.getByRole('button', { name: 'Looks right, continue' }).click();
  await expectStep(page, 'Your choice');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Agree and continue' }).click();
  await expectStep(page, 'Explanation');
  await expect(page.locator('.line-card').first()).toBeVisible();
  expect(await bodyText(page)).not.toContain('{');
}

test.describe('full path (mock AI)', () => {
  // Proves the matcher itself works, so an always-empty result in the path test means "no leak", not "blind".
  test('the PII check detects a leak, including one line of a multi-line value', () => {
    const address = '77 Gumdrop Hollow Rd\nSampleton, OH 44987';
    expect(leaksIn({ operation: 'x', text: `Bill for ${address}.` }, [address])).toContain(address);
    expect(leaksIn({ operation: 'x', text: 'Street: 77 Gumdrop Hollow Rd only' }, [address])).toEqual([
      '77 Gumdrop Hollow Rd',
    ]);
    expect(leaksIn({ operation: 'x', nested: { note: ['Sampleton, OH 44987'] } }, [address])).toEqual([
      'Sampleton, OH 44987',
    ]);
    expect(leaksIn({ operation: 'x', text: '[ADDRESS_1] and [PATIENT_NAME_1]' }, [address])).toEqual([]);
    // The real ground truth has at least one multi-line value, so the line splitting is exercised for real.
    expect(rawPii.some((value) => value.includes('\n'))).toBe(true);
  });

  test('full demo path with cloud allowed', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`/${scenario({ config: { cloudRegionAllowed: true } })}`);
    await expectStep(page, 'Add your medical bill', { focus: false });
    // Nothing has been announced yet, so the later non-empty checks are not stale.
    await expect(status(page)).toBeEmpty();

    // Import -> Review.
    await page.getByRole('button', { name: 'Try a sample bill' }).click();
    await expectStep(page, 'Check details');
    await expect(page.locator('.heading-row .badge-ON_DEVICE')).toHaveCount(1);

    // Review -> Consent: the box starts unticked, Agree needs it.
    await page.getByRole('button', { name: 'Looks right, continue' }).click();
    await expectStep(page, 'Your choice');
    const box = page.getByRole('checkbox');
    const agree = page.getByRole('button', { name: 'Agree and continue' });
    await expect(box).not.toBeChecked();
    await expect(agree).toBeDisabled();
    await box.check();
    await expect(agree).toBeEnabled();
    // Positive control for the "no cloud attempt" checks in the rules-only test: here the counter must see the calls.
    await installAttemptCounter(page);
    await agree.click();

    // Explanation.
    await expectStep(page, 'Explanation');
    await expect(page.locator('.line-card').first()).toBeVisible();
    await expect(page.locator('.line-card .badge').first()).toBeVisible();
    expect(await bodyText(page)).not.toContain('{');
    await expect(status(page)).toHaveText(copy.explain.explaining);

    // Questions: an answer card made on this device.
    await tab(page, /Questions/).click();
    await expectStep(page, 'Questions');
    await page.getByLabel('Your question').fill('Why was I charged twice?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const answer = page.locator('.answer-card');
    await expect(answer).toHaveCount(1);
    await expect(answer.locator('.badge-ON_DEVICE')).toBeVisible();
    await expect(status(page)).toHaveText(copy.questions.asking);
    expect(await bodyText(page)).not.toContain('{');

    // Things to check: flags made in the cloud.
    await tab(page, /Things to check/).click();
    await expectStep(page, 'Things to check');
    await expect(status(page)).toHaveText(copy.audit.running);
    const flags = page.locator('.flag-card');
    await expect(flags.first()).toBeVisible();
    await expect(page.locator('.audit-summary .badge-IN_CLOUD')).toBeVisible();
    const count = await flags.count();
    expect(count).toBeGreaterThan(0);
    const title = ((await flags.first().locator('h3').textContent()) ?? '').trim();
    expect(title).not.toBe('');
    await flags.first().getByRole('checkbox').check();
    expect(await bodyText(page)).not.toContain('{');

    // Letter: drafted from the picked flag.
    await page.getByRole('button', { name: 'Draft a letter' }).click();
    await expectStep(page, 'Letter');
    await expect(status(page)).toHaveText(copy.letter.drafting);
    const editor = page.getByLabel('Letter text, you can edit it');
    await expect(editor).toBeVisible();
    expect(await editor.inputValue()).toContain(title);
    await expect(page.locator('.letter-editor .badge-IN_CLOUD')).toBeVisible();
    expect(await bodyText(page)).not.toContain('{');

    // Under the hood: every step that ran, with where it ran.
    await page.getByRole('button', { name: 'Under the hood' }).click();
    const aside = page.getByRole('complementary', { name: 'Under the hood' });
    await expect(aside).toBeVisible();
    const rows = aside.locator('tbody tr');
    await expect(rows).toHaveCount(5);
    expect(await rows.locator('td:first-child').allTextContents()).toEqual([
      'Remove details',
      'Explain line',
      'Question',
      'Check for issues',
      'Draft letter',
    ]);
    const ran = await rows.locator('td:nth-child(3)').allTextContents();
    expect(ran).toHaveLength(5);
    for (const where of ran) expect(where).toMatch(/On this device|In the cloud|Simple rules/);
    // The check and the letter ran in the cloud, the question on this device (explain: either, by the mock's mode).
    expect(ran[2]).toContain('On this device');
    expect(ran[3]).toContain('In the cloud');
    expect(ran[4]).toContain('In the cloud');
    await expect(aside).toContainText('Calls this session: 5');
    expect(await bodyText(page)).not.toContain('{');

    expect(await attempts(page)).toEqual({ auditBill: 1, draftLetter: 1 });

    // Privacy invariant, with a non-vacuous precondition: the cloud calls happened and none carried a raw value.
    expect(rawPii.length).toBeGreaterThan(0);
    const payloads = await cloudPayloads(page);
    expect(payloads.map((p) => p.operation)).toEqual(['explainBill', 'auditBill', 'draftLetter']);
    for (const payload of payloads) {
      expect(payload.text.length).toBeGreaterThan(0);
      expect(leaksIn(payload, rawPii)).toEqual([]);
    }

    expect(errors.console).toEqual([]);
    expect(errors.page).toEqual([]);
  });

  test('rules-only path completes end to end', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`/${scenario({ deviceStates: ['unsupported'] })}`);
    await expectStep(page, 'Add your medical bill', { focus: false });
    await page.getByRole('textbox', { name: 'Bill text' }).fill(sampleText);
    await page.getByRole('button', { name: 'Check my bill' }).click();
    await expectStep(page, 'Set up');
    await page.getByRole('button', { name: 'Use simple rules' }).click();

    // Review: the rules-only banner and the Simple rules badge.
    await expectStep(page, 'Check details');
    await expect(page.getByRole('note').filter({ hasText: 'Using simple rules, not AI' })).toBeVisible();
    await expect(page.locator('.heading-row .badge-LOCAL_RULES')).toHaveCount(1);
    await page.getByRole('button', { name: 'Looks right, continue' }).click();

    // Consent: a pasted bill never goes to the cloud, so only the device choice is offered.
    await expectStep(page, 'Your choice');
    await expect(page.getByRole('button', { name: 'Agree and continue' })).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    const decline = page.getByRole('button', { name: 'Keep everything on this computer' });
    await expect(decline).toBeVisible();
    await installAttemptCounter(page);
    await decline.click();

    // Explanation: no model, so the not-ready card with a next action that works (not a dead end).
    // The error card takes focus from the h1 (its own heading is focused, see errors.ts).
    await expectStep(page, 'Explanation', { focus: false });
    const notReady = page.getByRole('heading', { name: "The on-device model isn't ready yet" });
    await expect(notReady).toBeVisible();
    await expect(notReady).toBeFocused();
    await expect(page.getByText('DEVICE_MODEL_NOT_READY')).toHaveCount(1);
    const toSetup = page.getByRole('button', { name: 'Go to setup' });
    await expect(toSetup).toBeVisible();
    expect(await bodyText(page)).not.toContain('{');

    // Questions: asking shows the same card with an action.
    await tab(page, /Questions/).click();
    await expectStep(page, 'Questions');
    await page.getByLabel('Your question').fill('What is this charge?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(page.getByRole('heading', { name: "The on-device model isn't ready yet" })).toBeVisible();
    await expect(
      page.getByText("The on-device model isn't ready. Set it up to ask questions."),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Go to setup' })).toBeVisible();
    await expect(page.locator('.answer-card')).toHaveCount(0);
    expect(await bodyText(page)).not.toContain('{');

    // Things to check: blocked, and the UI never even asked the cloud.
    await tab(page, /Things to check/).click();
    await expectStep(page, 'Things to check', { focus: false });
    const blocked = page.getByRole('heading', { name: 'Cloud features are unavailable' });
    await expect(blocked).toBeVisible();
    await expect(blocked).toBeFocused();
    await expect(page.locator('.flag-card')).toHaveCount(0);
    await tab(page, /Letter/).click();
    await expectStep(page, 'Letter', { focus: false });
    await expect(page.getByRole('heading', { name: 'Cloud features are unavailable' })).toBeFocused();
    await expect(page.getByLabel('Letter text, you can edit it')).toHaveCount(0);
    expect(await bodyText(page)).not.toContain('{');
    expect(await attempts(page)).toEqual({ auditBill: 0, draftLetter: 0 });
    expect(await cloudPayloads(page)).toEqual([]);

    // The explanation's action goes somewhere that helps: the model setup screen.
    await tab(page, /Explanation/).click();
    await expectStep(page, 'Explanation', { focus: false });
    await expect(page.getByRole('heading', { name: "The on-device model isn't ready yet" })).toBeFocused();
    await page.getByRole('button', { name: 'Go to setup' }).click();
    await expectStep(page, 'Set up');
    await expect(page.getByRole('button', { name: 'Use simple rules' })).toBeVisible();

    expect(errors.console).toEqual([]);
    expect(errors.page).toEqual([]);
  });

  test('Start over clears everything', async ({ page }) => {
    const errors = watchErrors(page);
    await reachExplanation(page);
    await tab(page, /Questions/).click();
    await expectStep(page, 'Questions');
    await page.getByLabel('Your question').fill('a question I have not sent');
    await page.getByRole('button', { name: 'Under the hood' }).click();
    const aside = page.getByRole('complementary', { name: 'Under the hood' });
    await expect(aside).toContainText('Calls this session: 2');

    // Positive control: there is something to clear.
    expect(await session(page)).toMatchObject({
      step: 'results',
      consent: 'agreed',
      hasDraft: true,
      hasApproval: true,
      hasInput: true,
      questionDraft: 'a question I have not sent',
    });
    expect(await session(page).then((s) => s.logLength)).toBe(2);

    await page.getByRole('button', { name: 'Start over' }).click();
    await page.getByRole('button', { name: 'Yes, start over' }).click();
    await expectStep(page, 'Add your medical bill');

    expect(await session(page)).toEqual({
      step: 'import',
      consent: 'notAsked',
      hasDraft: false,
      hasApproval: false,
      hasInput: false,
      logLength: 0,
      questionDraft: '',
    });
    await expect(page.getByRole('textbox', { name: 'Bill text' })).toHaveValue('');
    await expect(aside).toContainText('Calls this session: 0');
    await expect(aside).toContainText('No calls yet.');

    expect(errors.console).toEqual([]);
    expect(errors.page).toEqual([]);
  });
});
