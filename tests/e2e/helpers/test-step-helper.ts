import { type Page, type TestInfo, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export interface Verification {
    spec: string;
    check: () => Promise<void>;
}

export interface StepOptions {
    description: string;
    verifications: Verification[];
    networkStatus?: 'synced' | 'offline' | 'error' | 'skip';
}

interface DocStep {
    title: string;
    image: string;
    specs: string[];
}

export class TestStepHelper {
    private stepCount = 0;
    private steps: DocStep[] = [];

    constructor(private page: Page, private testInfo: TestInfo) { }

    setMetadata(title: string, description: string) {
        // Ideally store this for the doc header
    }

    async step(id: string, options: StepOptions) {
        // 1. Run Verification
        for (const v of options.verifications) {
            await v.check();
        }

        // 2. Generate Name
        const paddedIndex = String(this.stepCount++).padStart(3, '0');
        const filename = `${paddedIndex}-${id.replace(/_/g, '-')}.png`;

        // 3. Stabilization: Wait for Network Sync (if present)
        const networkStatus = this.page.locator('button[data-status]');
        const expectedStatus = options.networkStatus ?? 'synced';
        if (expectedStatus !== 'skip') {
            const statusVisible = await networkStatus.first()
                .waitFor({ state: 'visible', timeout: 5000 })
                .then(() => true)
                .catch(() => false);
            if (statusVisible) {
                await expect(networkStatus.first()).toHaveAttribute('data-status', expectedStatus, { timeout: 30000 });
            }
        }

        const toggleIcons = this.page.locator('img[alt="Toggle Details"]');
        if (await toggleIcons.count() > 0) {
            await this.page.waitForFunction(() => {
                const icons = Array.from(
                    document.querySelectorAll<HTMLImageElement>('img[alt="Toggle Details"]')
                );
                return icons.every((img) => img.complete && img.naturalWidth > 0);
            }, { timeout: 30000 });
        }
        
        await this.page.waitForLoadState('networkidle');

        // Programmatically validate the state/screenshot is not blank
        // A fully blank/white screenshot of 393x852 in PNG is usually around 2-3KB.
        const screenshotBuffer = await this.page.screenshot();
        expect(screenshotBuffer.length).toBeGreaterThan(2000, 'Screenshot size is suspiciously small, suggesting a blank page');

        // 4. Capture & Verify (Zero-Pixel Tolerance)
        // Check against the baseline in 'screenshots/{filename}'.
        await expect(this.page).toHaveScreenshot(filename.replace(/\.png$/, ''));

        // 5. Record for Docs
        this.steps.push({
            title: options.description,
            image: `./screenshots/${filename}`,
            specs: options.verifications.map(v => v.spec)
        });
    }

    generateDocs() {
        const docPath = path.join(path.dirname(this.testInfo.file), 'README.md');
        let content = `# Test: ${this.testInfo.title}\n\n`;

        for (const step of this.steps) {
            content += `## ${step.title}\n\n`;
            content += `![${step.title}](${step.image})\n\n`;
            content += `**Verifications:**\n`;
            for (const spec of step.specs) {
                content += `- [x] ${spec}\n`;
            }
            content += `\n---\n\n`;
        }

        fs.writeFileSync(docPath, content);
    }
}
