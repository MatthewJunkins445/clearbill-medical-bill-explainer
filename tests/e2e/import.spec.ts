import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const sampleText = readFileSync(
  path.join(import.meta.dirname, '../../samples/bills/itemized-er-laceration/bill.txt'),
  'utf8',
);

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const textbox = (page: Page) => page.getByRole('textbox', { name: 'Bill text' });
const deviceState = (page: Page) =>
  page.evaluate(async () => {
    const hook = window.__clearbill;
    if (!hook) throw new Error('test hook missing');
    return (await hook.current().ai.getDeviceStatus()).state;
  });
const check = (page: Page) => page.getByRole('button', { name: 'Check my bill' });

test.describe('import, setup and working screens (mock AI)', () => {
  test('whitespace-only paste keeps Continue disabled, real text enables it', async ({ page }) => {
    await page.goto('/');
    await expect(check(page)).toBeDisabled();
    await expect(check(page)).toHaveAttribute('aria-describedby', 'submit-hint');
    await expect(page.getByText('Add a bill first.')).toBeVisible();
    await textbox(page).fill('   \n\t  ');
    await expect(check(page)).toBeDisabled();
    await textbox(page).fill('Patient charges');
    await expect(check(page)).toBeEnabled();
    // A hidden hint would still be read through aria-describedby, so the link must be gone.
    await expect(check(page)).not.toHaveAttribute('aria-describedby', /.*/);
    await expect(page.getByText('Add a bill first.')).toBeHidden();
  });

  test('the built-in sample reaches the review step', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Try a sample bill' }).click();
    await expect(h1(page)).toHaveText('Check details');
  });

  test('non-bill text shows the NOT_A_BILL card, and its action returns to an empty S01', async ({
    page,
  }) => {
    await page.goto('/');
    await textbox(page).fill('Electric company statement. Amount due 42.10');
    await check(page).click();
    const card = page.getByRole('alert').filter({ hasText: "This doesn't look like a medical bill" });
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { level: 2 })).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await card.getByRole('button', { name: 'Use a different bill' }).click();
    await expect(h1(page)).toHaveText('Add your medical bill');
    await expect(textbox(page)).toHaveValue('');
  });

  test('Under the hood updates the device state live while it is open', async ({ page }) => {
    const scenario = encodeURIComponent(JSON.stringify({ deviceStates: ['downloadable'] }));
    await page.goto(`/?scenario=${scenario}`);
    await textbox(page).fill(sampleText);
    await check(page).click();
    await expect(page.getByRole('button', { name: 'Download model' })).toBeVisible();
    await page.getByRole('button', { name: 'Under the hood' }).click();
    const status = page.getByRole('complementary', { name: 'Under the hood' }).locator('dl');
    await expect(status).toContainText('Not downloaded');
    await page.getByRole('button', { name: 'Download model' }).click();
    // The panel stays open and repaints from subscribeDeviceStatus, without being reopened.
    await expect(status).toContainText('Ready');
  });

  test('a downloadable model: Download model is user-started, then Continue proceeds', async ({ page }) => {
    const scenario = encodeURIComponent(JSON.stringify({ deviceStates: ['downloadable'] }));
    await page.goto(`/?scenario=${scenario}`);
    await textbox(page).fill(sampleText);
    await check(page).click();
    await expect(h1(page)).toHaveText('Set up');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Download the private on-device model');
    // Nothing has started by itself: the device is still only downloadable, and Download is offered.
    expect(await deviceState(page)).toBe('downloadable');
    await expect(page.getByRole('button', { name: 'Download model' })).toBeVisible();
    await page.getByRole('button', { name: 'Download model' }).click();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('The on-device model is ready');
    await expect(h1(page)).toHaveText('Set up');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(h1(page)).toHaveText('Check details');
  });

  test('"Use simple rules" skips the download and proceeds', async ({ page }) => {
    const scenario = encodeURIComponent(JSON.stringify({ deviceStates: ['unsupported'] }));
    await page.goto(`/?scenario=${scenario}`);
    await page.getByRole('button', { name: 'Try a sample bill' }).click();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(
      "This browser can't run the on-device model",
    );
    await page.getByRole('button', { name: 'What does my computer need?' }).click();
    await expect(page.getByText('Use an up-to-date desktop Chrome')).toBeVisible();
    await page.getByRole('button', { name: 'Use simple rules' }).click();
    await expect(h1(page)).toHaveText('Check details');
  });

  test('over-length input returns to S01 with the text kept', async ({ page }) => {
    const long = 'Medical hospital patient ' + 'x'.repeat(16_001);
    await page.goto('/');
    await textbox(page).fill(long);
    await check(page).click();
    await expect(h1(page)).toHaveText('Add your medical bill');
    await expect(
      page.getByRole('heading', { level: 2, name: 'This is too much text at once' }),
    ).toBeVisible();
    await expect(textbox(page)).toHaveValue(long);
    await page.getByRole('button', { name: 'Edit the text' }).click();
    await expect(textbox(page)).toBeFocused();
  });

  test('tracks an existing model download through final setup', async ({ page }) => {
    await page.clock.install();
    const scenario = encodeURIComponent(JSON.stringify({
      deviceStates: ['downloading', 'downloading', 'available'],
      downloadProgress: [0.42, 1],
      latencyMs: 400,
    }));
    await page.goto(`/?scenario=${scenario}`);
    await page.getByRole('button', { name: 'Try a sample bill' }).click();
    const progress = page.getByRole('progressbar');
    await expect(progress).toBeVisible();
    await expect(progress).not.toHaveAttribute('value');
    await expect(page.getByText('Waiting for Chrome to report a download percentage.')).toBeVisible();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.getByRole('button', { name: 'Show download progress' }).click();
    await page.clock.runFor(800);
    await expect(page.getByText('42% downloaded.')).toBeVisible();
    await expect(progress).toHaveAttribute('value', '42');
    await page.clock.runFor(400);
    await expect(page.getByText('100% downloaded. Chrome is getting the model ready.')).toBeVisible();
    expect(await page.evaluate(() => document.body.innerText)).not.toContain('{');
    await page.clock.runFor(400);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('The on-device model is ready');
    expect(await page.evaluate(() => document.body.innerText)).not.toContain('{');
  });

  test('a pasted copy of the sample is a user paste, and the redaction call is logged once', async ({
    page,
  }) => {
    await page.goto('/');
    await textbox(page).fill(sampleText);
    await check(page).click();
    await expect(h1(page)).toHaveText('Check details');
    const seen = await page.evaluate(() => {
      const hook = window.__clearbill;
      if (!hook) throw new Error('test hook missing');
      const { input, log } = hook.current().getSession();
      return {
        kind: input?.kind,
        origin: input?.kind === 'text' ? input.origin : null,
        steps: log.map((entry) => entry.step),
      };
    });
    expect(seen).toEqual({ kind: 'text', origin: 'paste', steps: ['redaction'] });
  });

  test('a failed download shows the error, and Retry downloads again only after the user clicked', async ({
    page,
  }) => {
    const scenario = encodeURIComponent(
      JSON.stringify({ deviceStates: ['downloadable'], errorCodes: { prepareDeviceModel: 'NETWORK' } }),
    );
    await page.goto(`/?scenario=${scenario}`);
    await page.getByRole('button', { name: 'Try a sample bill' }).click();
    await expect(page.getByRole('button', { name: 'Download model' })).toBeVisible();
    expect(await deviceState(page)).toBe('downloadable');
    await page.getByRole('button', { name: 'Download model' }).click();
    const alert = page.getByRole('alert').filter({ hasText: "Can't reach the internet" });
    await expect(alert).toBeVisible();
    // The user clicked Download first, so Retry is the download again, and the button is usable again.
    await expect(page.getByRole('button', { name: 'Download model' })).toBeEnabled();
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(alert).toBeVisible();
    expect(await deviceState(page)).toBe('downloadable');
  });
});
