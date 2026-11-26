import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const sampleText = readFileSync(
  path.join(import.meta.dirname, '../../samples/bills/itemized-er-laceration/bill.txt'),
  'utf8',
);

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const region = (page: Page) => page.getByRole('region', { name: /Bill text after removal/ });
const rows = (page: Page) => page.locator('.detail-row');

async function openReview(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample bill' }).click();
  await expect(h1(page)).toHaveText('Check details');
}

const session = (page: Page) =>
  page.evaluate(() => {
    const hook = window.__clearbill;
    if (!hook) throw new Error('test hook missing');
    const s = hook.current().getSession();
    return {
      step: s.step,
      consent: s.consent,
      hasApproval: s.approval !== null,
      approvedText: s.approval ? (s.approval.bill as unknown as { redactedText: string }).redactedText : null,
      lockedValues: (s.draft?.entities ?? []).filter((e) => e.locked).map((e) => e.value),
    };
  });

test.describe('review screen (mock AI)', () => {
  test('toggling a non-locked row flips aria-pressed and keeps focus on that toggle', async ({ page }) => {
    await openReview(page);
    const row = rows(page)
      .filter({ hasNot: page.locator('.tag') })
      .first();
    const button = row.getByRole('button');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(button).toBeFocused();
    await page.keyboard.press('Space');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(button).toBeFocused();
  });

  test('the details list is one tab stop and Up/Down/Home/End move between rows', async ({ page }) => {
    await openReview(page);
    const buttons = page.locator('.detail-row button');
    expect(await buttons.count()).toBeGreaterThan(2);
    expect(await page.locator('.detail-row button[tabindex="0"]').count()).toBe(1);
    await buttons.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(buttons.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(buttons.last()).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(buttons.nth((await buttons.count()) - 2)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(buttons.first()).toBeFocused();
    expect(await page.locator('.detail-row button[tabindex="0"]').count()).toBe(1);
  });

  test('keeping always-removed details still yields a redacted preview, with the guard notice', async ({
    page,
  }) => {
    await openReview(page);
    const { lockedValues } = await session(page);
    expect(lockedValues.length).toBeGreaterThan(0);
    const locked = rows(page).filter({ has: page.locator('.tag') });
    const count = await locked.count();
    for (let i = 0; i < count; i++) await locked.nth(i).getByRole('button').click();
    const text = (await region(page).textContent()) ?? '';
    for (const value of lockedValues) expect(text).not.toContain(value);
    await expect(page.getByText(/will still be removed/)).toBeVisible();
    await page.getByRole('button', { name: 'Looks right, continue' }).click();
    await expect(h1(page)).toHaveText('Your choice');
    const after = await session(page);
    expect(after.hasApproval).toBe(true);
    for (const value of lockedValues) expect(after.approvedText).not.toContain(value);
  });

  test('a word that is not in the bill shows the no-match message; one that is adds a row and changes the preview', async ({
    page,
  }) => {
    await openReview(page);
    const field = page.getByLabel('Words to remove');
    await field.fill('Zzyzx');
    await page.getByRole('button', { name: 'Remove these words' }).click();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('We couldn\'t find "Zzyzx" in the bill. Check the spelling.')).toBeVisible();
    expect(await field.getAttribute('aria-describedby')).toBe('add-error');

    expect(await region(page).textContent()).toContain('Tdap');
    await field.fill('Tdap');
    await expect(field).not.toHaveAttribute('aria-invalid', 'true');
    await page.getByLabel('What kind of detail is it?').selectOption('OTHER_ID');
    await page.getByRole('button', { name: 'Remove these words' }).click();
    const added = rows(page).filter({ hasText: 'Added by you' });
    await expect(added).toHaveCount(1);
    await expect(added.getByRole('button')).toBeFocused();
    expect(await region(page).textContent()).not.toContain('Tdap');
    expect(await region(page).textContent()).toContain('[OTHER_ID_1]');
    await added.getByRole('button').click();
    await expect(rows(page).filter({ hasText: 'Added by you' })).toHaveCount(0);
    expect(await region(page).textContent()).toContain('Tdap');
  });

  test('Show original swaps the preview text; its name stays the same and aria-pressed carries the state', async ({
    page,
  }) => {
    await openReview(page);
    const toggle = page.getByRole('button', { name: 'Show original' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAccessibleName('Show original');
    expect(await region(page).textContent()).toContain('NV81995635');
  });

  test('a row toggle keeps its accessible name while aria-pressed changes', async ({ page }) => {
    await openReview(page);
    const button = rows(page)
      .filter({ hasNot: page.locator('.tag') })
      .first()
      .getByRole('button');
    const name = await button.getAttribute('aria-label');
    expect(name).toMatch(/^Remove /);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(await button.getAttribute('aria-label')).toBe(name);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(await button.getAttribute('aria-label')).toBe(name);
  });

  test('revisiting Review drops the old approval and consent; Continue approves again', async ({ page }) => {
    await openReview(page);
    await page.getByRole('button', { name: 'Looks right, continue' }).click();
    await expect(h1(page)).toHaveText('Your choice');
    await page.evaluate(() => {
      const hook = window.__clearbill;
      if (!hook) throw new Error('test hook missing');
      hook.current().update((s) => ({ ...s, consent: 'agreed' }));
    });
    expect((await session(page)).consent).toBe('agreed');
    await page.getByRole('link', { name: /Check details/ }).click();
    await expect(h1(page)).toHaveText('Check details');
    await expect.poll(async () => (await session(page)).hasApproval).toBe(false);
    expect((await session(page)).consent).toBe('notAsked');
    await page.getByRole('button', { name: 'Looks right, continue' }).click();
    await expect(h1(page)).toHaveText('Your choice');
    expect(await session(page)).toMatchObject({ step: 'consent', hasApproval: true, consent: 'notAsked' });
  });

  test('rules-only: banner as a note and a Simple rules badge on the heading', async ({ page }) => {
    const scenario = encodeURIComponent(JSON.stringify({ deviceStates: ['unsupported'] }));
    await page.goto(`/?scenario=${scenario}`);
    await page.getByRole('textbox', { name: 'Bill text' }).fill(sampleText);
    await page.getByRole('button', { name: 'Check my bill' }).click();
    await page.getByRole('button', { name: 'Use simple rules' }).click();
    await expect(h1(page)).toHaveText('Check details');
    await expect(page.getByRole('note').filter({ hasText: 'Using simple rules, not AI' })).toBeVisible();
    await expect(page.locator('.heading-row .badge-LOCAL_RULES')).toHaveCount(1);
  });

  test('Continue lands on the consent step with an approval and consent not asked', async ({ page }) => {
    await openReview(page);
    await page.getByRole('button', { name: 'Looks right, continue' }).click();
    await expect(h1(page)).toHaveText('Your choice');
    const s = await session(page);
    expect(s).toMatchObject({ step: 'consent', hasApproval: true, consent: 'notAsked' });
  });

  test('Use a different bill returns to an empty import step', async ({ page }) => {
    await openReview(page);
    await page.getByRole('button', { name: 'Use a different bill' }).click();
    await expect(h1(page)).toHaveText('Add your medical bill');
  });

  test('shows no unfilled placeholders', async ({ page }) => {
    await openReview(page);
    expect(await page.evaluate(() => document.body.innerText)).not.toContain('{');
  });
});
