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
	markdown += 'Each section shows the full adjacent-frame score table for one raw ESP32 camera stream. ';
	markdown += 'A quiet run is any consecutive sequence of pairs whose `diffScore` stays below the stream-specific quiet threshold. ';
	markdown += 'The chosen bracket frame for a quiet run is the local minimum `quietScore` inside that run. ';
	markdown += 'Inline images are shown only for quiet pairs so the report stays focused on the comparable candidate blocks.\n\n';

	for (const result of results) {
		const quietSpanByFrame = new Map();
		for (let index = 0; index < result.quietSpans.length; index += 1) {
			const span = result.quietSpans[index];
			for (let frameIndex = span.startFrameIndex; frameIndex <= span.endFrameIndex; frameIndex += 1) {
				quietSpanByFrame.set(frameIndex, { ...span, quietRunIndex: index + 1 });
			}
		}

		const eventRoleByFrame = new Map();
		for (const event of result.events) {
			eventRoleByFrame.set(event.beforeFrameIndex, `before#${event.eventIndex}`);
			eventRoleByFrame.set(event.afterFrameIndex, `after#${event.eventIndex}`);
			eventRoleByFrame.set(event.triggerFrameIndex, `trigger#${event.eventIndex}`);
			eventRoleByFrame.set(event.peakFrameIndex, `peak#${event.eventIndex}`);
		}

		markdown += `## ${result.streamName}\n\n`;
		markdown += '| Metric | Value |\n';
		markdown += '|---|---|\n';
		markdown += `| Frames | ${result.frameCount} |\n`;
		markdown += `| Localization | score=${result.localization.score.toFixed(1)}, candidates=${result.localization.candidateCount}, selected=${result.localization.selectedCount} |\n`;
		markdown += `| Thresholds (% changed board pixels) | center=${result.thresholds.center.toFixed(2)}, mad=${result.thresholds.mad.toFixed(2)}, quiet=${result.thresholds.quiet.toFixed(2)}, settle=${result.thresholds.settle.toFixed(2)}, motion=${result.thresholds.motion.toFixed(2)} |\n`;
		markdown += `| Pixel diff cutoff | ${result.parameters.diffPixelThreshold} |\n`;
		markdown += `| Quiet window | ${result.parameters.quietFrames} frames |\n`;
		markdown += `| Quiet runs | ${result.quietSpans.length} |\n`;
		markdown += `| Detected transition windows | ${result.events.length} |\n\n`;

		markdown += '| Pair | diffScore | meanDiff | quietThreshold | quietScore | quiet? | quiet run | chosen frame | event role | before | after | diff |\n';
		markdown += '|---|---:|---:|---:|---:|---|---|---|---|---|---|---|\n';

		for (let frameIndex = 1; frameIndex < result.frameSummaries.length; frameIndex += 1) {
			const summary = result.frameSummaries[frameIndex];
			const pairLabel = `${String(frameIndex - 1).padStart(3, '0')} -> ${String(frameIndex).padStart(3, '0')}`;
			const quiet = summary.diffScore <= result.thresholds.quiet;
			const quietSpan = quietSpanByFrame.get(frameIndex);
			const quietRunLabel = quietSpan
				? `#${quietSpan.quietRunIndex} [${quietSpan.startFrameIndex}-${quietSpan.endFrameIndex}]`
				: '';
			const chosenFrameLabel = quietSpan?.bestFrameIndex === frameIndex
				? `frame-${String(frameIndex).padStart(6, '0')}`
				: '';
			const eventRole = eventRoleByFrame.get(frameIndex) ?? '';
			const afterImage = quiet && summary.pairArtifacts
				? `![](${toPosixPath(path.relative('tests', summary.pairArtifacts.afterRawPath))})`
				: '-';
			const diffImage = quiet && summary.pairArtifacts
				? `![](${toPosixPath(path.relative('tests', summary.pairArtifacts.diffPath))})`
				: '-';
			const beforeCell = quiet && summary.pairArtifacts
				? `![](${toPosixPath(path.relative('tests', summary.pairArtifacts.beforeRawPath))})`
				: '-';
			const chosenCell = chosenFrameLabel || '-';
			const roleCell = eventRole || '-';
			const quietRunCell = quietRunLabel || '-';

			markdown += `| ${pairLabel} | ${summary.diffScore.toFixed(2)} | ${summary.meanDiffScore.toFixed(2)} | ${result.thresholds.quiet.toFixed(2)} | ${summary.quietScore.toFixed(2)} | ${quiet ? 'yes' : 'no'} | ${quietRunCell} | ${chosenCell} | ${roleCell} | ${beforeCell} | ${afterImage} | ${diffImage} |\n`;
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
