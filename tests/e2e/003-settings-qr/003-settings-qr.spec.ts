import { test, expect } from '@playwright/test';
import { TestStepHelper } from '../helpers/test-step-helper';

import * as fs from 'fs';
import * as path from 'path';

test.describe('Settings QR Code Generation', () => {
    test.beforeAll(() => {
        const docPath = path.join(process.cwd(), 'tests/e2e/003-settings-qr/README.md');
        if (fs.existsSync(docPath)) fs.unlinkSync(docPath);
    });

    test('QR Code Generation', async ({ page }, testInfo) => {
        // Mock Math.random to make the generated token deterministic for snapshot testing
        await page.addInitScript(() => {
            Math.random = () => 0.5;
        });

        const tester = new TestStepHelper(page, testInfo);
        tester.setMetadata('Settings QR Code', 'Verify the QR code generation for camera pairing');

        await page.goto('/settings');
        
        await tester.step('000-settings-load', {
            description: 'Settings page loads correctly',
            networkStatus: 'skip',
            verifications: [
                { 
                    spec: 'Title is correct', 
                    check: async () => { 
                        await expect(page).toHaveTitle('Settings');
                    } 
                },
                {
                    spec: 'SSID input is visible',
                    check: async () => {
                        await expect(page.locator('#ssid')).toBeVisible();
                    }
                },
                {
                    spec: 'Password input is visible',
                    check: async () => {
                        await expect(page.locator('#password')).toBeVisible();
                    }
                }
            ]
        });

        // Fill inputs and click generate
        await page.fill('#ssid', 'MyTestWiFi');
        await page.fill('#password', 'SuperSecret123');
        await page.click('button.generate-btn');

        await tester.step('001-qr-code-generated', {
            description: 'QR code and token are generated and displayed',
            networkStatus: 'skip',
            verifications: [
                {
                    spec: 'QR code image is visible',
                    check: async () => {
                        await expect(page.locator('.qr-container img')).toBeVisible();
                    }
                },
                {
                    spec: 'Token text is visible',
                    check: async () => {
                        await expect(page.locator('.token-text')).toBeVisible();
                        await expect(page.locator('.token-text')).toContainText('Pairing Token:');
                    }
                }
            ]
        });
        
        tester.generateDocs();
    });
});
