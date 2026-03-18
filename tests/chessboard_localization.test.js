import fs from 'fs';
import path from 'path';
import cv from '@techstark/opencv-js';
import { Jimp } from 'jimp';

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

function ensureParentDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function buildDerivedOutputPath(baseDir, relativePath, suffix) {
    const ext = path.extname(relativePath);
    const baseName = path.basename(relativePath, ext);
    return path.join(baseDir, path.dirname(relativePath), `${baseName}_${suffix}${ext}`);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function distance(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function mean(values) {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function meanPoint(points) {
    let x = 0;
    let y = 0;
    for (const point of points) {
        x += point.x;
        y += point.y;
    }
    return { x: x / points.length, y: y / points.length };
}

function lineLength(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function normalizeAngleDegrees(angle) {
    let normalized = angle % 180;
    if (normalized < 0) normalized += 180;
    return normalized;
}

function angleDifferenceDegrees(a, b) {
    let diff = Math.abs(normalizeAngleDegrees(a) - normalizeAngleDegrees(b));
    if (diff > 90) diff = 180 - diff;
    return diff;
}

function orderQuadPoints(points) {
    const byY = [...points].sort((a, b) => a.y - b.y);
    const top = byY.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = byY.slice(2, 4).sort((a, b) => b.x - a.x);
    return [...top, ...bottom];
}

function quadArea(quad) {
    let area = 0;
    for (let i = 0; i < 4; i++) {
        const a = quad[i];
        const b = quad[(i + 1) % 4];
        area += a.x * b.y - b.x * a.y;
    }
    return Math.abs(area) / 2;
}

function isConvexQuad(quad) {
    if (quad.length !== 4) return false;
    let sign = 0;
    for (let i = 0; i < 4; i++) {
        const a = quad[i];
        const b = quad[(i + 1) % 4];
        const c = quad[(i + 2) % 4];
        const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if (Math.abs(cross) < 1e-3) continue;
        const currentSign = Math.sign(cross);
        if (sign === 0) sign = currentSign;
        else if (sign !== currentSign) return false;
    }
    return quadArea(quad) > 100;
}

function getSquareStats(quad) {
    const edgeLengths = [];
    for (let i = 0; i < 4; i++) {
        edgeLengths.push(lineLength(quad[i], quad[(i + 1) % 4]));
    }

    const minEdge = Math.max(1, Math.min(...edgeLengths));
    const maxEdge = Math.max(...edgeLengths);
    const center = meanPoint(quad);
    const topEdgeAngle = normalizeAngleDegrees(
        Math.atan2(quad[1].y - quad[0].y, quad[1].x - quad[0].x) * 180 / Math.PI
    );

    return {
        center,
        edgeLengths,
        meanEdge: mean(edgeLengths),
        edgeRatio: maxEdge / minEdge,
        angle: topEdgeAngle
    };
}

async function writeMatImage(mat, outputPath) {
    ensureParentDir(outputPath);

    const image = new Jimp({ width: mat.cols, height: mat.rows });
    const channels = mat.channels();

    if (channels === 4) {
        image.bitmap.data.set(mat.data);
    } else if (channels === 3) {
        let offset = 0;
        for (let y = 0; y < mat.rows; y++) {
            for (let x = 0; x < mat.cols; x++) {
                const pixel = mat.ucharPtr(y, x);
                image.bitmap.data[offset++] = pixel[0];
                image.bitmap.data[offset++] = pixel[1];
                image.bitmap.data[offset++] = pixel[2];
                image.bitmap.data[offset++] = 255;
            }
        }
    } else if (channels === 1) {
        let offset = 0;
        for (let y = 0; y < mat.rows; y++) {
            for (let x = 0; x < mat.cols; x++) {
                const value = mat.ucharPtr(y, x)[0];
                image.bitmap.data[offset++] = value;
                image.bitmap.data[offset++] = value;
                image.bitmap.data[offset++] = value;
                image.bitmap.data[offset++] = 255;
            }
        }
    } else {
        throw new Error(`Unsupported channel count: ${channels}`);
    }

    await image.write(outputPath);
}

function warpQuad(mat, quad, size) {
    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flatMap((point) => [point.x, point.y]));
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, size, 0, size, size, 0, size]);
    const transform = cv.getPerspectiveTransform(srcTri, dstTri);
    const warped = new cv.Mat();
    cv.warpPerspective(
        mat,
        warped,
        transform,
        new cv.Size(size, size),
        cv.INTER_LINEAR,
        cv.BORDER_REPLICATE,
        new cv.Scalar()
    );
    srcTri.delete();
    dstTri.delete();
    transform.delete();
    return warped;
}

function sampleGrayMeanStd(gray, x0, y0, x1, y1) {
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const value = gray.ucharPtr(y, x)[0];
            sum += value;
            sumSq += value * value;
            count++;
        }
    }
    if (count === 0) return { mean: 0, std: 0 };
    const average = sum / count;
    return {
        mean: average,
        std: Math.sqrt(Math.max(0, sumSq / count - average * average))
    };
}

function sampleRgbMean(rgb, x0, y0, x1, y1) {
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;

    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const pixel = rgb.ucharPtr(y, x);
            r += pixel[0];
            g += pixel[1];
            b += pixel[2];
            count++;
        }
    }

    if (count === 0) return [0, 0, 0];
    return [r / count, g / count, b / count];
}

function rgbDistance(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function lineStrength(gray, isVertical, position, thickness = 2) {
    let sum = 0;
    let count = 0;

    if (isVertical) {
        for (let y = 0; y < gray.rows; y++) {
            for (let dx = -thickness; dx <= thickness; dx++) {
                const x = clamp(position + dx, 1, gray.cols - 2);
                sum += Math.abs(gray.ucharPtr(y, x + 1)[0] - gray.ucharPtr(y, x - 1)[0]);
                count++;
            }
        }
    } else {
        for (let x = 0; x < gray.cols; x++) {
            for (let dy = -thickness; dy <= thickness; dy++) {
                const y = clamp(position + dy, 1, gray.rows - 2);
                sum += Math.abs(gray.ucharPtr(y + 1, x)[0] - gray.ucharPtr(y - 1, x)[0]);
                count++;
            }
        }
    }

    return count === 0 ? 0 : sum / count;
}

function getLatticeMetrics(quad, selectedSquares) {
    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flatMap((point) => [point.x, point.y]));
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 8, 0, 8, 8, 0, 8]);
    const transform = cv.getPerspectiveTransform(srcTri, dstTri);

    const matchedCells = new Map();
    let insideCount = 0;

    for (const square of selectedSquares) {
        const point = cv.matFromArray(1, 1, cv.CV_32FC2, [square.center.x, square.center.y]);
        const transformedPoint = new cv.Mat();
        cv.perspectiveTransform(point, transformedPoint, transform);

        const u = transformedPoint.data32F[0];
        const v = transformedPoint.data32F[1];

        point.delete();
        transformedPoint.delete();

        if (u >= 0 && u <= 8 && v >= 0 && v <= 8) insideCount++;

        const nearestU = Math.round(u - 0.5) + 0.5;
        const nearestV = Math.round(v - 0.5) + 0.5;
        const cellX = Math.floor(nearestU);
        const cellY = Math.floor(nearestV);
        const residual = Math.hypot(u - nearestU, v - nearestV);

        if (cellX < 0 || cellX >= 8 || cellY < 0 || cellY >= 8 || residual > 0.42) continue;

        const key = `${cellX},${cellY}`;
        const previousResidual = matchedCells.get(key);
        if (previousResidual === undefined || residual < previousResidual) {
            matchedCells.set(key, residual);
        }
    }

    transform.delete();
    srcTri.delete();
    dstTri.delete();

    const residuals = [...matchedCells.values()];
    return {
        uniqueCells: matchedCells.size,
        insideCount,
        meanResidual: residuals.length === 0 ? 1 : mean(residuals)
    };
}

function getBoardAppearanceMetrics(rgb, gray, quad) {
    const warpedRgb = warpQuad(rgb, quad, WARP_SIZE);
    const warpedGray = warpQuad(gray, quad, WARP_SIZE);
    const cellSize = WARP_SIZE / 8;

    const evenColors = [];
    const oddColors = [];
    const cellStdDeviations = [];

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const x0 = Math.floor(col * cellSize + cellSize * 0.2);
            const x1 = Math.floor((col + 1) * cellSize - cellSize * 0.2);
            const y0 = Math.floor(row * cellSize + cellSize * 0.2);
            const y1 = Math.floor((row + 1) * cellSize - cellSize * 0.2);

            const color = sampleRgbMean(warpedRgb, x0, y0, x1, y1);
            const grayStats = sampleGrayMeanStd(warpedGray, x0, y0, x1, y1);

            if ((row + col) % 2 === 0) evenColors.push(color);
            else oddColors.push(color);

            cellStdDeviations.push(grayStats.std);
        }
    }

    const meanColor = (colors) => [
        mean(colors.map((color) => color[0])),
        mean(colors.map((color) => color[1])),
        mean(colors.map((color) => color[2]))
    ];

    const evenMean = meanColor(evenColors);
    const oddMean = meanColor(oddColors);
    const colorSeparation = rgbDistance(evenMean, oddMean);
    const classSpread = mean(evenColors.map((color) => rgbDistance(color, evenMean)))
        + mean(oddColors.map((color) => rgbDistance(color, oddMean)));

    let internalLineStrength = 0;
    let midCellStrength = 0;
    for (let i = 1; i < 8; i++) {
        const linePosition = Math.round(i * cellSize);
        internalLineStrength += lineStrength(warpedGray, true, linePosition);
        internalLineStrength += lineStrength(warpedGray, false, linePosition);
    }
    for (let i = 0; i < 8; i++) {
        const linePosition = Math.round((i + 0.5) * cellSize);
        midCellStrength += lineStrength(warpedGray, true, linePosition);
        midCellStrength += lineStrength(warpedGray, false, linePosition);
    }

    const borderStrength = (
        lineStrength(warpedGray, true, 2) +
        lineStrength(warpedGray, true, WARP_SIZE - 3) +
        lineStrength(warpedGray, false, 2) +
        lineStrength(warpedGray, false, WARP_SIZE - 3)
    ) / 4;

    const metrics = {
        colorSeparation,
        classSpread,
        averageCellStd: mean(cellStdDeviations),
        lineDelta: internalLineStrength / 14 - midCellStrength / 16,
        borderStrength
    };

    warpedRgb.delete();
    warpedGray.delete();
    return metrics;
}

function getOutOfBoundsPenalty(quad, cols, rows) {
    let overflow = 0;
    for (const point of quad) {
        overflow += Math.max(0, -point.x);
        overflow += Math.max(0, -point.y);
        overflow += Math.max(0, point.x - cols);
        overflow += Math.max(0, point.y - rows);
    }
    return overflow / Math.max(cols, rows);
}

function evaluateBoardHypothesis(rgb, gray, quad, selectedSquares, cols, rows) {
    if (!isConvexQuad(quad)) {
        return {
            totalScore: Number.NEGATIVE_INFINITY,
            lattice: { uniqueCells: 0, insideCount: 0, meanResidual: 1 },
            appearance: {
                colorSeparation: 0,
                classSpread: 999,
                averageCellStd: 999,
                lineDelta: -999,
                borderStrength: 0
            },
            boundsPenalty: 999
        };
    }

    const lattice = getLatticeMetrics(quad, selectedSquares);
    const appearance = getBoardAppearanceMetrics(rgb, gray, quad);
    const boundsPenalty = getOutOfBoundsPenalty(quad, cols, rows);

    const totalScore =
        lattice.uniqueCells * 10 +
        lattice.insideCount * 2 -
        lattice.meanResidual * 30 +
        appearance.colorSeparation * 0.5 -
        appearance.classSpread * 0.3 -
        appearance.averageCellStd * 0.35 +
        appearance.lineDelta * 8 +
        appearance.borderStrength * 0.25 -
        boundsPenalty * 50;

    return {
        totalScore,
        lattice,
        appearance,
        boundsPenalty
    };
}

function drawQuad(image, quad, color, thickness) {
    for (let i = 0; i < 4; i++) {
        const start = new cv.Point(quad[i].x, quad[i].y);
        const end = new cv.Point(quad[(i + 1) % 4].x, quad[(i + 1) % 4].y);
        cv.line(image, start, end, color, thickness);
    }
}

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

function drawWarpGrid(image) {
    const cellSize = image.cols / 8;
    for (let i = 1; i < 8; i++) {
        const position = Math.round(i * cellSize);
        cv.line(image, new cv.Point(position, 0), new cv.Point(position, image.rows), new cv.Scalar(255, 220, 0, 255), 1);
        cv.line(image, new cv.Point(0, position), new cv.Point(image.cols, position), new cv.Scalar(255, 220, 0, 255), 1);
    }
    cv.rectangle(
        image,
        new cv.Point(0, 0),
        new cv.Point(image.cols - 1, image.rows - 1),
        new cv.Scalar(0, 255, 0, 255),
        3
    );
}

function detectSquareCandidates(gray, imageArea) {
    const blurred = new cv.Mat();
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

    const edges = new cv.Mat();
    cv.Canny(blurred, edges, 50, 150, 3, false);

    const dilated = new cv.Mat();
    const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(edges, dilated, kernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(dilated, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const candidates = [];

    for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour, false);

        if (area < imageArea * 0.0002 || area > imageArea * 0.03) {
            continue;
        }

        const polygon = new cv.Mat();
        cv.approxPolyDP(contour, polygon, 0.03 * cv.arcLength(contour, true), true);

        if (polygon.rows === 4 && cv.isContourConvex(polygon)) {
            const rawPoints = [];
            for (let j = 0; j < 4; j++) {
                rawPoints.push({
                    x: polygon.data32S[j * 2],
                    y: polygon.data32S[j * 2 + 1]
                });
            }

            const quad = orderQuadPoints(rawPoints);
            const stats = getSquareStats(quad);
            if (stats.edgeRatio <= 1.8 && stats.meanEdge >= 8) {
                candidates.push({
                    id: candidates.length,
                    pts: quad,
                    center: stats.center,
                    area,
                    meanEdge: stats.meanEdge,
                    angle: stats.angle
                });
            }
        }

        polygon.delete();
    }

    contours.delete();
    hierarchy.delete();
    kernel.delete();
    blurred.delete();

    return { candidates, edges, dilated };
}

function selectBoardSquares(candidates) {
    if (candidates.length <= 4) return candidates;

    const medianArea = median(candidates.map((candidate) => candidate.area));
    const medianEdge = median(candidates.map((candidate) => candidate.meanEdge));
    const dominantAngle = median(candidates.map((candidate) => candidate.angle));

    const filtered = candidates.filter((candidate) => (
        candidate.area >= medianArea * 0.35 &&
        candidate.area <= medianArea * 2.8 &&
        candidate.meanEdge >= medianEdge * 0.6 &&
        candidate.meanEdge <= medianEdge * 1.8 &&
        angleDifferenceDegrees(candidate.angle, dominantAngle) <= 20
    ));

    if (filtered.length <= 4) return filtered.length > 0 ? filtered : candidates;

    const neighborDistance = medianEdge * 3.2;
    const visited = new Set();
    const components = [];

    for (const candidate of filtered) {
        if (visited.has(candidate.id)) continue;

        const queue = [candidate];
        const component = [];
        visited.add(candidate.id);

        while (queue.length > 0) {
            const current = queue.shift();
            component.push(current);

            for (const neighbor of filtered) {
                if (visited.has(neighbor.id)) continue;

                const centerDistance = distance(current.center, neighbor.center);
                if (centerDistance > neighborDistance) continue;

                const areaRatio = Math.max(current.area, neighbor.area) / Math.max(1, Math.min(current.area, neighbor.area));
                if (areaRatio > 2.5) continue;

                if (angleDifferenceDegrees(current.angle, neighbor.angle) > 18) continue;

                visited.add(neighbor.id);
                queue.push(neighbor);
            }
        }

        components.push(component);
    }

    components.sort((a, b) => b.length - a.length);
    const bestComponent = components[0];
    return bestComponent && bestComponent.length > 0 ? bestComponent : filtered;
}

function fitInitialBoardQuads(selectedSquares) {
    if (selectedSquares.length < 4) return [];

    const coordinates = [];
    for (const square of selectedSquares) {
        for (const point of square.pts) {
            coordinates.push(point.x, point.y);
        }
    }

    const pointsMat = cv.matFromArray(selectedSquares.length * 4, 1, cv.CV_32SC2, coordinates);
    const candidateQuads = [];

    const hull = new cv.Mat();
    cv.convexHull(pointsMat, hull, true, true);
    const hullApprox = new cv.Mat();
    cv.approxPolyDP(hull, hullApprox, 0.03 * cv.arcLength(hull, true), true);

    if (hullApprox.rows === 4) {
        const quad = [];
        for (let i = 0; i < 4; i++) {
            quad.push({
                x: hullApprox.data32S[i * 2],
                y: hullApprox.data32S[i * 2 + 1]
            });
        }
        candidateQuads.push(orderQuadPoints(quad));
    }

    const minRectQuad = orderQuadPoints(cv.RotatedRect.points(cv.minAreaRect(pointsMat)));
    candidateQuads.push(minRectQuad);

    hull.delete();
    hullApprox.delete();
    pointsMat.delete();

    const deduped = [];
    for (const quad of candidateQuads) {
        const duplicate = deduped.some((existing) => {
            const totalCornerDistance = existing.reduce(
                (sum, point, index) => sum + distance(point, quad[index]),
                0
            );
            return totalCornerDistance < 20;
        });
        if (!duplicate) deduped.push(quad);
    }

    return deduped;
}

function optimizeBoardQuad(rgb, gray, selectedSquares, initialQuad, cols, rows) {
    let bestQuad = initialQuad.map((point) => ({ x: point.x, y: point.y }));
    let bestMetrics = evaluateBoardHypothesis(rgb, gray, bestQuad, selectedSquares, cols, rows);

    for (const step of [12, 6, 3, 1]) {
        let improved = true;

        while (improved) {
            improved = false;

            for (let i = 0; i < 4; i++) {
                for (const dx of [-step, 0, step]) {
                    for (const dy of [-step, 0, step]) {
                        if (dx === 0 && dy === 0) continue;

                        const candidateQuad = bestQuad.map((point, index) => (
                            index === i
                                ? { x: point.x + dx, y: point.y + dy }
                                : { x: point.x, y: point.y }
                        ));

                        const orderedQuad = orderQuadPoints(candidateQuad);
                        const metrics = evaluateBoardHypothesis(rgb, gray, orderedQuad, selectedSquares, cols, rows);
                        if (metrics.totalScore > bestMetrics.totalScore) {
                            bestQuad = orderedQuad;
                            bestMetrics = metrics;
                            improved = true;
                        }
                    }
                }
            }
        }
    }

    return {
        quad: bestQuad,
        metrics: bestMetrics
    };
}

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

    const rgb = new cv.Mat();
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB, 0);

    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

    const { candidates, edges, dilated } = detectSquareCandidates(gray, src.rows * src.cols);
    const selectedSquares = selectBoardSquares(candidates);
    const initialQuads = fitInitialBoardQuads(selectedSquares);

    let bestDetection = null;
    for (const quad of initialQuads) {
        const candidateDetection = optimizeBoardQuad(rgb, gray, selectedSquares, quad, src.cols, src.rows);
        if (!bestDetection || candidateDetection.metrics.totalScore > bestDetection.metrics.totalScore) {
            bestDetection = candidateDetection;
        }
    }

    const annotated = src.clone();
    const squareOverlay = src.clone();
    drawSquareCandidates(squareOverlay, candidates, selectedSquares);

    let warpPreview = null;
    if (bestDetection) {
        drawQuad(annotated, bestDetection.quad, new cv.Scalar(0, 255, 0, 255), 5);
        drawQuad(squareOverlay, bestDetection.quad, new cv.Scalar(0, 255, 0, 255), 4);
        warpPreview = warpQuad(src, bestDetection.quad, WARP_SIZE);
        drawWarpGrid(warpPreview);
    }

    await writeMatImage(annotated, outputPath);
    await writeMatImage(dilated, edgesPath);
    await writeMatImage(squareOverlay, squaresPath);
    if (warpPreview) await writeMatImage(warpPreview, warpPath);

    const metricsSummary = bestDetection
        ? formatMetrics(bestDetection.metrics, candidates.length, selectedSquares.length)
        : `score=n/a, candidates=${candidates.length}, selected=${selectedSquares.length}`;

    annotated.delete();
    squareOverlay.delete();
    if (warpPreview) warpPreview.delete();
    src.delete();
    rgb.delete();
    gray.delete();
    edges.delete();
    dilated.delete();

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
