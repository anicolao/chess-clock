import { test, expect } from '@playwright/test';

test('US-001: Basic Loading', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Chess Logger & Clock');
});
