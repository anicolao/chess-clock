import { test, expect } from '@playwright/test';
import { TestStepHelper } from '../helpers/test-step-helper';

import * as fs from 'fs';
import * as path from 'path';

test.describe('Basic Load', () => {
    test.beforeAll(() => {
        const docPath = path.join(process.cwd(), 'tests/e2e/001-basic-load/README.md');
        if (fs.existsSync(docPath)) fs.unlinkSync(docPath);
    });

    test('Basic Loading', async ({ page }, testInfo) => {
    const tester = new TestStepHelper(page, testInfo);
    tester.setMetadata('Basic Loading', 'Verify the initial state of the Chess app');

    await page.goto('/');
    
    await tester.step('initial-load', {
        description: 'App loads and displays the correct title',
        networkStatus: 'skip',
        verifications: [
            { 
                spec: 'Title is correct', 
                check: async () => { 
                    await expect(page).toHaveTitle('Chess Clock');
                } 
            }
        ]
    });
    
    tester.generateDocs();
});
});
