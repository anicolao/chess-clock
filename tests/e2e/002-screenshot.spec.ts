import { test, expect } from '@playwright/test';

test('Baseline Screenshot', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('baseline.png', { fullPage: true });
});
