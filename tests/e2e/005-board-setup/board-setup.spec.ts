import { test, expect } from '@playwright/test';

import * as fs from 'fs';
import * as path from 'path';

function toDataUrl(filePath: string) {
    const imageBuffer = fs.readFileSync(filePath);
    return `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
}

test.describe('Board Setup With Mocked Webcam', () => {
    test('Setup screen detects the board from a mocked webcam frame', async ({ page }, testInfo) => {
        const emptyBoardImageUrl = toDataUrl(path.join(process.cwd(), 'tests/images/game/empty.jpg'));

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
        const autoDetectButton = page.getByRole('button', { name: 'Auto-detect board' });
        const captureReferenceButton = page.getByRole('button', { name: 'Capture empty board' });
        const saveCalibrationButton = page.getByRole('button', { name: 'Save calibration' });
        const liveFrameStatus = page.locator('.card-title').filter({ hasText: 'Live Frame' }).locator('span').nth(1);
        const inlineNotice = page.locator('.inline-notice');

        await startWebcamButton.click();

        await expect(liveFrameStatus).toHaveText('Streaming');
        await expect(inlineNotice).toContainText(/Live camera ready|Browser camera connected/, { timeout: 20000 });
        await page.waitForTimeout(300);

        await testInfo.attach('stream-ready', {
            body: await page.screenshot(),
            contentType: 'image/png'
        });

        const defaultQuadPoints = await quadPolygon.getAttribute('points');
        await autoDetectButton.click();
        await expect(inlineNotice).toContainText('Board detected from', { timeout: 30000 });
        await expect(quadPolygon).not.toHaveAttribute('points', defaultQuadPoints ?? '');
        await expect(page.locator('.preview-card .detail-list strong').first()).not.toHaveText('Manual / saved');

        const firstHandle = page.getByLabel('Board corner 1');
        const detectedQuadPoints = await quadPolygon.getAttribute('points');
        const handleBox = await firstHandle.boundingBox();
        if (!handleBox) {
            throw new Error('Detected board corner handle is not visible.');
        }

        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(handleBox.x + handleBox.width / 2 + 24, handleBox.y + handleBox.height / 2 + 18, {
            steps: 6
        });
        await page.mouse.up();
        await expect(quadPolygon).not.toHaveAttribute('points', detectedQuadPoints ?? '');

        await captureReferenceButton.click();
        await expect(inlineNotice).toContainText('Empty-board reference captured.', { timeout: 15000 });

        await saveCalibrationButton.click();
        await expect(inlineNotice).toContainText('Calibration saved locally.');

        await expect(page.locator('.preview-card .detail-list strong').nth(1)).toHaveText('Captured');
        await testInfo.attach('opencv-detected-and-saved', {
            body: await page.screenshot(),
            contentType: 'image/png'
        });
    });
});
