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

const DIFF_PIXEL_THRESHOLD = 12;

function computeFrameDiffMetrics(previousGray, currentGray) {
	const diff = new cv.Mat();
	cv.absdiff(previousGray, currentGray, diff);
	const blurred = new cv.Mat();
	cv.GaussianBlur(diff, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
	const meanScalar = cv.mean(blurred);
	const thresholded = new cv.Mat();
	cv.threshold(diff, thresholded, DIFF_PIXEL_THRESHOLD, 255, cv.THRESH_BINARY);
	const changedPixels = cv.countNonZero(thresholded);
	const changedFraction = changedPixels / (thresholded.rows * thresholded.cols);
	diff.delete();
	blurred.delete();
	thresholded.delete();
	return {
		meanScore: meanScalar[0],
		changedFraction,
		changedPercent: changedFraction * 100
	};
}

function computeFrameDiffScore(previousGray, currentGray) {
	return computeFrameDiffMetrics(previousGray, currentGray).changedPercent;
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
		const candidateScore = summary?.quietScore ?? Number.POSITIVE_INFINITY;
		if (
			candidateScore < bestScore - 1e-9 ||
			(Math.abs(candidateScore - bestScore) <= 1e-9 && frameIndex > bestFrameIndex)
		) {
			bestFrameIndex = frameIndex;
			bestScore = candidateScore;
		}
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
	const quietFrames = 2;

	const quietSpans = [];
	let quietRunStartFrameIndex = null;

	for (let frameIndex = 1; frameIndex < frameSummaries.length; frameIndex += 1) {
		const isQuietPair = frameSummaries[frameIndex].diffScore <= quietThreshold;
		if (isQuietPair) {
			if (quietRunStartFrameIndex == null) quietRunStartFrameIndex = frameIndex - 1;
			continue;
		}

		if (quietRunStartFrameIndex != null) {
			const quietSpan = buildQuietSpan(
				frameSummaries,
				quietThreshold,
				quietRunStartFrameIndex,
				frameIndex - 1
			);
			if (quietSpan.endFrameIndex - quietSpan.startFrameIndex + 1 >= quietFrames) {
				quietSpans.push(quietSpan);
			}
			quietRunStartFrameIndex = null;
		}
	}

	if (quietRunStartFrameIndex != null) {
		const quietSpan = buildQuietSpan(
			frameSummaries,
			quietThreshold,
			quietRunStartFrameIndex,
			frameSummaries.length - 1
		);
		if (quietSpan.endFrameIndex - quietSpan.startFrameIndex + 1 >= quietFrames) {
			quietSpans.push(quietSpan);
		}
	}

	const events = [];
	for (let spanIndex = 0; spanIndex + 1 < quietSpans.length; spanIndex += 1) {
		const beforeQuietSpan = quietSpans[spanIndex];
		const afterQuietSpan = quietSpans[spanIndex + 1];

		if (afterQuietSpan.startFrameIndex <= beforeQuietSpan.endFrameIndex) continue;

		const triggerFrameIndex = Math.min(
			frameSummaries.length - 1,
			beforeQuietSpan.endFrameIndex + 1
		);
		const motionEndFrameIndex = Math.max(
			triggerFrameIndex,
			afterQuietSpan.startFrameIndex - 1
		);

		let peakFrameIndex = triggerFrameIndex;
		let peakScore = frameSummaries[triggerFrameIndex]?.diffScore ?? 0;
		let peakAnchorDriftScore = 0;

		for (let frameIndex = triggerFrameIndex; frameIndex <= motionEndFrameIndex; frameIndex += 1) {
			const score = frameSummaries[frameIndex]?.diffScore ?? 0;
			if (score > peakScore) {
				peakScore = score;
				peakFrameIndex = frameIndex;
			}
			const anchorDriftScore = computeFrameDiffScore(
				warpedGrayFrames[beforeQuietSpan.bestFrameIndex],
				warpedGrayFrames[frameIndex]
			);
			if (anchorDriftScore > peakAnchorDriftScore) {
				peakAnchorDriftScore = anchorDriftScore;
			}
		}

		events.push({
			beforeQuietStartFrameIndex: beforeQuietSpan.startFrameIndex,
			beforeFrameIndex: beforeQuietSpan.bestFrameIndex,
			triggerFrameIndex,
			triggerAnchorDriftScore: computeFrameDiffScore(
				warpedGrayFrames[beforeQuietSpan.bestFrameIndex],
				warpedGrayFrames[triggerFrameIndex]
			),
			peakFrameIndex,
			motionEndFrameIndex,
			afterQuietStartFrameIndex: afterQuietSpan.startFrameIndex,
			afterFrameIndex: afterQuietSpan.bestFrameIndex,
			peakScore,
			peakAnchorDriftScore
		});
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

		const diffMetrics = previousWarpGray
			? computeFrameDiffMetrics(previousWarpGray, warpedGray)
			: { changedPercent: 0, meanScore: 0 };

		frameSummaries.push({
			frameIndex,
			framePath,
			frameName: path.basename(framePath),
			diffScore: diffMetrics.changedPercent,
			meanDiffScore: diffMetrics.meanScore
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
