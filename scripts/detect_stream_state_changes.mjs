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
	markdown += 'Each section shows the quiescent board frames selected for further analysis from the raw ESP32 camera stream. ';
	markdown += 'The detector localizes the board once, warps every frame, computes frame-to-frame board deltas, and selects a `quiet -> motion -> quiet` transition window before any occupancy analysis.\n\n';

	for (const result of results) {
		markdown += `## ${result.streamName}\n\n`;
		markdown += `- Frames: ${result.frameCount}\n`;
		markdown += `- Localization: score=${result.localization.score.toFixed(1)}, candidates=${result.localization.candidateCount}, selected=${result.localization.selectedCount}\n`;
		markdown += `- Thresholds: center=${result.thresholds.center.toFixed(2)}, mad=${result.thresholds.mad.toFixed(2)}, quiet=${result.thresholds.quiet.toFixed(2)}, settle=${result.thresholds.settle.toFixed(2)}, motion=${result.thresholds.motion.toFixed(2)}\n`;
		markdown += `- Quiet window: ${result.parameters.quietFrames} frames\n`;
		markdown += `- Detected transition windows: ${result.events.length}\n\n`;
		markdown += '| Event | Before Quiet Raw | Before Quiet Warp | After Quiet Raw | After Quiet Warp | Trigger Diff | Peak Diff | Selected Frames |\n';
		markdown += '|---|---|---|---|---|---|---|---|\n';

		for (const event of result.events) {
			markdown += `| ${event.eventIndex} | ![](${toPosixPath(path.relative('tests', event.beforeRawPath))}) | ![](${toPosixPath(path.relative('tests', event.beforeWarpPath))}) | ![](${toPosixPath(path.relative('tests', event.afterRawPath))}) | ![](${toPosixPath(path.relative('tests', event.afterWarpPath))}) | ![](${toPosixPath(path.relative('tests', event.triggerDiffPath))}) | ![](${toPosixPath(path.relative('tests', event.peakDiffPath))}) | beforeQuiet=${event.beforeFrameName} [${event.beforeQuietStartFrameIndex}-${event.beforeFrameIndex}], motion=${event.triggerFrameName}-${event.motionEndFrameName}, peak=${event.peakFrameName}, afterQuiet=${event.afterFrameName} [${event.afterQuietStartFrameIndex}-${event.afterFrameIndex}], peakScore=${event.peakScore.toFixed(2)} |\n`;
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
