import fs from 'fs';
import path from 'path';
import cv from '@techstark/opencv-js';
import { Jimp } from 'jimp';

import {
    drawQuad,
    drawWarpGrid,
    localizeChessboard,
    warpQuad,
    writeMatImage
} from './lib/chessboard_cv.js';

/** @typedef {any} CvMat */
/** @typedef {{x: number, y: number}} Point */
/** @typedef {Point[]} Quad */
/** @typedef {{id: number, pts: Quad}} SquareCandidate */
/** @typedef {{totalScore: number, lattice: { uniqueCells: number, insideCount: number, meanResidual: number }, appearance: { colorSeparation: number, classSpread: number, averageCellStd: number, lineDelta: number }}} BoardMetrics */
/** @typedef {{quad: Quad | null, metrics: BoardMetrics | null, candidates: SquareCandidate[], selectedSquares: SquareCandidate[], edges: CvMat, dilated: CvMat}} LocalizationResult */

const inputBaseDir = 'tests/images';
const outputBaseDir = 'tests/images/out';
const debugOutputBaseDir = 'tests/images/out/debug';
const reportFile = 'tests/board_localization_report.md';
const WARP_SIZE = 320;

const TARGET_FILES = [
    'empty_board.jpg',
    'empty1.jpg',
    'empty2.jpg',
    'empty3.jpg',
    'empty4.jpg',
    'game/empty.jpg'
];

/**
 * @param {string} filePath
 */
function ensureParentDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * @param {string} baseDir
 * @param {string} relativePath
 * @param {string} suffix
 * @returns {string}
 */
function buildDerivedOutputPath(baseDir, relativePath, suffix) {
    const ext = path.extname(relativePath);
    const baseName = path.basename(relativePath, ext);
    return path.join(baseDir, path.dirname(relativePath), `${baseName}_${suffix}${ext}`);
}

/**
 * @param {CvMat} image
 * @param {SquareCandidate[]} candidates
 * @param {SquareCandidate[]} selectedSquares
 */
function drawSquareCandidates(image, candidates, selectedSquares) {
    const selectedIds = new Set(selectedSquares.map((square) => square.id));

    for (const square of candidates) {
        const color = selectedIds.has(square.id)
            ? new cv.Scalar(255, 220, 0, 255)
            : new cv.Scalar(255, 64, 64, 200);
        const thickness = selectedIds.has(square.id) ? 2 : 1;
        drawQuad(image, square.pts, color, thickness);
    }
}

/**
 * @param {BoardMetrics} metrics
 * @param {number} squareCandidateCount
 * @param {number} selectedSquareCount
 * @returns {string}
 */
function formatMetrics(metrics, squareCandidateCount, selectedSquareCount) {
    return [
        `score=${metrics.totalScore.toFixed(1)}`,
        `candidates=${squareCandidateCount}`,
        `selected=${selectedSquareCount}`,
        `cells=${metrics.lattice.uniqueCells}`,
        `inside=${metrics.lattice.insideCount}`,
        `residual=${metrics.lattice.meanResidual.toFixed(3)}`,
        `color=${metrics.appearance.colorSeparation.toFixed(1)}`,
        `spread=${metrics.appearance.classSpread.toFixed(1)}`,
        `cellStd=${metrics.appearance.averageCellStd.toFixed(1)}`,
        `lineDelta=${metrics.appearance.lineDelta.toFixed(2)}`
    ].join(', ');
}

/**
 * @param {string} relativePath
 * @returns {Promise<{relativePath: string, outputPath: string, edgesPath: string, squaresPath: string, warpPath: string, metricsSummary: string}>}
 */
async function processImage(relativePath) {
    const inputPath = path.join(inputBaseDir, relativePath);
    const outputPath = path.join(outputBaseDir, relativePath);
    const edgesPath = buildDerivedOutputPath(debugOutputBaseDir, relativePath, 'edges');
    const squaresPath = buildDerivedOutputPath(debugOutputBaseDir, relativePath, 'squares');
    const warpPath = buildDerivedOutputPath(debugOutputBaseDir, relativePath, 'warp');

    ensureParentDir(outputPath);
    ensureParentDir(edgesPath);
    ensureParentDir(squaresPath);
    ensureParentDir(warpPath);

    console.log(`Processing ${relativePath}...`);

    const image = await Jimp.read(inputPath);
    const src = new cv.Mat(image.bitmap.height, image.bitmap.width, cv.CV_8UC4);
    src.data.set(image.bitmap.data);
    /** @type {LocalizationResult} */
    const localization = localizeChessboard(src);

    const annotated = src.clone();
    const squareOverlay = src.clone();
    drawSquareCandidates(squareOverlay, localization.candidates, localization.selectedSquares);

    let warpPreview = null;
    if (localization.quad) {
        drawQuad(annotated, localization.quad, new cv.Scalar(0, 255, 0, 255), 5);
        drawQuad(squareOverlay, localization.quad, new cv.Scalar(0, 255, 0, 255), 4);
        warpPreview = warpQuad(src, localization.quad, WARP_SIZE);
        drawWarpGrid(warpPreview);
    }

    await writeMatImage(annotated, outputPath);
    await writeMatImage(localization.dilated, edgesPath);
    await writeMatImage(squareOverlay, squaresPath);
    if (warpPreview) await writeMatImage(warpPreview, warpPath);

    const metricsSummary = localization.metrics
        ? formatMetrics(localization.metrics, localization.candidates.length, localization.selectedSquares.length)
        : `score=n/a, candidates=${localization.candidates.length}, selected=${localization.selectedSquares.length}`;

    annotated.delete();
    squareOverlay.delete();
    if (warpPreview) warpPreview.delete();
    src.delete();
    localization.edges.delete();
    localization.dilated.delete();

    return {
        relativePath,
        outputPath: `images/out/${relativePath}`,
        edgesPath: `images/out/debug/${path.dirname(relativePath) === '.' ? '' : `${path.dirname(relativePath)}/`}${path.basename(relativePath, path.extname(relativePath))}_edges${path.extname(relativePath)}`,
        squaresPath: `images/out/debug/${path.dirname(relativePath) === '.' ? '' : `${path.dirname(relativePath)}/`}${path.basename(relativePath, path.extname(relativePath))}_squares${path.extname(relativePath)}`,
        warpPath: `images/out/debug/${path.dirname(relativePath) === '.' ? '' : `${path.dirname(relativePath)}/`}${path.basename(relativePath, path.extname(relativePath))}_warp${path.extname(relativePath)}`,
        metricsSummary
    };
}

cv.onRuntimeInitialized = async () => {
    try {
        let reportMd = '# Chessboard Localization Test Report\n\n';
        reportMd += 'Detector strategy: detect square-like contours, keep the dominant connected square cluster, fit a board envelope from those squares, then refine the quad using lattice support, color separation, and grid-line alignment.\n\n';
        reportMd += '| Original | Detected Board | Square Candidates | Edge Map | Rectified Board | Metrics |\n';
        reportMd += '|----------|----------------|-------------------|----------|-----------------|---------|\n';

        for (const file of TARGET_FILES) {
            const result = await processImage(file);
            reportMd += `| ![Original](images/${file}) | ![Detected](${result.outputPath}) | ![Squares](${result.squaresPath}) | ![Edges](${result.edgesPath}) | ![Warp](${result.warpPath}) | ${result.metricsSummary} |\n`;
        }

        fs.writeFileSync(reportFile, reportMd);
        console.log(`\nReport generated at ${reportFile}`);
    } catch (error) {
        console.error('Error during processing:', error);
        process.exitCode = 1;
    }
};
