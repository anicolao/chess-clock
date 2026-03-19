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

async function readPreviewOccupiedIndices(page: import('@playwright/test').Page) {
    return page.locator('canvas.preview-canvas').evaluate((node) => {
        const occupiedIndices = node.getAttribute('data-occupied-indices');
        if (!occupiedIndices) {
            return [];
        }

        return occupiedIndices
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
            .map((value) => Number.parseInt(value, 10));
    });
}

async function readPreviewPieceColors(page: import('@playwright/test').Page) {
    return page.locator('canvas.preview-canvas').evaluate((node) => {
        const raw = node.getAttribute('data-piece-colors');
        if (!raw) {
            return [] as Array<{ index: number; color: 'white' | 'black' }>;
        }

        return raw
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
            .map((value) => {
                const [index, color] = value.split(':');
                return {
                    index: Number.parseInt(index, 10),
                    color: color === 'white' ? 'white' : 'black'
                };
            });
    });
}

test.describe('Board Setup With Mocked Webcam', () => {
    test('Setup screen detects the board from a mocked webcam frame', async ({ page }, testInfo) => {
        test.setTimeout(240000);

        const emptyBoardImageUrl = toDataUrl(path.join(process.cwd(), 'tests/images/game/empty.jpg'));
        const initialSetupImageUrl = toDataUrl(path.join(process.cwd(), 'tests/images/game/initial_setup.jpg'));
        const e5ImageUrl = toDataUrl(path.join(process.cwd(), 'tests/images/game/e5.jpg'));

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
        const thresholdValue = page.locator('.threshold-header strong');
        const thresholdSlider = page.locator('#occupancy-threshold');

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
        await expect(inlineNotice).toContainText('Board detected from', { timeout: 120000 });
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
        await expect(inlineNotice).toContainText('Board detected from', { timeout: 120000 });

        await captureReferenceButton.click();
        await expect(inlineNotice).toContainText('Empty-board reference captured.', { timeout: 15000 });
        await expect(thresholdValue).toHaveText('3.25x');

        await thresholdSlider.evaluate((node) => {
            const input = node as HTMLInputElement;
            input.value = '3.30';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await expect(thresholdValue).toHaveText('3.30x');

        await thresholdSlider.evaluate((node) => {
            const input = node as HTMLInputElement;
            input.value = '3.25';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await expect(thresholdValue).toHaveText('3.25x');

        await saveCalibrationButton.click();
        await expect(inlineNotice).toContainText('Calibration saved locally.');

        await expect(page.locator('.preview-card .detail-list strong').nth(1)).toHaveText('Captured');
        await expect(occupiedSquaresValue).toHaveText('0', { timeout: 20000 });
        await expect
            .poll(() => readPreviewOccupiedIndices(page), { timeout: 20000 })
            .toEqual([]);

        await page.evaluate((nextImageUrl) => {
            return (window as typeof window & {
                __setMockWebcamFrame?: (url: string) => Promise<void>;
            }).__setMockWebcamFrame?.(nextImageUrl);
        }, initialSetupImageUrl);
        await expect(occupiedSquaresValue).toHaveText('32', { timeout: 20000 });
        await expect
            .poll(() => readPreviewOccupiedIndices(page), { timeout: 20000 })
            .toHaveLength(32);
        await expect
            .poll(() => readPreviewPieceColors(page), { timeout: 20000 })
            .toHaveLength(32);
        await saveDocScreenshot(page, '001-001-quad-adjusted-and-saved.png');
        await testInfo.attach('opencv-detected-and-saved', {
            body: await page.screenshot(),
            contentType: 'image/png'
        });

        const pieceColors = await readPreviewPieceColors(page);
        const whitePieceCount = pieceColors.filter((piece) => piece.color === 'white').length;
        const blackPieceCount = pieceColors.filter((piece) => piece.color === 'black').length;
        expect(whitePieceCount).toBe(16);
        expect(blackPieceCount).toBe(16);

        const rowCounts: Array<Record<'white' | 'black', number>> = Array.from(
            { length: 8 },
            () => ({ white: 0, black: 0 })
        );
        const colCounts: Array<Record<'white' | 'black', number>> = Array.from(
            { length: 8 },
            () => ({ white: 0, black: 0 })
        );
        for (const piece of pieceColors) {
            const row = Math.floor(piece.index / 8);
            const col = piece.index % 8;
            const color = piece.color as 'white' | 'black';
            rowCounts[row][color] += 1;
            colCounts[col][color] += 1;
        }

        const hasColoredEdgeBands = (bands: Array<{ white: number; black: number }>) => {
            const leadingWhite = bands[0].white + bands[1].white;
            const leadingBlack = bands[0].black + bands[1].black;
            const trailingWhite = bands[6].white + bands[7].white;
            const trailingBlack = bands[6].black + bands[7].black;
            const middleOccupancy = bands.slice(2, 6).reduce((sum, band) => sum + band.white + band.black, 0);

            return middleOccupancy === 0 && (
                (leadingWhite >= 15 && trailingBlack >= 15 && leadingBlack === 0 && trailingWhite === 0)
                || (leadingBlack >= 15 && trailingWhite >= 15 && leadingWhite === 0 && trailingBlack === 0)
            );
        };

        expect(hasColoredEdgeBands(rowCounts) || hasColoredEdgeBands(colCounts)).toBe(true);

        await page.evaluate((nextImageUrl) => {
            return (window as typeof window & {
                __setMockWebcamFrame?: (url: string) => Promise<void>;
            }).__setMockWebcamFrame?.(nextImageUrl);
        }, e5ImageUrl);
        await expect(occupiedSquaresValue).toHaveText('32', { timeout: 20000 });
        await expect
            .poll(() => readPreviewOccupiedIndices(page), { timeout: 20000 })
            .toHaveLength(32);
    });
});
