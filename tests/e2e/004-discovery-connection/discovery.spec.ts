import { test, expect } from '@playwright/test';
import { TestStepHelper } from '../helpers/test-step-helper';
import { CameraEmulator } from '../helpers/emulator';
import * as fs from 'fs';
import * as path from 'path';

let emulator: CameraEmulator;

test.describe('Discovery and Connection', () => {

    test.beforeAll(async () => {
        const docPath = path.join(process.cwd(), 'tests/e2e/004-discovery-connection/README.md');
        if (fs.existsSync(docPath)) fs.unlinkSync(docPath);
        
        emulator = new CameraEmulator();
        await emulator.start();
    });

    test.afterAll(async () => {
        if (emulator) {
            await emulator.stop();
        }
    });

    test('Successful Connection to Emulator', async ({ page }, testInfo) => {
        const helper = new TestStepHelper(page, testInfo);
        
        const cameraUrl = `http://localhost:${emulator.port}`;
        await page.goto(`/?camera_url=${encodeURIComponent(cameraUrl)}`);
        
        await helper.step('01-camera-connected', {
            description: 'App successfully connects to the emulated camera',
            networkStatus: 'synced',
            verifications: [
                {
                    spec: 'Network status indicator shows synced state',
                    check: async () => {
                        await expect(page.locator('button[data-status]')).toHaveAttribute('data-status', 'synced');
                    }
                }
            ]
        });

        helper.generateDocs();
    });
});
