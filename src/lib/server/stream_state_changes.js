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

function buildQuietSpan(frameSummaries, quietThreshold, startFrameIndex, endFrameIndex) {
	let bestFrameIndex = startFrameIndex;
	let bestScore = Number.POSITIVE_INFINITY;

	for (let frameIndex = startFrameIndex; frameIndex <= endFrameIndex; frameIndex += 1) {
		const summary = frameSummaries[frameIndex];
		const quietScore = summary.quietScore;
		const qualifies = Number.isFinite(quietScore) && quietScore <= quietThreshold;
		const candidateScore = qualifies ? quietScore : Number.POSITIVE_INFINITY;

		if (
			candidateScore < bestScore - 1e-9 ||
			(Math.abs(candidateScore - bestScore) <= 1e-9 && frameIndex > bestFrameIndex)
		) {
			bestFrameIndex = frameIndex;
			bestScore = candidateScore;
		}
	}

	if (!Number.isFinite(bestScore)) {
		bestFrameIndex = endFrameIndex;
		bestScore = frameSummaries[endFrameIndex]?.quietScore ?? Number.POSITIVE_INFINITY;
	}

	return {
		startFrameIndex,
		endFrameIndex,
		bestFrameIndex,
		bestScore
	};
}

function detectChangeEvents(frameSummaries, warpedGrayFrames) {
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
	let quietRunStartFrameIndex = null;
	let quietRunLength = 0;
	let confirmedQuietSpan = null;
	let activeEvent = null;

	function startQuietRun(frameIndex) {
		quietRunStartFrameIndex = frameIndex;
		quietRunLength = 1;
	}

	function extendQuietRun() {
		quietRunLength += 1;
	}

	function clearQuietRun() {
		quietRunStartFrameIndex = null;
		quietRunLength = 0;
	}

	function currentQuietRunEnd(frameIndex) {
		return quietRunStartFrameIndex == null ? null : frameIndex;
	}

	function promoteQuietRun(frameIndex) {
		if (quietRunStartFrameIndex == null || quietRunLength < quietFrames) return;
		confirmedQuietSpan = buildQuietSpan(
			frameSummaries,
			quietThreshold,
			quietRunStartFrameIndex,
			currentQuietRunEnd(frameIndex)
		);
	}

	for (let frameIndex = 1; frameIndex < frameSummaries.length; frameIndex += 1) {
		const summary = frameSummaries[frameIndex];
		const score = summary.diffScore;
		const isFrameQuiet = summary.quietScore <= quietThreshold;
		if (isFrameQuiet) {
			if (quietRunStartFrameIndex == null) startQuietRun(frameIndex);
			else extendQuietRun();
			promoteQuietRun(frameIndex);
		} else if (quietRunStartFrameIndex != null) {
			promoteQuietRun(frameIndex - 1);
			clearQuietRun();
		}

		const anchorDriftScore = confirmedQuietSpan
			? computeFrameDiffScore(
				warpedGrayFrames[confirmedQuietSpan.bestFrameIndex],
				warpedGrayFrames[frameIndex]
			)
			: 0;
		const motionDetected = (
			score >= motionThreshold ||
			anchorDriftScore >= motionThreshold ||
			(score >= settleThreshold && anchorDriftScore >= settleThreshold)
		);
		const resumedLocalMotion = (
			score >= motionThreshold ||
			summary.quietScore >= motionThreshold
		);

		if (state === 'searching_quiet') {
			if (confirmedQuietSpan) {
				state = 'quiet_ready';
			}
			continue;
		}

		if (state === 'quiet_ready') {
			if (motionDetected && confirmedQuietSpan) {
				activeEvent = {
					beforeQuietStartFrameIndex: confirmedQuietSpan.startFrameIndex,
					beforeFrameIndex: confirmedQuietSpan.bestFrameIndex,
					triggerFrameIndex: frameIndex,
					triggerAnchorDriftScore: anchorDriftScore,
					peakFrameIndex: frameIndex,
					peakScore: score,
					peakAnchorDriftScore: anchorDriftScore,
					motionEndFrameIndex: frameIndex
				};
				clearQuietRun();
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
			if (anchorDriftScore > activeEvent.peakAnchorDriftScore) {
				activeEvent.peakAnchorDriftScore = anchorDriftScore;
			}
			if (score <= settleThreshold) {
				clearQuietRun();
				if (isFrameQuiet) startQuietRun(frameIndex);
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
			if (anchorDriftScore > activeEvent.peakAnchorDriftScore) {
				activeEvent.peakAnchorDriftScore = anchorDriftScore;
			}

			if (resumedLocalMotion) {
				clearQuietRun();
				state = 'in_motion';
				continue;
			}

			if (quietRunStartFrameIndex != null && quietRunLength >= quietFrames) {
				const afterQuietSpan = buildQuietSpan(
					frameSummaries,
					quietThreshold,
					quietRunStartFrameIndex,
					frameIndex
				);
				events.push({
					beforeQuietStartFrameIndex: activeEvent.beforeQuietStartFrameIndex,
					beforeFrameIndex: activeEvent.beforeFrameIndex,
					triggerFrameIndex: activeEvent.triggerFrameIndex,
					triggerAnchorDriftScore: activeEvent.triggerAnchorDriftScore,
					peakFrameIndex: activeEvent.peakFrameIndex,
					motionEndFrameIndex: activeEvent.motionEndFrameIndex,
					afterQuietStartFrameIndex: afterQuietSpan.startFrameIndex,
					afterFrameIndex: afterQuietSpan.bestFrameIndex,
					peakScore: activeEvent.peakScore,
					peakAnchorDriftScore: activeEvent.peakAnchorDriftScore
				});
				confirmedQuietSpan = afterQuietSpan;
				activeEvent = null;
				clearQuietRun();
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
	const warpedGrayFrames = [];
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
		warpedGrayFrames.push(warpedGray.clone());

		src.delete();
		warped.delete();
		previousWarpGray?.delete();
		previousWarpGray = warpedGray;
	}

	previousWarpGray?.delete();
	referenceFrame.delete();
	localization.edges.delete();
	localization.dilated.delete();

	for (let frameIndex = 0; frameIndex < frameSummaries.length; frameIndex += 1) {
		const prevDiffScore = frameSummaries[frameIndex].diffScore;
		const nextDiffScore = frameSummaries[frameIndex + 1]?.diffScore ?? Number.POSITIVE_INFINITY;
		frameSummaries[frameIndex].prevDiffScore = prevDiffScore;
		frameSummaries[frameIndex].nextDiffScore = nextDiffScore;
		// Keep both scores: bilateral stability for observability, one-sided quiet score for selection.
		frameSummaries[frameIndex].stabilityScore = Math.max(prevDiffScore, nextDiffScore);
		frameSummaries[frameIndex].quietScore = Math.min(prevDiffScore, nextDiffScore);
	}

	const detected = detectChangeEvents(frameSummaries, warpedGrayFrames);
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
			triggerAnchorDriftScore: event.triggerAnchorDriftScore,
			peakFrameIndex: peakSummary.frameIndex,
			peakFrameName: peakSummary.frameName,
			motionEndFrameIndex: event.motionEndFrameIndex,
			motionEndFrameName: motionEndSummary.frameName,
			afterQuietStartFrameIndex: event.afterQuietStartFrameIndex,
			afterFrameIndex: afterSummary.frameIndex,
			afterFrameName: afterSummary.frameName,
			peakScore: event.peakScore,
			peakAnchorDriftScore: event.peakAnchorDriftScore,
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

	for (const warpedGray of warpedGrayFrames) {
		warpedGray.delete();
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
