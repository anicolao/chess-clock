// @ts-nocheck
import fs from 'fs';
import path from 'path';

import cv from '@techstark/opencv-js';
import { Jimp } from 'jimp';

import { WARP_SIZE, localizeChessboard, warpQuad } from '../../../tests/lib/chessboard_cv.js';
import {
	applyMove,
	boardToOccupiedIndices,
	createInitialPosition,
	generatePseudoLegalMoves,
	moveToSan
} from './chess_reconstruction.js';

const DEFAULT_OCCUPANCY_THRESHOLD = 3.25;
const CANDIDATE_STABLE_SAMPLE_COUNT = 3;
const ACTIVATION_DISTANCE = 12;
const CANDIDATE_COMMIT_DISTANCE = 12;
const IMPROVEMENT_MARGIN = 2;

function mean(values) {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
}

function sortOccupiedPieces(occupiedPieces) {
	return [...occupiedPieces].sort((a, b) => a.index - b.index || a.color.localeCompare(b.color));
}

function rowOf(index) {
	return Math.floor(index / 8);
}

function colOf(index) {
	return index % 8;
}

function indexFromRowCol(row, col) {
	return row * 8 + col;
}

function rotateIndex(index, rotation) {
	const row = rowOf(index);
	const col = colOf(index);
	switch (rotation) {
		case 0:
			return index;
		case 90:
			return indexFromRowCol(col, 7 - row);
		case 180:
			return indexFromRowCol(7 - row, 7 - col);
		case 270:
			return indexFromRowCol(7 - col, row);
		default:
			throw new Error(`Unsupported rotation ${rotation}`);
	}
}

function rotateOccupiedPieces(occupiedPieces, rotation) {
	return sortOccupiedPieces(
		occupiedPieces.map((piece) => ({
			index: rotateIndex(piece.index, rotation),
			color: piece.color
		}))
	);
}

const STANDARD_INITIAL_OCCUPIED_INDICES = boardToOccupiedIndices(createInitialPosition().board);
const STANDARD_INITIAL_OCCUPIED_SET = new Set(STANDARD_INITIAL_OCCUPIED_INDICES);

function getOrientationMatchForInitialSetup(occupiedPieces) {
	let bestMatch = null;
	for (const rotation of [0, 90, 180, 270]) {
		const rotated = rotateOccupiedPieces(occupiedPieces, rotation);
		const rotatedIndices = rotated.map((piece) => piece.index);
		const rotatedSet = new Set(rotatedIndices);
		let mismatch = 0;
		for (const index of STANDARD_INITIAL_OCCUPIED_SET) {
			if (!rotatedSet.has(index)) mismatch += 1;
		}
		for (const index of rotatedSet) {
			if (!STANDARD_INITIAL_OCCUPIED_SET.has(index)) mismatch += 1;
		}

		if (!bestMatch || mismatch < bestMatch.mismatch) {
			bestMatch = { rotation, mismatch };
		}
	}
	return bestMatch;
}

function loadImageAsMat(filePath) {
	return Jimp.read(filePath).then((image) => {
		const mat = new cv.Mat(image.bitmap.height, image.bitmap.width, cv.CV_8UC4);
		mat.data.set(image.bitmap.data);
		return mat;
	});
}

function sampleGrayStats(gray, x0, y0, x1, y1) {
	let sum = 0;
	let sumSq = 0;
	let edge = 0;
	let count = 0;

	for (let y = y0; y < y1; y += 1) {
		for (let x = x0; x < x1; x += 1) {
			const value = gray.ucharPtr(y, x)[0];
			sum += value;
			sumSq += value * value;
			if (x > 0 && x < gray.cols - 1 && y > 0 && y < gray.rows - 1) {
				edge += Math.abs(gray.ucharPtr(y, x + 1)[0] - gray.ucharPtr(y, x - 1)[0]);
				edge += Math.abs(gray.ucharPtr(y + 1, x)[0] - gray.ucharPtr(y - 1, x)[0]);
			}
			count += 1;
		}
	}

	if (count === 0) {
		return { mean: 0, std: 0, edge: 0 };
	}

	const average = sum / count;
	return {
		mean: average,
		std: Math.sqrt(Math.max(0, sumSq / count - average * average)),
		edge: edge / (count * 2)
	};
}

function sampleGrayComparisonStats(gray, referenceGray, x0, y0, x1, y1) {
	let sum = 0;
	let sumSq = 0;
	let edge = 0;
	let referenceSum = 0;
	let referenceSumSq = 0;
	let referenceEdge = 0;
	let diffSum = 0;
	let diffSumSq = 0;
	let absDiff = 0;
	let count = 0;

	for (let y = y0; y < y1; y += 1) {
		for (let x = x0; x < x1; x += 1) {
			const value = gray.ucharPtr(y, x)[0];
			const referenceValue = referenceGray.ucharPtr(y, x)[0];
			const diff = value - referenceValue;

			sum += value;
			sumSq += value * value;
			referenceSum += referenceValue;
			referenceSumSq += referenceValue * referenceValue;
			diffSum += diff;
			diffSumSq += diff * diff;
			absDiff += Math.abs(diff);

			if (x > 0 && x < gray.cols - 1 && y > 0 && y < gray.rows - 1) {
				edge += Math.abs(gray.ucharPtr(y, x + 1)[0] - gray.ucharPtr(y, x - 1)[0]);
				edge += Math.abs(gray.ucharPtr(y + 1, x)[0] - gray.ucharPtr(y - 1, x)[0]);
				referenceEdge += Math.abs(
					referenceGray.ucharPtr(y, x + 1)[0] - referenceGray.ucharPtr(y, x - 1)[0]
				);
				referenceEdge += Math.abs(
					referenceGray.ucharPtr(y + 1, x)[0] - referenceGray.ucharPtr(y - 1, x)[0]
				);
			}

			count += 1;
		}
	}

	if (count === 0) {
		return {
			current: { mean: 0, std: 0, edge: 0 },
			reference: { mean: 0, std: 0, edge: 0 },
			meanDelta: 0,
			diffStd: 0,
			absDiff: 0
		};
	}

	const average = sum / count;
	const referenceAverage = referenceSum / count;
	const meanDelta = diffSum / count;

	return {
		current: {
			mean: average,
			std: Math.sqrt(Math.max(0, sumSq / count - average * average)),
			edge: edge / (count * 2)
		},
		reference: {
			mean: referenceAverage,
			std: Math.sqrt(Math.max(0, referenceSumSq / count - referenceAverage * referenceAverage)),
			edge: referenceEdge / (count * 2)
		},
		meanDelta,
		diffStd: Math.sqrt(Math.max(0, diffSumSq / count - meanDelta * meanDelta)),
		absDiff: absDiff / count
	};
}

function sampleShiftAlignedDiff(gray, referenceGray, x0, y0, x1, y1, maxShift) {
	let bestDiffStd = Number.POSITIVE_INFINITY;
	let bestAbsDiff = Number.POSITIVE_INFINITY;
	let bestScore = Number.POSITIVE_INFINITY;

	for (let shiftY = -maxShift; shiftY <= maxShift; shiftY += 1) {
		for (let shiftX = -maxShift; shiftX <= maxShift; shiftX += 1) {
			let diffSum = 0;
			let diffSumSq = 0;
			let absDiff = 0;
			let count = 0;

			for (let y = y0; y < y1; y += 1) {
				const referenceY = y + shiftY;
				if (referenceY < 0 || referenceY >= referenceGray.rows) continue;
				for (let x = x0; x < x1; x += 1) {
					const referenceX = x + shiftX;
					if (referenceX < 0 || referenceX >= referenceGray.cols) continue;
					const diff = gray.ucharPtr(y, x)[0] - referenceGray.ucharPtr(referenceY, referenceX)[0];
					diffSum += diff;
					diffSumSq += diff * diff;
					absDiff += Math.abs(diff);
					count += 1;
				}
			}

			if (count === 0) continue;
			const meanDelta = diffSum / count;
			const diffStd = Math.sqrt(Math.max(0, diffSumSq / count - meanDelta * meanDelta));
			const averageAbsDiff = absDiff / count;
			const score = diffStd + averageAbsDiff * 0.35;

			if (score < bestScore) {
				bestScore = score;
				bestDiffStd = diffStd;
				bestAbsDiff = averageAbsDiff;
			}
		}
	}

	if (!Number.isFinite(bestScore)) {
		return { diffStd: 0, absDiff: 0 };
	}

	return {
		diffStd: bestDiffStd,
		absDiff: bestAbsDiff
	};
}

function sampleRgbMean(rgb, x0, y0, x1, y1) {
	let r = 0;
	let g = 0;
	let b = 0;
	let count = 0;

	for (let y = y0; y < y1; y += 1) {
		for (let x = x0; x < x1; x += 1) {
			const pixel = rgb.ucharPtr(y, x);
			r += pixel[0];
			g += pixel[1];
			b += pixel[2];
			count += 1;
		}
	}

	if (count === 0) return [0, 0, 0];
	return [r / count, g / count, b / count];
}

function sampleCellRgbMean(rgb, row, col, insetFactor = 0.28) {
	const cellSize = rgb.cols / 8;
	const inset = cellSize * insetFactor;
	const x0 = Math.floor(col * cellSize + inset);
	const x1 = Math.floor((col + 1) * cellSize - inset);
	const y0 = Math.floor(row * cellSize + inset);
	const y1 = Math.floor((row + 1) * cellSize - inset);
	return sampleRgbMean(rgb, x0, y0, x1, y1);
}

function rgbLuminance(rgb) {
	return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function scoreTextureOccupancyCell(gray, row, col) {
	const cellSize = gray.cols / 8;
	const inset = cellSize * 0.15;
	const x0 = Math.floor(col * cellSize + inset);
	const x1 = Math.floor((col + 1) * cellSize - inset);
	const y0 = Math.floor(row * cellSize + inset);
	const y1 = Math.floor((row + 1) * cellSize - inset);
	const current = sampleGrayStats(gray, x0, y0, x1, y1);
	return current.std + current.edge * 0.5;
}

function scoreOccupancyCell(gray, referenceGray, row, col) {
	const cellSize = gray.cols / 8;
	const outerInset = cellSize * 0.15;
	const centerInset = cellSize * 0.26;
	const coreInset = cellSize * 0.36;
	const x0 = Math.floor(col * cellSize + outerInset);
	const x1 = Math.floor((col + 1) * cellSize - outerInset);
	const y0 = Math.floor(row * cellSize + outerInset);
	const y1 = Math.floor((row + 1) * cellSize - outerInset);
	const centerX0 = Math.floor(col * cellSize + centerInset);
	const centerX1 = Math.floor((col + 1) * cellSize - centerInset);
	const centerY0 = Math.floor(row * cellSize + centerInset);
	const centerY1 = Math.floor((row + 1) * cellSize - centerInset);
	const coreX0 = Math.floor(col * cellSize + coreInset);
	const coreX1 = Math.floor((col + 1) * cellSize - coreInset);
	const coreY0 = Math.floor(row * cellSize + coreInset);
	const coreY1 = Math.floor((row + 1) * cellSize - coreInset);

	const fullComparison = sampleGrayComparisonStats(gray, referenceGray, x0, y0, x1, y1);
	const centerComparison = sampleGrayComparisonStats(
		gray,
		referenceGray,
		centerX0,
		centerY0,
		centerX1,
		centerY1
	);
	const coreComparison = sampleGrayComparisonStats(
		gray,
		referenceGray,
		coreX0,
		coreY0,
		coreX1,
		coreY1
	);
	const centerAlignedDiff = sampleShiftAlignedDiff(
		gray,
		referenceGray,
		centerX0,
		centerY0,
		centerX1,
		centerY1,
		2
	);
	const coreAlignedDiff = sampleShiftAlignedDiff(
		gray,
		referenceGray,
		coreX0,
		coreY0,
		coreX1,
		coreY1,
		1
	);
	const centerContrastShift = Math.abs(
		(centerComparison.current.mean - fullComparison.current.mean)
		- (centerComparison.reference.mean - fullComparison.reference.mean)
	);
	const coreStdGain = Math.max(0, coreComparison.current.std - coreComparison.reference.std);
	const coreEdgeGain = Math.max(0, coreComparison.current.edge - coreComparison.reference.edge);

	return (
		centerAlignedDiff.diffStd * 1.2
		+ centerAlignedDiff.absDiff * 0.35
		+ coreAlignedDiff.diffStd * 1.95
		+ coreAlignedDiff.absDiff * 0.55
		+ coreStdGain * 1.1
		+ coreEdgeGain * 0.95
		+ centerContrastShift * 0.45
	);
}

function classifyOccupiedIndicesFromReference(referenceScores, textureScores, occupancyThreshold) {
	const strictReferenceThreshold = 22 * occupancyThreshold;
	const softReferenceThreshold = 16 * occupancyThreshold;
	const textureThreshold = 10;

	return referenceScores
		.map((referenceScore, index) => ({
			index,
			referenceScore,
			textureScore: textureScores[index] ?? 0
		}))
		.filter(({ referenceScore, textureScore }) =>
			referenceScore >= strictReferenceThreshold
				|| (referenceScore >= softReferenceThreshold && textureScore >= textureThreshold)
		)
		.map(({ index }) => index);
}

function classifyOccupiedPieceColorsFromReference(referenceCoreLuminance, currentCoreLuminance, occupiedIndices) {
	const parityMeans = [[], []];
	for (let index = 0; index < referenceCoreLuminance.length; index += 1) {
		const row = rowOf(index);
		const col = colOf(index);
		parityMeans[(row + col) % 2].push(referenceCoreLuminance[index] ?? 0);
	}

	const parityAverageA = mean(parityMeans[0]);
	const parityAverageB = mean(parityMeans[1]);
	const darkSquareLuminance = Math.min(parityAverageA, parityAverageB);
	const lightSquareLuminance = Math.max(parityAverageA, parityAverageB);
	const pieceToneThreshold = (darkSquareLuminance + lightSquareLuminance) / 2;
	const neutralMargin = Math.max(6, (lightSquareLuminance - darkSquareLuminance) * 0.12);

	return sortOccupiedPieces(
		occupiedIndices.map((index) => {
			const currentLuminance = currentCoreLuminance[index] ?? 0;
			const referenceLuminance = referenceCoreLuminance[index] ?? 0;
			const luminanceDelta = currentLuminance - referenceLuminance;

			let color;
			if (currentLuminance >= pieceToneThreshold + neutralMargin) {
				color = 'white';
			} else if (currentLuminance <= pieceToneThreshold - neutralMargin) {
				color = 'black';
			} else if (luminanceDelta >= 0) {
				color = 'white';
			} else {
				color = 'black';
			}

			return { index, color };
		})
	);
}

function boardLooksEmpty(referenceScores) {
	if (referenceScores.length === 0) return true;
	const average = mean(referenceScores);
	const peak = Math.max(...referenceScores);
	return average < 14 && peak < 38;
}

function analyzeWarpedBoardFrame(warpedBoard, warpedGray, referenceWarp, referenceWarpGray, occupancyThreshold) {
	const scores = [];
	const referenceScores = [];
	const currentCoreLuminance = [];
	const referenceCoreLuminance = [];

	for (let row = 0; row < 8; row += 1) {
		for (let col = 0; col < 8; col += 1) {
			scores.push(scoreTextureOccupancyCell(warpedGray, row, col));
			currentCoreLuminance.push(rgbLuminance(sampleCellRgbMean(warpedBoard, row, col)));
			referenceScores.push(scoreOccupancyCell(warpedGray, referenceWarpGray, row, col));
			referenceCoreLuminance.push(rgbLuminance(sampleCellRgbMean(referenceWarp, row, col)));
		}
	}

	const occupiedIndices = boardLooksEmpty(referenceScores)
		? []
		: classifyOccupiedIndicesFromReference(referenceScores, scores, occupancyThreshold);
	const occupiedPieces = classifyOccupiedPieceColorsFromReference(
		referenceCoreLuminance,
		currentCoreLuminance,
		occupiedIndices
	);

	return {
		occupiedPieces,
		referenceScores,
		textureScores: scores
	};
}

function occupiedIndexDistance(observedIndices, expectedIndices) {
	const observed = new Set(observedIndices);
	const expected = new Set(expectedIndices);
	let mismatch = 0;

	for (const index of expected) {
		if (!observed.has(index)) mismatch += 1;
	}
	for (const index of observed) {
		if (!expected.has(index)) mismatch += 1;
	}

	return mismatch;
}

function decodeFramesForRotation(frameSummaries, rotation) {
	let currentPosition = createInitialPosition();
	let activated = false;
	let candidateMove = null;
	let candidateFrames = 0;
	const committedMoves = [];
	const decodedFrames = [];

	for (const summary of frameSummaries) {
		const observedIndices = rotateOccupiedPieces(summary.occupiedPieces, rotation).map((piece) => piece.index);
		const currentIndices = boardToOccupiedIndices(currentPosition.board);
		const currentDistance = occupiedIndexDistance(observedIndices, currentIndices);

		if (!activated && currentDistance <= ACTIVATION_DISTANCE) {
			activated = true;
		}

		const moveCandidates = generatePseudoLegalMoves(currentPosition)
			.map((move) => {
				const nextPosition = applyMove(currentPosition, move);
				return {
					move,
					san: moveToSan(currentPosition, move),
					nextPosition,
					distance: occupiedIndexDistance(observedIndices, boardToOccupiedIndices(nextPosition.board))
				};
			})
			.sort((a, b) => a.distance - b.distance || a.san.localeCompare(b.san));

		const bestCandidate = moveCandidates[0] ?? null;
		let state = activated ? 'stable' : 'idle';
		let reason = activated ? 'matches-current-position' : 'awaiting-start-position';

		if (
			activated
			&& bestCandidate
			&& bestCandidate.distance <= CANDIDATE_COMMIT_DISTANCE
			&& bestCandidate.distance + IMPROVEMENT_MARGIN < currentDistance
		) {
			if (candidateMove && candidateMove.san === bestCandidate.san) {
				candidateFrames += 1;
			} else {
				candidateMove = bestCandidate;
				candidateFrames = 1;
			}

			state = candidateFrames >= CANDIDATE_STABLE_SAMPLE_COUNT ? 'capture_committed' : 'candidate_stable';
			reason = candidateFrames >= CANDIDATE_STABLE_SAMPLE_COUNT
				? 'move-completion-committed'
				: 'candidate-stabilizing';

			if (candidateFrames >= CANDIDATE_STABLE_SAMPLE_COUNT) {
				committedMoves.push({
					frame: summary.frame,
					frameIndex: summary.frameIndex,
					san: candidateMove.san
				});
				currentPosition = candidateMove.nextPosition;
				candidateMove = null;
				candidateFrames = 0;
			}
		} else {
			candidateMove = null;
			candidateFrames = 0;
		}

		decodedFrames.push({
			...summary,
			currentDistance,
			bestCandidateSan: bestCandidate?.san ?? null,
			bestCandidateDistance: bestCandidate?.distance ?? null,
			state,
			reason
		});
	}

	const averageDistance = mean(decodedFrames.map((frame) => frame.currentDistance));
	return {
		rotation,
		moves: committedMoves,
		frameSummaries: decodedFrames,
		score: committedMoves.length * 1000 - averageDistance
	};
}

function listFrameFiles(streamDir) {
	return fs.readdirSync(streamDir)
		.filter((file) => /^frame-\d+\.jpg$/i.test(file))
		.sort()
		.map((file) => path.join(streamDir, file));
}

export async function analyzeStreamDirectory(
	streamDir,
	{
		occupancyThreshold = DEFAULT_OCCUPANCY_THRESHOLD
	} = {}
) {
	const frameFiles = listFrameFiles(streamDir);
	if (frameFiles.length === 0) {
		throw new Error(`No frames found in ${streamDir}`);
	}

	const referenceFrame = await loadImageAsMat(frameFiles[0]);
	const localization = localizeChessboard(referenceFrame);
	if (!localization.quad || !localization.metrics) {
		throw new Error(`Failed to localize board in reference frame for ${streamDir}`);
	}

	const referenceWarp = warpQuad(referenceFrame, localization.quad, WARP_SIZE);
	const referenceWarpGray = new cv.Mat();
	cv.cvtColor(referenceWarp, referenceWarpGray, cv.COLOR_RGBA2GRAY, 0);

	const rawFrameSummaries = [];

	for (let frameIndex = 0; frameIndex < frameFiles.length; frameIndex += 1) {
		const framePath = frameFiles[frameIndex];
		const frame = await loadImageAsMat(framePath);
		const warpedBoard = warpQuad(frame, localization.quad, WARP_SIZE);
		const warpedGray = new cv.Mat();
		cv.cvtColor(warpedBoard, warpedGray, cv.COLOR_RGBA2GRAY, 0);

		const analysis = analyzeWarpedBoardFrame(
			warpedBoard,
			warpedGray,
			referenceWarp,
			referenceWarpGray,
			occupancyThreshold
		);

		rawFrameSummaries.push({
			frame: path.basename(framePath),
			frameIndex,
			occupiedCount: analysis.occupiedPieces.length,
			whiteCount: analysis.occupiedPieces.filter((piece) => piece.color === 'white').length,
			blackCount: analysis.occupiedPieces.filter((piece) => piece.color === 'black').length,
			initialSetupMismatch: getOrientationMatchForInitialSetup(analysis.occupiedPieces)?.mismatch ?? null,
			occupiedPieces: sortOccupiedPieces(analysis.occupiedPieces)
		});

		frame.delete();
		warpedBoard.delete();
		warpedGray.delete();
	}

	referenceFrame.delete();
	referenceWarp.delete();
	referenceWarpGray.delete();
	localization.edges.delete();
	localization.dilated.delete();

	const decodedRotations = [0, 90, 180, 270].map((rotation) => decodeFramesForRotation(rawFrameSummaries, rotation));
	decodedRotations.sort((a, b) => b.score - a.score);
	const bestRotation = decodedRotations[0];

	return {
		streamDir,
		frameCount: frameFiles.length,
		localization: {
			candidateCount: localization.candidates.length,
			selectedCount: localization.selectedSquares.length,
			score: localization.metrics.totalScore
		},
		orientation: bestRotation.rotation,
		moves: bestRotation.moves.map((move) => move.san),
		moveDetails: bestRotation.moves,
		frameSummaries: bestRotation.frameSummaries
	};
}

export async function analyzeAllStreamDirectories(baseDir = 'streamdata', options = {}) {
	const directories = fs.readdirSync(baseDir)
		.map((entry) => path.join(baseDir, entry))
		.filter((entry) => fs.statSync(entry).isDirectory())
		.sort();

	const results = [];
	for (const directory of directories) {
		results.push(await analyzeStreamDirectory(directory, options));
	}
	return results;
}
