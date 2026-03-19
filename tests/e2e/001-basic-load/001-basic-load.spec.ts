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

    test('Log report opens a GitHub issue draft', async ({ page }) => {
        await page.addInitScript(() => {
            const state = {
                lastOpenedUrl: '',
                openCount: 0
            };

            (window as typeof window & {
                __logReportPopupState?: typeof state;
            }).__logReportPopupState = state;

            window.open = (() => {
                state.openCount += 1;
                const fakeWindow = {
                    opener: window,
                    closed: false,
                    document: {
                        title: '',
                        body: {
                            innerHTML: ''
                        }
                    },
                    location: {
                        replace(nextUrl: string | URL) {
                            state.lastOpenedUrl = String(nextUrl);
                        }
                    },
                    close() {
                        fakeWindow.closed = true;
                    }
                };
                return fakeWindow as unknown as Window;
            }) as typeof window.open;
        });

        await page.goto('/');
        await page.getByTestId('log-report').click();

        await expect.poll(() =>
            page.evaluate(() => (window as typeof window & {
                __logReportPopupState?: { lastOpenedUrl: string; openCount: number };
            }).__logReportPopupState ?? { lastOpenedUrl: '', openCount: 0 })
        ).toMatchObject({
            openCount: 1
        });
        await expect.poll(() =>
            page.evaluate(() => (window as typeof window & {
                __logReportPopupState?: { lastOpenedUrl: string; openCount: number };
            }).__logReportPopupState?.lastOpenedUrl ?? '')
        ).toContain(
            'https://github.com/anicolao/chess-clock/issues/new'
        );
    });
});
