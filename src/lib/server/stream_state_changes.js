// @ts-nocheck
import fs from 'fs';
import path from 'path';

import cv from '@techstark/opencv-js';
import { Jimp } from 'jimp';

import {
	WARP_SIZE,
	localizeChessboard,
	warpQuad,
	writeMatImage
} from '../../../tests/lib/chessboard_cv.js';

function ensureParentDir(filePath) {
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function waitForOpenCvReady() {
	return new Promise((resolve) => {
		if (cv?.Mat) {
			resolve();
			return;
		}
		cv.onRuntimeInitialized = () => resolve();
	});
}

function loadImageAsMat(filePath) {
	return Jimp.read(filePath).then((image) => {
		const mat = new cv.Mat(image.bitmap.height, image.bitmap.width, cv.CV_8UC4);
		mat.data.set(image.bitmap.data);
		return mat;
	});
}

function listFrameFiles(streamDir) {
	return fs.readdirSync(streamDir)
		.filter((file) => /^frame-\d+\.jpg$/i.test(file))
		.sort()
		.map((file) => path.join(streamDir, file));
}

function median(values) {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
}

function computeMad(values, center) {
	return median(values.map((value) => Math.abs(value - center)));
}

function computeFrameDiffScore(previousGray, currentGray) {
	const diff = new cv.Mat();
	cv.absdiff(previousGray, currentGray, diff);
	const blurred = new cv.Mat();
	cv.GaussianBlur(diff, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
	const meanScalar = cv.mean(blurred);
	const score = meanScalar[0];
	diff.delete();
	blurred.delete();
	return score;
}

function renderDiffImage(previousGray, currentGray) {
	const diff = new cv.Mat();
	cv.absdiff(previousGray, currentGray, diff);
	const normalized = new cv.Mat();
	cv.normalize(diff, normalized, 0, 255, cv.NORM_MINMAX);
	const colored = new cv.Mat();
	cv.applyColorMap(normalized, colored, cv.COLORMAP_TURBO);
	diff.delete();
	normalized.delete();
	return colored;
}

function detectChangeEvents(frameSummaries) {
	const diffScores = frameSummaries
		.map((frame) => frame.diffScore)
		.filter((score) => Number.isFinite(score));

	const center = median(diffScores);
	const mad = Math.max(0.01, computeMad(diffScores, center));
	const quietThreshold = center + Math.max(1.25, mad * 1.5);
	const settleThreshold = center + Math.max(2.5, mad * 3);
	const motionThreshold = center + Math.max(4.5, mad * 5.5);
	const quietFrames = 4;

	const events = [];
	let state = 'searching_quiet';
	let quietRunStartFrameIndex = 0;
	let quietRunLength = 1;
	let quietAnchorFrameIndex = 0;
	let activeEvent = null;
	let settlingRunStartFrameIndex = null;
	let settlingQuietCount = 0;

	for (let frameIndex = 1; frameIndex < frameSummaries.length; frameIndex += 1) {
		const summary = frameSummaries[frameIndex];
		const score = summary.diffScore;
		const isQuiet = score <= quietThreshold;
		const isMotion = score >= motionThreshold;

		if (isQuiet) {
			if (quietRunLength === 0) {
				quietRunStartFrameIndex = frameIndex - 1;
			}
			quietRunLength += 1;
			if (quietRunLength >= quietFrames) {
				quietAnchorFrameIndex = frameIndex;
			}
		} else {
			quietRunStartFrameIndex = frameIndex;
			quietRunLength = 0;
		}

		if (state === 'searching_quiet') {
			if (quietRunLength >= quietFrames) {
				state = 'quiet_ready';
			}
			continue;
		}

		if (state === 'quiet_ready') {
			if (isMotion) {
				activeEvent = {
					beforeQuietStartFrameIndex: Math.max(0, quietAnchorFrameIndex - quietFrames + 1),
					beforeFrameIndex: quietAnchorFrameIndex,
					triggerFrameIndex: frameIndex,
					peakFrameIndex: frameIndex,
					peakScore: score,
					motionEndFrameIndex: frameIndex
				};
				settlingRunStartFrameIndex = null;
				settlingQuietCount = 0;
				state = 'in_motion';
			}
			continue;
		}

		if (state === 'in_motion') {
			activeEvent.motionEndFrameIndex = frameIndex;
			if (score > activeEvent.peakScore) {
				activeEvent.peakScore = score;
				activeEvent.peakFrameIndex = frameIndex;
			}
			if (score <= settleThreshold) {
				settlingRunStartFrameIndex = frameIndex;
				settlingQuietCount = isQuiet ? 1 : 0;
				state = 'settling';
			}
			continue;
		}

		if (state === 'settling') {
			activeEvent.motionEndFrameIndex = frameIndex;
			if (score > activeEvent.peakScore) {
				activeEvent.peakScore = score;
				activeEvent.peakFrameIndex = frameIndex;
			}

			if (isMotion) {
				settlingRunStartFrameIndex = null;
				settlingQuietCount = 0;
				state = 'in_motion';
				continue;
			}

			if (isQuiet) {
				if (settlingQuietCount === 0) {
					settlingRunStartFrameIndex = frameIndex - 1;
				}
				settlingQuietCount += 1;
			} else {
				settlingQuietCount = 0;
			}

			if (settlingQuietCount >= quietFrames) {
				const afterFrameIndex = frameIndex;
				events.push({
					beforeQuietStartFrameIndex: activeEvent.beforeQuietStartFrameIndex,
					beforeFrameIndex: activeEvent.beforeFrameIndex,
					triggerFrameIndex: activeEvent.triggerFrameIndex,
					peakFrameIndex: activeEvent.peakFrameIndex,
					motionEndFrameIndex: Math.max(activeEvent.triggerFrameIndex, afterFrameIndex - quietFrames),
					afterQuietStartFrameIndex: Math.max(0, afterFrameIndex - quietFrames + 1),
					afterFrameIndex,
					peakScore: activeEvent.peakScore
				});
				quietAnchorFrameIndex = afterFrameIndex;
				quietRunStartFrameIndex = Math.max(0, afterFrameIndex - quietFrames + 1);
				quietRunLength = quietFrames;
				activeEvent = null;
				settlingRunStartFrameIndex = null;
				settlingQuietCount = 0;
				state = 'quiet_ready';
			}
		}
	}

	return {
		center,
		mad,
		quietThreshold,
		settleThreshold,
		motionThreshold,
		quietFrames,
		events
	};
}

export async function analyzeStreamStateChanges(
	streamDir,
	{
		outputBaseDir = 'tests/images/out/stream_state_changes',
		renderArtifacts = true
	} = {}
) {
	const frameFiles = listFrameFiles(streamDir);
	if (frameFiles.length === 0) {
		throw new Error(`No frames found in ${streamDir}`);
	}

	const referenceFrame = await loadImageAsMat(frameFiles[0]);
	const localization = localizeChessboard(referenceFrame);
	if (!localization.quad || !localization.metrics) {
		throw new Error(`Failed to localize the board in ${streamDir}`);
	}

	const frameSummaries = [];
	let previousWarpGray = null;

	for (let frameIndex = 0; frameIndex < frameFiles.length; frameIndex += 1) {
		const framePath = frameFiles[frameIndex];
		const src = await loadImageAsMat(framePath);
		const warped = warpQuad(src, localization.quad, WARP_SIZE);
		const warpedGray = new cv.Mat();
		cv.cvtColor(warped, warpedGray, cv.COLOR_RGBA2GRAY, 0);

		const diffScore = previousWarpGray
			? computeFrameDiffScore(previousWarpGray, warpedGray)
			: 0;

		frameSummaries.push({
			frameIndex,
			framePath,
			frameName: path.basename(framePath),
			diffScore
		});

		src.delete();
		warped.delete();
		previousWarpGray?.delete();
		previousWarpGray = warpedGray;
	}

	previousWarpGray?.delete();
	referenceFrame.delete();
	localization.edges.delete();
	localization.dilated.delete();

	const detected = detectChangeEvents(frameSummaries);
	const streamName = path.basename(streamDir);
	const derivedEvents = [];

	for (let eventIndex = 0; eventIndex < detected.events.length; eventIndex += 1) {
		const event = detected.events[eventIndex];
		const beforeSummary = frameSummaries[event.beforeFrameIndex];
		const afterSummary = frameSummaries[event.afterFrameIndex];
		const triggerSummary = frameSummaries[event.triggerFrameIndex];
		const peakSummary = frameSummaries[event.peakFrameIndex];
		const motionEndSummary = frameSummaries[event.motionEndFrameIndex];

		const beforeSource = await loadImageAsMat(beforeSummary.framePath);
		const afterSource = await loadImageAsMat(afterSummary.framePath);
		const triggerSource = await loadImageAsMat(triggerSummary.framePath);
		const peakSource = await loadImageAsMat(peakSummary.framePath);

		const beforeWarp = warpQuad(beforeSource, localization.quad, WARP_SIZE);
		const afterWarp = warpQuad(afterSource, localization.quad, WARP_SIZE);
		const triggerWarp = warpQuad(triggerSource, localization.quad, WARP_SIZE);
		const peakWarp = warpQuad(peakSource, localization.quad, WARP_SIZE);

		const beforeGray = new cv.Mat();
		const afterGray = new cv.Mat();
		const triggerGray = new cv.Mat();
		const peakGray = new cv.Mat();
		cv.cvtColor(beforeWarp, beforeGray, cv.COLOR_RGBA2GRAY, 0);
		cv.cvtColor(afterWarp, afterGray, cv.COLOR_RGBA2GRAY, 0);
		cv.cvtColor(triggerWarp, triggerGray, cv.COLOR_RGBA2GRAY, 0);
		cv.cvtColor(peakWarp, peakGray, cv.COLOR_RGBA2GRAY, 0);

		const outputDir = path.join(outputBaseDir, streamName);
		const beforeRawPath = path.join(outputDir, `event-${String(eventIndex + 1).padStart(2, '0')}-before-raw.jpg`);
		const afterRawPath = path.join(outputDir, `event-${String(eventIndex + 1).padStart(2, '0')}-after-raw.jpg`);
		const beforeWarpPath = path.join(outputDir, `event-${String(eventIndex + 1).padStart(2, '0')}-before-warp.jpg`);
		const afterWarpPath = path.join(outputDir, `event-${String(eventIndex + 1).padStart(2, '0')}-after-warp.jpg`);
		const triggerDiffPath = path.join(outputDir, `event-${String(eventIndex + 1).padStart(2, '0')}-trigger-diff.jpg`);
		const peakDiffPath = path.join(outputDir, `event-${String(eventIndex + 1).padStart(2, '0')}-peak-diff.jpg`);

		if (renderArtifacts) {
			ensureParentDir(beforeWarpPath);
			fs.copyFileSync(beforeSummary.framePath, beforeRawPath);
			fs.copyFileSync(afterSummary.framePath, afterRawPath);
			await writeMatImage(beforeWarp, beforeWarpPath);
			await writeMatImage(afterWarp, afterWarpPath);
			await writeMatImage(renderDiffImage(beforeGray, triggerGray), triggerDiffPath);
			await writeMatImage(renderDiffImage(beforeGray, peakGray), peakDiffPath);
		}

		derivedEvents.push({
			eventIndex: eventIndex + 1,
			beforeQuietStartFrameIndex: event.beforeQuietStartFrameIndex,
			beforeFrameIndex: beforeSummary.frameIndex,
			beforeFrameName: beforeSummary.frameName,
			triggerFrameIndex: triggerSummary.frameIndex,
			triggerFrameName: triggerSummary.frameName,
			peakFrameIndex: peakSummary.frameIndex,
			peakFrameName: peakSummary.frameName,
			motionEndFrameIndex: event.motionEndFrameIndex,
			motionEndFrameName: motionEndSummary.frameName,
			afterQuietStartFrameIndex: event.afterQuietStartFrameIndex,
			afterFrameIndex: afterSummary.frameIndex,
			afterFrameName: afterSummary.frameName,
			peakScore: event.peakScore,
			beforeFramePath: beforeSummary.framePath,
			afterFramePath: afterSummary.framePath,
			beforeRawPath,
			afterRawPath,
			beforeWarpPath,
			afterWarpPath,
			triggerDiffPath,
			peakDiffPath
		});

		beforeSource.delete();
		afterSource.delete();
		triggerSource.delete();
		peakSource.delete();
		beforeWarp.delete();
		afterWarp.delete();
		triggerWarp.delete();
		peakWarp.delete();
		beforeGray.delete();
		afterGray.delete();
		triggerGray.delete();
		peakGray.delete();
	}

	return {
		streamDir,
		streamName,
		frameCount: frameFiles.length,
		localization: {
			score: localization.metrics.totalScore,
			candidateCount: localization.candidates.length,
			selectedCount: localization.selectedSquares.length
		},
		thresholds: {
			center: detected.center,
			mad: detected.mad,
			quiet: detected.quietThreshold,
			settle: detected.settleThreshold,
			motion: detected.motionThreshold
		},
		parameters: {
			quietFrames: detected.quietFrames
		},
		events: derivedEvents,
		frameSummaries
	};
}

export async function analyzeAllStreamStateChanges(
	baseDir = 'streamdata',
	options = {}
) {
	const streamDirs = fs.readdirSync(baseDir)
		.map((entry) => path.join(baseDir, entry))
		.filter((entry) => fs.statSync(entry).isDirectory())
		.sort();

	const results = [];
	for (const streamDir of streamDirs) {
		results.push(await analyzeStreamStateChanges(streamDir, options));
	}
	return results;
}
