import fs from 'fs';
import path from 'path';
import cv from '@techstark/opencv-js';
import { Jimp } from 'jimp';

import {
    WARP_SIZE,
    boardPointToImage,
    drawQuad,
    drawWarpGrid,
    localizeChessboard,
    warpQuad,
    writeMatImage
} from './lib/chessboard_cv.js';

const inputBaseDir = 'tests/images/game';
const outputBaseDir = 'tests/images/out/occupancy/game';
const reportFile = 'tests/board_occupancy_report.md';

const GAME_SEQUENCE = [
    { input: 'empty.jpg', output: '00-empty.jpg', label: '00-empty', move: '-' },
    { input: 'initial_setup.jpg', output: '01-initial.jpg', label: '01-initial', move: 'initial' },
    { input: 'e4.jpg', output: '02-e4.jpg', label: '02-e4', move: 'e4' },
    { input: 'e6.jpg', output: '03-e6.jpg', label: '03-e6', move: 'e6' },
    { input: 'e5.jpg', output: '04-e5.jpg', label: '04-e5', move: 'e5' },
    { input: 'd4.jpg', output: '05-d4.jpg', label: '05-d4', move: 'd4' },
    { input: 'c5.jpg', output: '06-c5.jpg', label: '06-c5', move: 'c5' },
    { input: 'nc3.jpg', output: '07-nc3.jpg', label: '07-nc3', move: 'Nc3' }
];

function ensureParentDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadImageAsMat(imagePath) {
    return Jimp.read(imagePath).then((image) => {
        const mat = new cv.Mat(image.bitmap.height, image.bitmap.width, cv.CV_8UC4);
        mat.data.set(image.bitmap.data);
        return mat;
    });
}

function cellIndexToCoords(index) {
    return {
        row: Math.floor(index / 8),
        col: index % 8
    };
}

function getOccupancyScore(warpedGray, row, col) {
    const cellSize = warpedGray.cols / 8;
    const x0 = Math.floor(col * cellSize + cellSize * 0.15);
    const x1 = Math.floor((col + 1) * cellSize - cellSize * 0.15);
    const y0 = Math.floor(row * cellSize + cellSize * 0.15);
    const y1 = Math.floor((row + 1) * cellSize - cellSize * 0.15);

    let sum = 0;
    let sumSq = 0;
    let edge = 0;
    let count = 0;

    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const value = warpedGray.ucharPtr(y, x)[0];
            sum += value;
            sumSq += value * value;

            if (x > 0 && x < warpedGray.cols - 1 && y > 0 && y < warpedGray.rows - 1) {
                edge += Math.abs(warpedGray.ucharPtr(y, x + 1)[0] - warpedGray.ucharPtr(y, x - 1)[0]);
                edge += Math.abs(warpedGray.ucharPtr(y + 1, x)[0] - warpedGray.ucharPtr(y - 1, x)[0]);
            }

            count++;
        }
    }

    if (count === 0) return 0;
    const mean = sum / count;
    const std = Math.sqrt(Math.max(0, sumSq / count - mean * mean));
    return std + (edge / (count * 2)) * 0.5;
}

function getOccupancyScores(warpedGray) {
    const scores = [];
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            scores.push(getOccupancyScore(warpedGray, row, col));
        }
    }
    return scores;
}

function selectTopNIndices(scores, count) {
    return new Set(
        scores
            .map((score, index) => ({ score, index }))
            .sort((a, b) => b.score - a.score)
            .slice(0, count)
            .map((entry) => entry.index)
    );
}

function bestSingleMoveTransition(previousOccupied, scores) {
    const currentlyOccupied = [...previousOccupied];
    const currentlyEmpty = [];
    for (let i = 0; i < 64; i++) {
        if (!previousOccupied.has(i)) currentlyEmpty.push(i);
    }

    const currentScore = currentlyOccupied.reduce((sum, index) => sum + scores[index], 0);
    let best = null;

    for (const removeIndex of currentlyOccupied) {
        for (const addIndex of currentlyEmpty) {
            const totalScore = currentScore - scores[removeIndex] + scores[addIndex];
            if (!best || totalScore > best.totalScore) {
                best = { removeIndex, addIndex, totalScore };
            }
        }
    }

    const nextOccupied = new Set(previousOccupied);
    nextOccupied.delete(best.removeIndex);
    nextOccupied.add(best.addIndex);

    return {
        occupied: nextOccupied,
        removed: [best.removeIndex],
        added: [best.addIndex]
    };
}

function diffOccupied(previousOccupied, currentOccupied) {
    const removed = [...previousOccupied].filter((index) => !currentOccupied.has(index));
    const added = [...currentOccupied].filter((index) => !previousOccupied.has(index));
    return { removed, added };
}

function drawOccupancyOnOriginal(image, quad, occupiedIndices) {
    drawQuad(image, quad, new cv.Scalar(0, 255, 0, 255), 4);

    for (const index of occupiedIndices) {
        const { row, col } = cellIndexToCoords(index);
        const point = boardPointToImage(quad, row + 0.5, col + 0.5);
        cv.circle(image, new cv.Point(point.x, point.y), 9, new cv.Scalar(255, 64, 64, 255), -1);
        cv.circle(image, new cv.Point(point.x, point.y), 9, new cv.Scalar(255, 255, 255, 255), 2);
    }
}

function drawOccupancyOnWarp(image, occupiedIndices) {
    drawWarpGrid(image);

    const cellSize = image.cols / 8;
    for (const index of occupiedIndices) {
        const { row, col } = cellIndexToCoords(index);
        const x = Math.round((row + 0.5) * cellSize);
        const y = Math.round((col + 0.5) * cellSize);
        cv.circle(image, new cv.Point(x, y), 9, new cv.Scalar(255, 64, 64, 255), -1);
        cv.circle(image, new cv.Point(x, y), 9, new cv.Scalar(255, 255, 255, 255), 2);
    }
}

function formatStateDelta(removed, added) {
    if (removed.length === 0 && added.length === 0) return '-';
    if (removed.length === 0) return `setup: +${added.length}`;
    return `${removed.length + added.length} cells changed`;
}

async function processSequence() {
    const emptyPath = path.join(inputBaseDir, 'empty.jpg');
    const emptyBoard = await loadImageAsMat(emptyPath);
    const localization = localizeChessboard(emptyBoard);

    if (!localization.quad) {
        throw new Error('Failed to localize the empty game board.');
    }

    const results = [];
    let previousOccupied = new Set();

    for (const step of GAME_SEQUENCE) {
        const inputPath = path.join(inputBaseDir, step.input);
        const outputPath = path.join(outputBaseDir, step.output);
        const warpOutputPath = path.join(outputBaseDir, step.output.replace(/\.jpg$/, '_warp.jpg'));

        ensureParentDir(outputPath);
        ensureParentDir(warpOutputPath);

        const src = await loadImageAsMat(inputPath);
        const gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        const warped = warpQuad(src, localization.quad, WARP_SIZE);
        const warpedGray = warpQuad(gray, localization.quad, WARP_SIZE);

        const scores = getOccupancyScores(warpedGray);
        let occupied = new Set();
        let removed = [];
        let added = [];

        if (step.label === '00-empty') {
            occupied = new Set();
        } else if (step.label === '01-initial') {
            occupied = selectTopNIndices(scores, 32);
            ({ removed, added } = diffOccupied(previousOccupied, occupied));
        } else {
            const transition = bestSingleMoveTransition(previousOccupied, scores);
            occupied = transition.occupied;
            removed = transition.removed;
            added = transition.added;
        }

        const originalOverlay = src.clone();
        const warpOverlay = warped.clone();

        drawOccupancyOnOriginal(originalOverlay, localization.quad, occupied);
        drawOccupancyOnWarp(warpOverlay, occupied);

        await writeMatImage(originalOverlay, outputPath);
        await writeMatImage(warpOverlay, warpOutputPath);

        results.push({
            ...step,
            outputPath: `images/out/occupancy/game/${step.output}`,
            warpOutputPath: `images/out/occupancy/game/${step.output.replace(/\.jpg$/, '_warp.jpg')}`,
            occupiedCount: occupied.size,
            changedSummary: formatStateDelta(removed, added)
        });

        previousOccupied = occupied;

        originalOverlay.delete();
        warpOverlay.delete();
        src.delete();
        gray.delete();
        warped.delete();
        warpedGray.delete();
    }

    emptyBoard.delete();
    localization.edges.delete();
    localization.dilated.delete();

    return {
        quad: localization.quad,
        metrics: localization.metrics,
        results
    };
}

cv.onRuntimeInitialized = async () => {
    try {
        const { metrics, results } = await processSequence();

        let reportMd = '# Chessboard Occupancy Test Report\n\n';
        reportMd += 'Board localization is anchored to `tests/images/game/empty.jpg`, and that fixed grid is reused for the whole game sequence. After setup, occupancy selection assumes 32 pieces remain on the board and each successive frame differs by one move. Move labels below come from the filename sequence, not piece recognition.\n\n';
        reportMd += `Reference board score: ${metrics.totalScore.toFixed(1)}. Lattice cells matched: ${metrics.lattice.uniqueCells}. Color separation: ${metrics.appearance.colorSeparation.toFixed(1)}.\n\n`;
        reportMd += '| Step | Occupancy Overlay | Warped Occupancy | Move Label | Occupied | State Delta |\n';
        reportMd += '|------|-------------------|------------------|------------|----------|-------------|\n';

        for (const result of results) {
            reportMd += `| ${result.label} | ![Overlay](${result.outputPath}) | ![Warp](${result.warpOutputPath}) | ${result.move} | ${result.occupiedCount} | ${result.changedSummary} |\n`;
        }

        fs.writeFileSync(reportFile, reportMd);
        console.log(`Report generated at ${reportFile}`);
    } catch (error) {
        console.error('Error during occupancy processing:', error);
        process.exitCode = 1;
    }
};
