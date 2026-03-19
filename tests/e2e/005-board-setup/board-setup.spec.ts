import { test, expect } from '@playwright/test';
import { TestStepHelper } from '../helpers/test-step-helper';

import * as fs from 'fs';
import * as path from 'path';

function toDataUrl(filePath: string) {
    const imageBuffer = fs.readFileSync(filePath);
    return `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
}

test.describe('Board Setup With Mocked Webcam', () => {
    test.beforeAll(() => {
        const docPath = path.join(process.cwd(), 'tests/e2e/005-board-setup/README.md');
        if (fs.existsSync(docPath)) fs.unlinkSync(docPath);
    });

    test('Setup screen works with an empty-board webcam frame', async ({ page }, testInfo) => {
        const helper = new TestStepHelper(page, testInfo);
        const emptyBoardImageUrl = toDataUrl(path.join(process.cwd(), 'tests/images/empty_board.jpg'));

        await page.addInitScript(({ imageUrl }) => {
            Object.defineProperty(navigator, 'mediaDevices', {
                value: {
                    getUserMedia: async () => {
                        const image = new Image();
                        image.src = imageUrl;
                        await new Promise<void>((resolve, reject) => {
                            image.onload = () => resolve();
                            image.onerror = () => reject(new Error('Mock webcam image failed to load.'));
                        });

                        const canvas = document.createElement('canvas');
                        canvas.width = image.naturalWidth || image.width;
                        canvas.height = image.naturalHeight || image.height;
                        const context = canvas.getContext('2d');
                        if (!context) {
                            throw new Error('Mock webcam canvas context is unavailable.');
                        }

                        const drawFrame = () => {
                            context.drawImage(image, 0, 0, canvas.width, canvas.height);
                        };

                        drawFrame();
                        return canvas.captureStream(1);
                    }
                },
                configurable: true
            });
        }, { imageUrl: emptyBoardImageUrl });

        await page.goto('/settings');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(250);

        const quadPolygon = page.locator('svg.quad-overlay polygon');
        const startWebcamButton = page.getByRole('button', { name: 'Start webcam' });
        const saveCalibrationButton = page.getByRole('button', { name: 'Save calibration' });

        await startWebcamButton.click();

        await expect(page.locator('.card-title').filter({ hasText: 'Live Frame' }).locator('span').nth(1)).toHaveText('Streaming');
        await expect(page.locator('.inline-notice')).toContainText(/Live camera ready|Browser camera connected/, { timeout: 20000 });
        await page.waitForTimeout(300);

        await helper.step('000-stream-ready', {
            description: 'Settings screen connects to the mocked webcam and shows the live board frame',
            networkStatus: 'skip',
            verifications: [
                {
                    spec: 'Live frame is streaming',
                    check: async () => {
                        await expect(page.locator('.card-title').filter({ hasText: 'Live Frame' }).locator('span').nth(1)).toHaveText('Streaming');
                    }
                },
                {
                    spec: 'Auto-detect becomes available once the webcam is live',
                    check: async () => {
                        await expect(page.getByRole('button', { name: 'Auto-detect board' })).toBeEnabled();
                    }
                }
            ]
        });

        const defaultQuadPoints = await quadPolygon.getAttribute('points');
        const firstHandle = page.getByLabel('Board corner 1');
        const handleBox = await firstHandle.boundingBox();
        if (!handleBox) {
            throw new Error('Board corner handle is not visible.');
        }

        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(handleBox.x + handleBox.width / 2 + 36, handleBox.y + handleBox.height / 2 + 28, {
            steps: 6
        });
        await page.mouse.up();

        await expect(quadPolygon).not.toHaveAttribute('points', defaultQuadPoints ?? '');

        await saveCalibrationButton.click();
        await expect(page.locator('.inline-notice')).toContainText('Calibration saved locally.');

        await helper.step('001-quad-adjusted-and-saved', {
            description: 'Setup screen lets the user adjust the quad over the mocked webcam frame and save calibration',
            networkStatus: 'skip',
            verifications: [
                {
                    spec: 'Dragging a corner updates the board quad',
                    check: async () => {
                        await expect(quadPolygon).not.toHaveAttribute('points', defaultQuadPoints ?? '');
                    }
                },
                {
                    spec: 'Manual calibration can be saved after adjustment',
                    check: async () => {
                        await expect(page.locator('.inline-notice')).toContainText('Calibration saved locally.');
                    }
                }
            ]
        });

        helper.generateDocs();
    });
});
