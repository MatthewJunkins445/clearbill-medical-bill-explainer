import { expect, test } from '@playwright/test';

test.describe('app shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('skip link is the first focusable element and moves focus to the heading', async ({ page }) => {
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  });

  test('has landmarks, exactly one h1 and a step title in the page title', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toContainText('Not medical, legal or financial advice.');
    await expect(page.getByRole('navigation', { name: 'Progress' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(1);
    await expect(page.getByRole('alert')).toHaveCount(1);
    const h1 = await page.getByRole('heading', { level: 1 }).innerText();
    await expect(page).toHaveTitle(`${h1} · ClearBill`);
  });

  test('step nav has exactly one current step', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Progress' });
    await expect(nav.getByRole('listitem')).toHaveCount(8);
    await expect(nav.locator('[aria-current="step"]')).toHaveCount(1);
    await expect(nav.locator('[aria-current="step"]')).toContainText('Add bill');
  });

  test('Start over asks for confirmation first, and can be cancelled', async ({ page }) => {
    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page.getByText('Start over with a new bill?')).toBeVisible();
    await page.getByRole('button', { name: 'Keep working' }).click();
    await expect(page.getByText('Start over with a new bill?')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Start over' })).toBeFocused();

    await page.getByRole('button', { name: 'Start over' }).click();
    await page.getByRole('button', { name: 'Yes, start over' }).click();
    await expect(page.getByText('Start over with a new bill?')).toBeHidden();
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  });

  test('Under the hood toggles a labelled complementary region', async ({ page }) => {
    const toggle = page.getByRole('button', { name: 'Under the hood' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('complementary')).toHaveCount(0);
    await toggle.click();
    const aside = page.getByRole('complementary', { name: 'Under the hood' });
    await expect(aside).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hide under the hood' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(aside).toBeHidden();
    await expect(page.getByRole('button', { name: 'Under the hood' })).toBeFocused();
  });

  test('shows no unfilled {placeholders}', async ({ page }) => {
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).not.toContain('{');
  });

  test('ignores a malformed scenario parameter and still renders', async ({ page }) => {
    await page.goto('/?scenario=%7Bnot-json');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('reflows at 320px without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

// Screen lifecycle. The mock-mode-only hook `window.__clearbill.current()` returns the context of the
// screen that is rendered now, which is how a real screen would see it.
test.describe('screen context lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('subscribe is notified by update and record, and the Under the hood count follows', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Under the hood' }).click();
    const calls = await page.evaluate(() => {
      const hook = window.__clearbill;
      if (!hook) throw new Error('test hook missing');
      const ctx = hook.current();
      const seen: number[] = [];
      ctx.subscribe((s) => seen.push(s.log.length));
      ctx.update((s) => ({ ...s, consent: 'agreed' })); // same step: no re-render, still notifies
      ctx.record('redact', {
        data: null,
        source: 'ON_DEVICE',
        model: 'm',
        mode: 'ONLY_ON_DEVICE',
        latencyMs: 1,
        fellBack: false,
        promptVersion: 'p',
      });
      return seen;
    });
    expect(calls).toEqual([0, 1]);
    await expect(page.locator('#under-the-hood')).toContainText(': 1');
  });

  test('a discarded screen gets no notifications and its calls are ignored', async ({ page }) => {
    const result = await page.evaluate(() => {
      const hook = window.__clearbill;
      if (!hook) throw new Error('test hook missing');
      const old = hook.current();
      let notified = 0;
      let disposed = 0;
      old.subscribe(() => notified++);
      old.onDispose(() => disposed++);
      old.update((s) => ({ ...s, step: 'model' })); // step change: the screen is discarded
      const stale = {
        aborted: old.signal.aborted,
        disposed,
        notifiedAfterNavigate: notified,
      };
      // Stale async results arriving from the discarded screen:
      old.update((s) => ({ ...s, step: 'review' }));
      old.showError('NETWORK');
      old.announce('stale');
      const fresh = hook.current();
      return {
        ...stale,
        stepAfterStaleUpdate: fresh.getSession().step,
        freshIsNewContext: fresh !== old,
        freshAborted: fresh.signal.aborted,
      };
    });
    expect(result).toEqual({
      aborted: true,
      disposed: 1,
      notifiedAfterNavigate: 0, // disposed during the navigating update, so it is never called
      stepAfterStaleUpdate: 'model',
      freshIsNewContext: true,
      freshAborted: false,
    });
    await expect(page.getByRole('alert')).toBeEmpty();
    await expect(page.getByRole('status')).toBeEmpty();
  });

  test('Start over disposes the current screen', async ({ page }) => {
    await page.evaluate(() => {
      const hook = window.__clearbill;
      if (!hook) throw new Error('test hook missing');
      const ctx = hook.current();
      window.__disposed = 0;
      ctx.onDispose(() => (window.__disposed = (window.__disposed ?? 0) + 1));
    });
    await page.getByRole('button', { name: 'Start over' }).click();
    await page.getByRole('button', { name: 'Yes, start over' }).click();
    expect(await page.evaluate(() => window.__disposed)).toBe(1);
  });

  test('showError renders above main, near the top', async ({ page }) => {
    await page.evaluate(() => {
      const hook = window.__clearbill;
      if (!hook) throw new Error('test hook missing');
      hook.current().showError('NETWORK', () => undefined);
    });
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Try again');
    const before = await page.evaluate(() => {
      const a = document.querySelector('[role="alert"]');
      const m = document.querySelector('main');
      const f = document.querySelector('footer');
      if (!a || !m || !f) throw new Error('landmarks missing');
      return {
        aboveMain: Boolean(a.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING),
        aboveFooter: Boolean(a.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    });
    expect(before).toEqual({ aboveMain: true, aboveFooter: true });
    const [alertBox, mainBox] = [await alert.boundingBox(), await page.getByRole('main').boundingBox()];
    if (!alertBox || !mainBox) throw new Error('no layout box');
    expect(alertBox.y).toBeLessThan(mainBox.y);
    await expect(page.getByRole('alert')).toHaveCount(1);
  });
});
