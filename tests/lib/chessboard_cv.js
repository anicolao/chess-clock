import fs from 'fs';
import path from 'path';
import cv from '@techstark/opencv-js';
import { Jimp } from 'jimp';

/** @typedef {any} CvMat */
/** @typedef {any} CvScalar */
/** @typedef {{x: number, y: number}} Point */
/** @typedef {Point[]} Quad */
/** @typedef {[number, number, number]} RgbColor */
/** @typedef {{mean: number, std: number}} GrayStats */
/** @typedef {{center: Point, meanEdge: number, edgeRatio: number, angle: number}} SquareStats */
/** @typedef {{id: number, pts: Quad, center: Point, area: number, meanEdge: number, angle: number}} SquareCandidate */
/** @typedef {{uniqueCells: number, insideCount: number, meanResidual: number}} LatticeMetrics */
/** @typedef {{colorSeparation: number, classSpread: number, averageCellStd: number, lineDelta: number, borderStrength: number}} AppearanceMetrics */
/** @typedef {{totalScore: number, lattice: LatticeMetrics, appearance: AppearanceMetrics, boundsPenalty: number}} BoardMetrics */
/** @typedef {{quad: Quad, metrics: BoardMetrics}} BoardDetection */
/** @typedef {{quad: Quad | null, metrics: BoardMetrics | null, candidates: SquareCandidate[], selectedSquares: SquareCandidate[], edges: CvMat, dilated: CvMat}} LocalizationResult */

export const WARP_SIZE = 320;

/**
 * @param {string} filePath
 */
function ensureParentDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * @param {Point} p1
 * @param {Point} p2
 * @returns {number}
 */
function distance(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

/**
 * @param {number[]} values
 * @returns {number}
 */
function mean(values) {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * @param {Point[]} points
 * @returns {Point}
 */
function meanPoint(points) {
    let x = 0;
    let y = 0;
    for (const point of points) {
        x += point.x;
        y += point.y;
    }
    return { x: x / points.length, y: y / points.length };
}

/**
 * @param {Point} p1
 * @param {Point} p2
 * @returns {number}
 */
function lineLength(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

/**
 * @param {number} angle
 * @returns {number}
 */
function normalizeAngleDegrees(angle) {
    let normalized = angle % 180;
    if (normalized < 0) normalized += 180;
    return normalized;
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function angleDifferenceDegrees(a, b) {
    let diff = Math.abs(normalizeAngleDegrees(a) - normalizeAngleDegrees(b));
    if (diff > 90) diff = 180 - diff;
    return diff;
}

/**
 * @param {Point[]} points
 * @returns {Quad}
 */
export function orderQuadPoints(points) {
    const byY = [...points].sort((a, b) => a.y - b.y);
    const top = byY.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = byY.slice(2, 4).sort((a, b) => b.x - a.x);
    return [...top, ...bottom];
}

/**
 * @param {Quad} quad
 * @returns {number}
 */
function quadArea(quad) {
    let area = 0;
    for (let i = 0; i < 4; i++) {
        const a = quad[i];
        const b = quad[(i + 1) % 4];
        area += a.x * b.y - b.x * a.y;
    }
    return Math.abs(area) / 2;
}

/**
 * @param {Quad} quad
 * @returns {boolean}
 */
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

/**
 * @param {Quad} quad
 * @returns {SquareStats}
 */
function getSquareStats(quad) {
    /** @type {number[]} */
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
        meanEdge: mean(edgeLengths),
        edgeRatio: maxEdge / minEdge,
        angle: topEdgeAngle
    };
}

/**
 * @param {CvMat} mat
 * @param {string} outputPath
 * @returns {Promise<void>}
 */
export async function writeMatImage(mat, outputPath) {
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

    await image.write(/** @type {`${string}.${string}`} */ (outputPath));
}

/**
 * @param {CvMat} mat
 * @param {Quad} quad
 * @param {number} [size]
 * @returns {CvMat}
 */
export function warpQuad(mat, quad, size = WARP_SIZE) {
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

/**
 * @param {CvMat} gray
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @returns {GrayStats}
 */
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

/**
 * @param {CvMat} rgb
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @returns {RgbColor}
 */
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

/**
 * @param {RgbColor} a
 * @param {RgbColor} b
 * @returns {number}
 */
function rgbDistance(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * @param {CvMat} gray
 * @param {boolean} isVertical
 * @param {number} position
 * @param {number} [thickness]
 * @returns {number}
 */
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

/**
 * @param {Quad} quad
 * @param {SquareCandidate[]} selectedSquares
 * @returns {LatticeMetrics}
 */
function getLatticeMetrics(quad, selectedSquares) {
    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flatMap((point) => [point.x, point.y]));
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 8, 0, 8, 8, 0, 8]);
    const transform = cv.getPerspectiveTransform(srcTri, dstTri);

    /** @type {Map<string, number>} */
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

/**
 * @param {CvMat} rgb
 * @param {CvMat} gray
 * @param {Quad} quad
 * @returns {AppearanceMetrics}
 */
function getBoardAppearanceMetrics(rgb, gray, quad) {
    const warpedRgb = warpQuad(rgb, quad, WARP_SIZE);
    const warpedGray = warpQuad(gray, quad, WARP_SIZE);
    const cellSize = WARP_SIZE / 8;

    /** @type {RgbColor[]} */
    const evenColors = [];
    /** @type {RgbColor[]} */
    const oddColors = [];
    /** @type {number[]} */
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

    /**
     * @param {RgbColor[]} colors
     * @returns {RgbColor}
     */
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

    warpedRgb.delete();
    warpedGray.delete();

    return {
        colorSeparation,
        classSpread,
        averageCellStd: mean(cellStdDeviations),
        lineDelta: internalLineStrength / 14 - midCellStrength / 16,
        borderStrength
    };
}

/**
 * @param {Quad} quad
 * @param {number} cols
 * @param {number} rows
 * @returns {number}
 */
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

/**
 * @param {CvMat} rgb
 * @param {CvMat} gray
 * @param {Quad} quad
 * @param {SquareCandidate[]} selectedSquares
 * @param {number} cols
 * @param {number} rows
 * @returns {BoardMetrics}
 */
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
            boundsPenalty: Number.POSITIVE_INFINITY
        };
    }

    const lattice = getLatticeMetrics(quad, selectedSquares);
    const appearance = getBoardAppearanceMetrics(rgb, gray, quad);
    const boundsPenalty = getOutOfBoundsPenalty(quad, cols, rows);

    return {
        totalScore:
            lattice.uniqueCells * 10 +
            lattice.insideCount * 2 -
            lattice.meanResidual * 30 +
            appearance.colorSeparation * 0.5 -
            appearance.classSpread * 0.3 -
            appearance.averageCellStd * 0.35 +
            appearance.lineDelta * 8 +
            appearance.borderStrength * 0.25 -
            boundsPenalty * 50,
        lattice,
        appearance,
        boundsPenalty
    };
}

/**
 * @param {CvMat} gray
 * @param {number} imageArea
 * @returns {{ candidates: SquareCandidate[], edges: CvMat, dilated: CvMat }}
 */
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

    /** @type {SquareCandidate[]} */
    const candidates = [];

    for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour, false);

        if (area < imageArea * 0.0002 || area > imageArea * 0.03) continue;

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

/**
 * @param {SquareCandidate[]} candidates
 * @returns {SquareCandidate[]}
 */
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
    /** @type {SquareCandidate[][]} */
    const components = [];

    for (const candidate of filtered) {
        if (visited.has(candidate.id)) continue;

        const queue = [candidate];
        const component = [];
        visited.add(candidate.id);

        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) continue;
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
    return components[0] && components[0].length > 0 ? components[0] : filtered;
}

/**
 * @param {SquareCandidate[]} selectedSquares
 * @returns {Quad[]}
 */
function fitInitialBoardQuads(selectedSquares) {
    if (selectedSquares.length < 4) return [];

    /** @type {number[]} */
    const coordinates = [];
    for (const square of selectedSquares) {
        for (const point of square.pts) {
            coordinates.push(point.x, point.y);
        }
    }

    const pointsMat = cv.matFromArray(selectedSquares.length * 4, 1, cv.CV_32SC2, coordinates);
    /** @type {Quad[]} */
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

    candidateQuads.push(orderQuadPoints(cv.RotatedRect.points(cv.minAreaRect(pointsMat))));

    hull.delete();
    hullApprox.delete();
    pointsMat.delete();

    /** @type {Quad[]} */
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

/**
 * @param {CvMat} rgb
 * @param {CvMat} gray
 * @param {SquareCandidate[]} selectedSquares
 * @param {Quad} initialQuad
 * @param {number} cols
 * @param {number} rows
 * @returns {BoardDetection}
 */
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

    return { quad: bestQuad, metrics: bestMetrics };
}

/**
 * @param {CvMat} image
 * @param {Quad} quad
 * @param {CvScalar} color
 * @param {number} thickness
 */
export function drawQuad(image, quad, color, thickness) {
    for (let i = 0; i < 4; i++) {
        const start = new cv.Point(quad[i].x, quad[i].y);
        const end = new cv.Point(quad[(i + 1) % 4].x, quad[(i + 1) % 4].y);
        cv.line(image, start, end, color, thickness);
    }
}

/**
 * @param {CvMat} image
 */
export function drawWarpGrid(image) {
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

/**
 * @param {Quad} quad
 * @param {number} boardX
 * @param {number} boardY
 * @returns {Point}
 */
export function boardPointToImage(quad, boardX, boardY) {
    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 8, 0, 8, 8, 0, 8]);
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flatMap((point) => [point.x, point.y]));
    const transform = cv.getPerspectiveTransform(srcTri, dstTri);
    const point = cv.matFromArray(1, 1, cv.CV_32FC2, [boardX, boardY]);
    const transformedPoint = new cv.Mat();
    cv.perspectiveTransform(point, transformedPoint, transform);

    const result = {
        x: transformedPoint.data32F[0],
        y: transformedPoint.data32F[1]
    };

    srcTri.delete();
    dstTri.delete();
    transform.delete();
    point.delete();
    transformedPoint.delete();
    return result;
}

/**
 * @param {CvMat} src
 * @returns {LocalizationResult}
 */
export function localizeChessboard(src) {
    const rgb = new cv.Mat();
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB, 0);

    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

    const { candidates, edges, dilated } = detectSquareCandidates(gray, src.rows * src.cols);
    const selectedSquares = selectBoardSquares(candidates);
    const initialQuads = fitInitialBoardQuads(selectedSquares);

    /** @type {BoardDetection | null} */
    let bestDetection = null;
    for (const quad of initialQuads) {
        const candidateDetection = optimizeBoardQuad(rgb, gray, selectedSquares, quad, src.cols, src.rows);
        if (!bestDetection || candidateDetection.metrics.totalScore > bestDetection.metrics.totalScore) {
            bestDetection = candidateDetection;
        }
    }

    rgb.delete();
    gray.delete();

    return {
        quad: bestDetection?.quad ?? null,
        metrics: bestDetection?.metrics ?? null,
        candidates,
        selectedSquares,
        edges,
        dilated
    };
}
