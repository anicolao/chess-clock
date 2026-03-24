import path from 'path';

import {
	analyzeAllStreamStateChanges,
	waitForOpenCvReady
} from '../src/lib/server/stream_state_changes.js';

const REPORT_PATH = 'tests/stream_state_change_report.md';

function toPosixPath(filePath) {
	return filePath.split(path.sep).join('/');
}

async function main() {
	await waitForOpenCvReady();
	const results = await analyzeAllStreamStateChanges();

	let markdown = '# Stream State Change Report\n\n';
	markdown += 'Each section shows the likely before/after frames for every detected state change in the raw ESP32 camera stream. ';
	markdown += 'The detector localizes the board once, warps every frame, computes frame-to-frame board deltas, and groups bursts of change into state-change events.\n\n';

	for (const result of results) {
		markdown += `## ${result.streamName}\n\n`;
		markdown += `- Frames: ${result.frameCount}\n`;
		markdown += `- Localization: score=${result.localization.score.toFixed(1)}, candidates=${result.localization.candidateCount}, selected=${result.localization.selectedCount}\n`;
		markdown += `- Thresholds: center=${result.thresholds.center.toFixed(2)}, mad=${result.thresholds.mad.toFixed(2)}, high=${result.thresholds.high.toFixed(2)}, low=${result.thresholds.low.toFixed(2)}\n`;
		markdown += `- Detected state changes: ${result.events.length}\n\n`;
		markdown += '| Event | Before Raw | After Raw | Before Warp | After Warp | Trigger Diff | Peak Diff | Frames |\n';
		markdown += '|---|---|---|---|---|---|---|---|\n';

		for (const event of result.events) {
			markdown += `| ${event.eventIndex} | ![](${toPosixPath(path.relative('tests', event.beforeFramePath))}) | ![](${toPosixPath(path.relative('tests', event.afterFramePath))}) | ![](${toPosixPath(path.relative('tests', event.beforeWarpPath))}) | ![](${toPosixPath(path.relative('tests', event.afterWarpPath))}) | ![](${toPosixPath(path.relative('tests', event.triggerDiffPath))}) | ![](${toPosixPath(path.relative('tests', event.settleDiffPath))}) | before=${event.beforeFrameName}, trigger=${event.triggerFrameName}, peak=${event.peakFrameName}, after=${event.afterFrameName}, peakScore=${event.peakScore.toFixed(2)} |\n`;
		}

		markdown += '\n';
	}

	await import('fs').then((fs) => fs.writeFileSync(REPORT_PATH, markdown));
	console.log(`Report written to ${REPORT_PATH}`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
