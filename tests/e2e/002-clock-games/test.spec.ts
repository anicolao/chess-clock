import { test, expect } from '@playwright/test';
import { TestStepHelper } from '../helpers/test-step-helper';

test.describe('Chess Clock Games', () => {
    test.beforeEach(async ({ page }) => {
        await page.clock.pauseAt(new Date('2026-01-01T12:00:00.000Z'));
    });

    test('Game without increment', async ({ page }, testInfo) => {
        const helper = new TestStepHelper(page, testInfo);
        
        await page.goto('/?time=60000&inc=0');
        
        await helper.step('01-initial-state', {
            description: 'Clock loaded in idle state',
            verifications: [
                {
                    spec: 'Both clocks show 01:00',
                    check: async () => {
                        await expect(page.getByTestId('clock-white')).toContainText('01:00');
                        await expect(page.getByTestId('clock-black')).toContainText('01:00');
                    }
                }
            ],
            networkStatus: 'skip'
        });

        // White taps to start Black's clock
        await page.getByTestId('clock-white').click();
        
        // Fast forward 5 seconds
        await page.clock.fastForward(5000);
        
        await helper.step('02-black-ticking', {
            description: 'Black clock is ticking',
            verifications: [
                {
                    spec: 'Black clock shows 55.0',
                    check: async () => {
                        await expect(page.getByTestId('clock-black')).toContainText('55.0');
                        await expect(page.getByTestId('clock-white')).toContainText('01:00');
                    }
                }
            ],
            networkStatus: 'skip'
        });

        // Black taps to end turn
        await page.getByTestId('clock-black').click();

        // Fast forward 35 seconds
        await page.clock.fastForward(35000);

        await helper.step('03-white-ticking-warning', {
            description: 'White clock ticking and goes below 30s',
            verifications: [
                {
                    spec: 'White clock shows 25.0',
                    check: async () => {
                        await expect(page.getByTestId('clock-white')).toContainText('25.0');
                    }
                }
            ],
            networkStatus: 'skip'
        });
        
        // Fast forward remaining 25 seconds
        await page.clock.fastForward(26000);

        await helper.step('04-white-timeout', {
            description: 'White runs out of time',
            verifications: [
                {
                    spec: 'White clock shows 00:00.0 and game is over',
                    check: async () => {
                        await expect(page.getByTestId('clock-white')).toContainText('00:00.0');
                        await expect(page.getByTestId('clock-white')).toHaveClass(/lost/);
                    }
                }
            ],
            networkStatus: 'skip'
        });
    });

    test('Game with increment', async ({ page }, testInfo) => {
        const helper = new TestStepHelper(page, testInfo);
        
        await page.goto('/?time=10000&inc=5000');
        
        await helper.step('01-initial-state-inc', {
            description: 'Clock loaded in idle state with 10s base',
            verifications: [
                {
                    spec: 'Both clocks show 10.0',
                    check: async () => {
                        await expect(page.getByTestId('clock-white')).toContainText('10.0');
                        await expect(page.getByTestId('clock-black')).toContainText('10.0');
                    }
                }
            ],
            networkStatus: 'skip'
        });

        // White taps to start Black's clock
        await page.getByTestId('clock-white').click();
        
        // Fast forward 4 seconds
        await page.clock.fastForward(4000);
        
        // Black taps to end turn
        await page.getByTestId('clock-black').click();
        
        await helper.step('02-black-increment-added', {
            description: 'Black clock got increment added',
            verifications: [
                {
                    spec: 'Black clock shows 11.0 (10 - 4 + 5)',
                    check: async () => {
                        await expect(page.getByTestId('clock-black')).toContainText('11.0');
                    }
                }
            ],
            networkStatus: 'skip'
        });
    });
});
