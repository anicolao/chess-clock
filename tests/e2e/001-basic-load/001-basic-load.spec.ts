import { test, expect } from '@playwright/test';
import { TestStepHelper } from '../helpers/test-step-helper';

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
                    await expect(page.locator('h1')).toHaveText('Chess Logger & Clock');
                } 
            }
        ]
    });
    
    tester.generateDocs();
});
