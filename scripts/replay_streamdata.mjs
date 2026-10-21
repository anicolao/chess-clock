import cv from '@techstark/opencv-js';

import { analyzeAllStreamDirectories, analyzeStreamDirectory } from '../src/lib/server/stream_replay.js';

function waitForOpenCvReady() {
	return new Promise((resolve) => {
		if (cv?.Mat) {
			resolve();
			return;
		}
		cv.onRuntimeInitialized = () => resolve();
	});
}

async function main() {
	await waitForOpenCvReady();

	const args = process.argv.slice(2);
	const json = args.includes('--json');
	const filteredArgs = args.filter((arg) => arg !== '--json');

	const results = filteredArgs.length > 0
		? await Promise.all(filteredArgs.map((streamDir) => analyzeStreamDirectory(streamDir)))
		: await analyzeAllStreamDirectories();

	if (json) {
		console.log(JSON.stringify(results, null, 2));
		return;
	}

	for (const result of results) {
		console.log(`${result.streamDir}`);
		console.log(`  frames: ${result.frameCount}`);
		console.log(`  localization: score=${result.localization.score.toFixed(1)}, candidates=${result.localization.candidateCount}, selected=${result.localization.selectedCount}`);
		console.log(`  orientation: ${result.orientation}`);
		console.log(`  moves: ${result.moves.join(' ')}`);
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
