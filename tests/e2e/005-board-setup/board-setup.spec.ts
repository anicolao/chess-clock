import { test, expect } from '@playwright/test';

import * as fs from 'fs';
import * as path from 'path';

function toDataUrl(filePath: string) {
    const imageBuffer = fs.readFileSync(filePath);
    return `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
}

async function saveDocScreenshot(page: import('@playwright/test').Page, filename: string) {
    const screenshotPath = path.join(process.cwd(), 'tests/e2e/005-board-setup/screenshots', filename);
    await page.screenshot({ path: screenshotPath });
}

test.describe('Board Setup With Mocked Webcam', () => {
    test('Setup screen detects the board from a mocked webcam frame', async ({ page }, testInfo) => {
        const emptyBoardImageUrl = toDataUrl(path.join(process.cwd(), 'tests/images/game/empty.jpg'));
        const initialSetupImageUrl = toDataUrl(path.join(process.cwd(), 'tests/images/game/initial_setup.jpg'));

        await page.addInitScript(({ imageUrl }) => {
            let currentFrameImageUrl = imageUrl;

            const loadFrameImage = (nextImageUrl: string) => {
                const image = new Image();
                image.src = nextImageUrl;
                return new Promise<HTMLImageElement>((resolve, reject) => {
                    image.onload = () => resolve(image);
                    image.onerror = () => reject(new Error('Mock webcam image failed to load.'));
                });
            };

            (window as typeof window & {
                __setMockWebcamFrame?: (nextImageUrl: string) => Promise<void>;
            }).__setMockWebcamFrame = async (nextImageUrl: string) => {
                currentFrameImageUrl = nextImageUrl;
            };

            Object.defineProperty(navigator, 'mediaDevices', {
                value: {
                    getUserMedia: async () => {
                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d');
                        if (!context) {
                            throw new Error('Mock webcam canvas context is unavailable.');
                        }

                        let currentImage = await loadFrameImage(currentFrameImageUrl);
                        canvas.width = currentImage.naturalWidth || currentImage.width;
                        canvas.height = currentImage.naturalHeight || currentImage.height;

                        const drawFrame = async () => {
                            if (currentImage.src !== currentFrameImageUrl) {
                                currentImage = await loadFrameImage(currentFrameImageUrl);
                            }
                            context.drawImage(currentImage, 0, 0, canvas.width, canvas.height);
                        };

                        await drawFrame();
                        const redrawTimer = window.setInterval(() => {
                            void drawFrame();
                        }, 250);
                        const stream = canvas.captureStream(4);
                        for (const track of stream.getTracks()) {
                            const originalStop = track.stop.bind(track);
                            track.stop = () => {
                                window.clearInterval(redrawTimer);
                                originalStop();
                            };
                        }
                        return stream;
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
        const occupiedSquaresValue = page.locator('.preview-card .detail-list strong').nth(2);

        await startWebcamButton.click();

        await expect(liveFrameStatus).toHaveText('Streaming');
        await expect(inlineNotice).toContainText(/Live camera ready|Browser camera connected/, { timeout: 20000 });
        await page.waitForTimeout(300);

        await saveDocScreenshot(page, '000-000-stream-ready.png');
        await testInfo.attach('stream-ready', {
            body: await page.screenshot(),
            contentType: 'image/png'
        });

        const defaultQuadPoints = await quadPolygon.getAttribute('points');
        await autoDetectButton.click();
        await expect(inlineNotice).toContainText(/OpenCV/, { timeout: 5000 });
        await expect(inlineNotice).toContainText('Board detected from', { timeout: 30000 });
        const detectionNotice = await inlineNotice.textContent();
        const clusteredSquaresMatch = detectionNotice?.match(/Board detected from OpenCV contours \((\d+) clustered squares from (\d+) candidates\)\./);
        if (!clusteredSquaresMatch) {
            throw new Error(`Unexpected detection status: ${detectionNotice}`);
        }
        expect(Number.parseInt(clusteredSquaresMatch[1], 10)).toBeGreaterThanOrEqual(30);
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

        await autoDetectButton.click();
        await expect(inlineNotice).toContainText('Board detected from', { timeout: 30000 });

        await captureReferenceButton.click();
        await expect(inlineNotice).toContainText('Empty-board reference captured.', { timeout: 15000 });

        await saveCalibrationButton.click();
        await expect(inlineNotice).toContainText('Calibration saved locally.');

        await expect(page.locator('.preview-card .detail-list strong').nth(1)).toHaveText('Captured');
        await page.evaluate((nextImageUrl) => {
            return (window as typeof window & {
                __setMockWebcamFrame?: (url: string) => Promise<void>;
            }).__setMockWebcamFrame?.(nextImageUrl);
        }, initialSetupImageUrl);
        await expect(occupiedSquaresValue).toHaveText('32', { timeout: 20000 });
        await saveDocScreenshot(page, '001-001-quad-adjusted-and-saved.png');
        await testInfo.attach('opencv-detected-and-saved', {
            body: await page.screenshot(),
            contentType: 'image/png'
        });
    });
});
