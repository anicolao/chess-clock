import type { BoardCalibration, NormalizedPoint } from '$lib/board-calibration';

export const WARP_SIZE = 320;

export type ImagePoint = { x: number; y: number };
type OpenCvModule = typeof import('@techstark/opencv-js');

function clamp(value: number, min: number, max: number) {
	return Math.max(min, Math.min(max, value));
}

function mean(values: number[]) {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
}

function distance(a: ImagePoint, b: ImagePoint) {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeAngleDegrees(angle: number) {
	let normalized = angle % 180;
	if (normalized < 0) normalized += 180;
	return normalized;
}

function angleDifferenceDegrees(a: number, b: number) {
	let diff = Math.abs(normalizeAngleDegrees(a) - normalizeAngleDegrees(b));
	if (diff > 90) diff = 180 - diff;
	return diff;
}

function meanPoint(points: ImagePoint[]) {
	let x = 0;
	let y = 0;
	for (const point of points) {
		x += point.x;
		y += point.y;
	}
	return { x: x / points.length, y: y / points.length };
}

export function orderQuadPoints(points: ImagePoint[]): ImagePoint[] {
	const byY = [...points].sort((a, b) => a.y - b.y);
	const top = byY.slice(0, 2).sort((a, b) => a.x - b.x);
	const bottom = byY.slice(2, 4).sort((a, b) => b.x - a.x);
	return [...top, ...bottom];
}

function lineLength(a: ImagePoint, b: ImagePoint) {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function quadArea(quad: ImagePoint[]) {
	let area = 0;
	for (let i = 0; i < 4; i++) {
		const a = quad[i];
		const b = quad[(i + 1) % 4];
		area += a.x * b.y - b.x * a.y;
	}
	return Math.abs(area) / 2;
}

function isConvexQuad(quad: ImagePoint[]) {
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

function getSquareStats(quad: ImagePoint[]) {
	const edgeLengths = [];
	for (let i = 0; i < 4; i++) {
		edgeLengths.push(lineLength(quad[i], quad[(i + 1) % 4]));
	}

	const minEdge = Math.max(1, Math.min(...edgeLengths));
	const maxEdge = Math.max(...edgeLengths);
	return {
		center: meanPoint(quad),
		meanEdge: mean(edgeLengths),
		edgeRatio: maxEdge / minEdge,
		angle: normalizeAngleDegrees(
			Math.atan2(quad[1].y - quad[0].y, quad[1].x - quad[0].x) * 180 / Math.PI
		)
	};
}

function matFromImageData(cv: OpenCvModule, imageData: ImageData) {
	const mat = new cv.Mat(imageData.height, imageData.width, cv.CV_8UC4);
	mat.data.set(imageData.data);
	return mat;
}

function imageDataFromMat(mat: InstanceType<OpenCvModule['Mat']>) {
	const output = new Uint8ClampedArray(mat.rows * mat.cols * 4);
	const channels = mat.channels();

	if (channels === 4) {
		output.set(mat.data);
	} else if (channels === 3) {
		let offset = 0;
		for (let y = 0; y < mat.rows; y++) {
			for (let x = 0; x < mat.cols; x++) {
				const pixel = mat.ucharPtr(y, x);
				output[offset++] = pixel[0];
				output[offset++] = pixel[1];
				output[offset++] = pixel[2];
				output[offset++] = 255;
			}
		}
	} else if (channels === 1) {
		let offset = 0;
		for (let y = 0; y < mat.rows; y++) {
			for (let x = 0; x < mat.cols; x++) {
				const value = mat.ucharPtr(y, x)[0];
				output[offset++] = value;
				output[offset++] = value;
				output[offset++] = value;
				output[offset++] = 255;
			}
		}
	} else {
		throw new Error(`Unsupported Mat channel count: ${channels}`);
	}

	return new ImageData(output, mat.cols, mat.rows);
}

function sampleGrayStats(
	gray: InstanceType<OpenCvModule['Mat']>,
	x0: number,
	y0: number,
	x1: number,
	y1: number
) {
	let sum = 0;
	let sumSq = 0;
	let edge = 0;
	let count = 0;

	for (let y = y0; y < y1; y++) {
		for (let x = x0; x < x1; x++) {
			const value = gray.ucharPtr(y, x)[0];
			sum += value;
			sumSq += value * value;

			if (x > 0 && x < gray.cols - 1 && y > 0 && y < gray.rows - 1) {
				edge += Math.abs(gray.ucharPtr(y, x + 1)[0] - gray.ucharPtr(y, x - 1)[0]);
				edge += Math.abs(gray.ucharPtr(y + 1, x)[0] - gray.ucharPtr(y - 1, x)[0]);
			}

			count++;
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

function sampleGrayComparisonStats(
	gray: InstanceType<OpenCvModule['Mat']>,
	referenceGray: InstanceType<OpenCvModule['Mat']>,
	x0: number,
	y0: number,
	x1: number,
	y1: number
) {
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

	for (let y = y0; y < y1; y++) {
		for (let x = x0; x < x1; x++) {
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

			count++;
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

	const mean = sum / count;
	const referenceMean = referenceSum / count;
	const meanDelta = diffSum / count;

	return {
		current: {
			mean,
			std: Math.sqrt(Math.max(0, sumSq / count - mean * mean)),
			edge: edge / (count * 2)
		},
		reference: {
			mean: referenceMean,
			std: Math.sqrt(Math.max(0, referenceSumSq / count - referenceMean * referenceMean)),
			edge: referenceEdge / (count * 2)
		},
		meanDelta,
		diffStd: Math.sqrt(Math.max(0, diffSumSq / count - meanDelta * meanDelta)),
		absDiff: absDiff / count
	};
}

function sampleShiftAlignedDiff(
	gray: InstanceType<OpenCvModule['Mat']>,
	referenceGray: InstanceType<OpenCvModule['Mat']>,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	maxShift: number
) {
	let bestDiffStd = Number.POSITIVE_INFINITY;
	let bestAbsDiff = Number.POSITIVE_INFINITY;
	let bestScore = Number.POSITIVE_INFINITY;

	for (let shiftY = -maxShift; shiftY <= maxShift; shiftY++) {
		for (let shiftX = -maxShift; shiftX <= maxShift; shiftX++) {
			let diffSum = 0;
			let diffSumSq = 0;
			let absDiff = 0;
			let count = 0;

			for (let y = y0; y < y1; y++) {
				const referenceY = y + shiftY;
				if (referenceY < 0 || referenceY >= referenceGray.rows) continue;

				for (let x = x0; x < x1; x++) {
					const referenceX = x + shiftX;
					if (referenceX < 0 || referenceX >= referenceGray.cols) continue;

					const diff = gray.ucharPtr(y, x)[0] - referenceGray.ucharPtr(referenceY, referenceX)[0];
					diffSum += diff;
					diffSumSq += diff * diff;
					absDiff += Math.abs(diff);
					count++;
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

function sampleRgbMean(
	rgb: InstanceType<OpenCvModule['Mat']>,
	x0: number,
	y0: number,
	x1: number,
	y1: number
) {
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

function rgbDistance(a: number[], b: number[]) {
	return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function lineStrength(
	gray: InstanceType<OpenCvModule['Mat']>,
	isVertical: boolean,
	position: number,
	thickness = 2
) {
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

function getLatticeMetrics(
	cv: OpenCvModule,
	quad: ImagePoint[],
	selectedSquares: { center: ImagePoint }[]
) {
	const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flatMap((point) => [point.x, point.y]));
	const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 8, 0, 8, 8, 0, 8]);
	const transform = cv.getPerspectiveTransform(srcTri, dstTri);

	const matchedCells = new Map<string, number>();
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

function warpQuad(cv: OpenCvModule, mat: InstanceType<OpenCvModule['Mat']>, quad: ImagePoint[], size = WARP_SIZE) {
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

function getBoardAppearanceMetrics(
	cv: OpenCvModule,
	rgb: InstanceType<OpenCvModule['Mat']>,
	gray: InstanceType<OpenCvModule['Mat']>,
	quad: ImagePoint[]
) {
	const warpedRgb = warpQuad(cv, rgb, quad, WARP_SIZE);
	const warpedGray = warpQuad(cv, gray, quad, WARP_SIZE);
	const cellSize = WARP_SIZE / 8;

	const evenColors: number[][] = [];
	const oddColors: number[][] = [];
	const cellStdDeviations: number[] = [];

	for (let row = 0; row < 8; row++) {
		for (let col = 0; col < 8; col++) {
			const x0 = Math.floor(col * cellSize + cellSize * 0.2);
			const x1 = Math.floor((col + 1) * cellSize - cellSize * 0.2);
			const y0 = Math.floor(row * cellSize + cellSize * 0.2);
			const y1 = Math.floor((row + 1) * cellSize - cellSize * 0.2);

			const color = sampleRgbMean(warpedRgb, x0, y0, x1, y1);
			const grayStats = sampleGrayStats(warpedGray, x0, y0, x1, y1);

			if ((row + col) % 2 === 0) evenColors.push(color);
			else oddColors.push(color);

			cellStdDeviations.push(grayStats.std);
		}
	}

	const evenMean = [
		mean(evenColors.map((color) => color[0])),
		mean(evenColors.map((color) => color[1])),
		mean(evenColors.map((color) => color[2]))
	];
	const oddMean = [
		mean(oddColors.map((color) => color[0])),
		mean(oddColors.map((color) => color[1])),
		mean(oddColors.map((color) => color[2]))
	];

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

	const metrics = {
		colorSeparation: rgbDistance(evenMean, oddMean),
		classSpread:
			mean(evenColors.map((color) => rgbDistance(color, evenMean)))
			+ mean(oddColors.map((color) => rgbDistance(color, oddMean))),
		averageCellStd: mean(cellStdDeviations),
		lineDelta: internalLineStrength / 14 - midCellStrength / 16,
		borderStrength: (
			lineStrength(warpedGray, true, 2)
			+ lineStrength(warpedGray, true, WARP_SIZE - 3)
			+ lineStrength(warpedGray, false, 2)
			+ lineStrength(warpedGray, false, WARP_SIZE - 3)
		) / 4
	};

	warpedRgb.delete();
	warpedGray.delete();

	return metrics;
}

function getOutOfBoundsPenalty(quad: ImagePoint[], cols: number, rows: number) {
	let overflow = 0;
	for (const point of quad) {
		overflow += Math.max(0, -point.x);
		overflow += Math.max(0, -point.y);
		overflow += Math.max(0, point.x - cols);
		overflow += Math.max(0, point.y - rows);
	}
	return overflow / Math.max(cols, rows);
}

function evaluateBoardHypothesis(
	cv: OpenCvModule,
	rgb: InstanceType<OpenCvModule['Mat']>,
	gray: InstanceType<OpenCvModule['Mat']>,
	quad: ImagePoint[],
	selectedSquares: { center: ImagePoint }[],
	cols: number,
	rows: number
) {
	if (!isConvexQuad(quad)) {
		return { totalScore: Number.NEGATIVE_INFINITY };
	}

	const lattice = getLatticeMetrics(cv, quad, selectedSquares);
	const appearance = getBoardAppearanceMetrics(cv, rgb, gray, quad);
	const boundsPenalty = getOutOfBoundsPenalty(quad, cols, rows);

	return {
		totalScore:
			lattice.uniqueCells * 10
			+ lattice.insideCount * 2
			- lattice.meanResidual * 30
			+ appearance.colorSeparation * 0.5
			- appearance.classSpread * 0.3
			- appearance.averageCellStd * 0.35
			+ appearance.lineDelta * 8
			+ appearance.borderStrength * 0.25
			- boundsPenalty * 50
	};
}

function detectSquareCandidates(
	cv: OpenCvModule,
	gray: InstanceType<OpenCvModule['Mat']>,
	imageArea: number
) {
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

	const candidates: Array<{
		id: number;
		pts: ImagePoint[];
		center: ImagePoint;
		area: number;
		meanEdge: number;
		angle: number;
	}> = [];

	for (let i = 0; i < contours.size(); i++) {
		const contour = contours.get(i);
		const area = cv.contourArea(contour, false);

		if (area < imageArea * 0.0002 || area > imageArea * 0.03) continue;

		const polygon = new cv.Mat();
		cv.approxPolyDP(contour, polygon, 0.03 * cv.arcLength(contour, true), true);

		if (polygon.rows === 4 && cv.isContourConvex(polygon)) {
			const rawPoints: ImagePoint[] = [];
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
	edges.delete();
	dilated.delete();

	return candidates;
}

function selectBoardSquares(candidates: ReturnType<typeof detectSquareCandidates>) {
	if (candidates.length <= 4) return candidates;

	const medianArea = median(candidates.map((candidate) => candidate.area));
	const medianEdge = median(candidates.map((candidate) => candidate.meanEdge));
	const dominantAngle = median(candidates.map((candidate) => candidate.angle));

	const filtered = candidates.filter((candidate) => (
		candidate.area >= medianArea * 0.35
		&& candidate.area <= medianArea * 2.8
		&& candidate.meanEdge >= medianEdge * 0.6
		&& candidate.meanEdge <= medianEdge * 1.8
		&& angleDifferenceDegrees(candidate.angle, dominantAngle) <= 20
	));

	if (filtered.length <= 4) return filtered.length > 0 ? filtered : candidates;

	const neighborDistance = medianEdge * 3.2;
	const visited = new Set<number>();
	const components: typeof filtered[] = [];

	for (const candidate of filtered) {
		if (visited.has(candidate.id)) continue;

		const queue = [candidate];
		const component = [];
		visited.add(candidate.id);

		while (queue.length > 0) {
			const current = queue.shift()!;
			component.push(current);

			for (const neighbor of filtered) {
				if (visited.has(neighbor.id)) continue;
				if (distance(current.center, neighbor.center) > neighborDistance) continue;

				const areaRatio = Math.max(current.area, neighbor.area)
					/ Math.max(1, Math.min(current.area, neighbor.area));
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

function fitInitialBoardQuads(cv: OpenCvModule, selectedSquares: ReturnType<typeof selectBoardSquares>) {
	if (selectedSquares.length < 4) return [];

	const coordinates: number[] = [];
	for (const square of selectedSquares) {
		for (const point of square.pts) {
			coordinates.push(point.x, point.y);
		}
	}

	const pointsMat = cv.matFromArray(selectedSquares.length * 4, 1, cv.CV_32SC2, coordinates);
	const candidateQuads: ImagePoint[][] = [];

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

	const deduped: ImagePoint[][] = [];
	for (const quad of candidateQuads) {
		const duplicate = deduped.some((existing) => (
			existing.reduce((sum, point, index) => sum + distance(point, quad[index]), 0) < 20
		));
		if (!duplicate) deduped.push(quad);
	}

	return deduped;
}

function optimizeBoardQuad(
	cv: OpenCvModule,
	rgb: InstanceType<OpenCvModule['Mat']>,
	gray: InstanceType<OpenCvModule['Mat']>,
	selectedSquares: ReturnType<typeof selectBoardSquares>,
	initialQuad: ImagePoint[],
	cols: number,
	rows: number
) {
	let bestQuad = initialQuad.map((point) => ({ x: point.x, y: point.y }));
	let bestMetrics = evaluateBoardHypothesis(cv, rgb, gray, bestQuad, selectedSquares, cols, rows);

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
						const metrics = evaluateBoardHypothesis(
							cv,
							rgb,
							gray,
							orderedQuad,
							selectedSquares,
							cols,
							rows
						);

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

	return { quad: bestQuad, score: bestMetrics.totalScore };
}

export function denormalizeQuad(
	normalizedQuad: BoardCalibration['normalizedQuad'],
	width: number,
	height: number
): [ImagePoint, ImagePoint, ImagePoint, ImagePoint] {
	return normalizedQuad.map((point) => ({
		x: point.x * width,
		y: point.y * height
	})) as [ImagePoint, ImagePoint, ImagePoint, ImagePoint];
}

export function normalizeQuad(
	quad: ImagePoint[],
	width: number,
	height: number
): [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint] {
	return quad.map((point) => ({
		x: clamp(point.x / width, 0, 1),
		y: clamp(point.y / height, 0, 1)
	})) as [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint];
}

export function boardPointToImage(
	cv: OpenCvModule,
	quad: ImagePoint[],
	boardX: number,
	boardY: number
) {
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

export function localizeChessboardFromImageData(cv: OpenCvModule, imageData: ImageData) {
	const src = matFromImageData(cv, imageData);
	const rgb = new cv.Mat();
	cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB, 0);
	const gray = new cv.Mat();
	cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

	const candidates = detectSquareCandidates(cv, gray, src.rows * src.cols);
	const selectedSquares = selectBoardSquares(candidates);
	const initialQuads = fitInitialBoardQuads(cv, selectedSquares);

	let bestDetection: { quad: ImagePoint[]; score: number } | null = null;
	for (const quad of initialQuads) {
		const detection = optimizeBoardQuad(cv, rgb, gray, selectedSquares, quad, src.cols, src.rows);
		if (!bestDetection || detection.score > bestDetection.score) {
			bestDetection = detection;
		}
	}

	src.delete();
	rgb.delete();
	gray.delete();

	return bestDetection
		? {
			quad: bestDetection.quad as [ImagePoint, ImagePoint, ImagePoint, ImagePoint],
			score: bestDetection.score,
			candidateCount: candidates.length,
			selectedCount: selectedSquares.length
		}
		: null;
}

export function localizeChessboardFromImageDataFast(cv: OpenCvModule, imageData: ImageData) {
	const src = matFromImageData(cv, imageData);
	const gray = new cv.Mat();
	cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

	const candidates = detectSquareCandidates(cv, gray, src.rows * src.cols);
	const selectedSquares = selectBoardSquares(candidates);
	const initialQuads = fitInitialBoardQuads(cv, selectedSquares);

	let bestDetection: { quad: ImagePoint[]; score: number } | null = null;
	for (const quad of initialQuads) {
		if (!isConvexQuad(quad)) continue;
		const area = quadArea(quad);
		const center = meanPoint(quad);
		const centerDistance = Math.hypot(center.x - src.cols / 2, center.y - src.rows / 2);
		const score = area - centerDistance * 0.35;

		if (!bestDetection || score > bestDetection.score) {
			bestDetection = {
				quad,
				score
			};
		}
	}

	src.delete();
	gray.delete();

	return bestDetection
		? {
			quad: bestDetection.quad as [ImagePoint, ImagePoint, ImagePoint, ImagePoint],
			score: bestDetection.score,
			candidateCount: candidates.length,
			selectedCount: selectedSquares.length
		}
		: null;
}

export function localizeChessboardFromImageDataByCorners(
	cv: OpenCvModule,
	imageData: ImageData,
	onProgress?: (stage: string) => void
) {
	onProgress?.('Preparing frame for corner detection.');
	const src = matFromImageData(cv, imageData);
	const gray = new cv.Mat();
	cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

	const corners = new cv.Mat();
	const patternSize = new cv.Size(7, 7);
	const equalized = new cv.Mat();
	onProgress?.('Equalizing grayscale image.');
	cv.equalizeHist(gray, equalized);

	const cornerAttempts: InstanceType<OpenCvModule['Mat']>[] = [gray, equalized];
	const standardFlags = cv.CALIB_CB_ADAPTIVE_THRESH + cv.CALIB_CB_NORMALIZE_IMAGE;

	let found = false;
	for (const source of cornerAttempts) {
		onProgress?.('Searching for chessboard corners.');
		if (typeof cv.findChessboardCorners === 'function') {
			found = cv.findChessboardCorners(source, patternSize, corners, standardFlags);
		}

		if (found) break;
	}

	if (found && typeof cv.cornerSubPix === 'function') {
		onProgress?.('Refining corner positions.');
		cv.cornerSubPix(
			gray,
			corners,
			new cv.Size(5, 5),
			new cv.Size(-1, -1),
			new cv.TermCriteria(cv.TermCriteria_EPS + cv.TermCriteria_MAX_ITER, 30, 0.1)
		);
	}

	let detection: {
		quad: [ImagePoint, ImagePoint, ImagePoint, ImagePoint];
		score: number;
		candidateCount: number;
		selectedCount: number;
	} | null = null;

	if (found && corners.rows >= 49) {
		onProgress?.('Projecting the outer board quad.');
		const points: ImagePoint[] = [];
		for (let index = 0; index < corners.rows; index++) {
			points.push({
				x: corners.data32F[index * 2],
				y: corners.data32F[index * 2 + 1]
			});
		}

		const at = (row: number, col: number) => points[row * 7 + col];
		const extrapolate = (anchor: ImagePoint, horizontal: ImagePoint, vertical: ImagePoint) => ({
			x: anchor.x - horizontal.x * 0.5 - vertical.x * 0.5,
			y: anchor.y - horizontal.y * 0.5 - vertical.y * 0.5
		});

		const topLeft = extrapolate(
			at(0, 0),
			{ x: at(0, 1).x - at(0, 0).x, y: at(0, 1).y - at(0, 0).y },
			{ x: at(1, 0).x - at(0, 0).x, y: at(1, 0).y - at(0, 0).y }
		);
		const topRight = extrapolate(
			at(0, 6),
			{ x: at(0, 5).x - at(0, 6).x, y: at(0, 5).y - at(0, 6).y },
			{ x: at(1, 6).x - at(0, 6).x, y: at(1, 6).y - at(0, 6).y }
		);
		const bottomRight = extrapolate(
			at(6, 6),
			{ x: at(6, 5).x - at(6, 6).x, y: at(6, 5).y - at(6, 6).y },
			{ x: at(5, 6).x - at(6, 6).x, y: at(5, 6).y - at(6, 6).y }
		);
		const bottomLeft = extrapolate(
			at(6, 0),
			{ x: at(6, 1).x - at(6, 0).x, y: at(6, 1).y - at(6, 0).y },
			{ x: at(5, 0).x - at(6, 0).x, y: at(5, 0).y - at(6, 0).y }
		);

		const orderedQuad = orderQuadPoints([topLeft, topRight, bottomRight, bottomLeft]) as [
			ImagePoint,
			ImagePoint,
			ImagePoint,
			ImagePoint
		];
		detection = {
			quad: orderedQuad,
			score: quadArea(orderedQuad),
			candidateCount: 49,
			selectedCount: 49
		};
	}

	corners.delete();
	equalized.delete();
	gray.delete();
	src.delete();

	return detection;
}

function clampQuadPoint(point: ImagePoint, cols: number, rows: number) {
	return {
		x: clamp(point.x, -cols * 0.12, cols * 1.12),
		y: clamp(point.y, -rows * 0.12, rows * 1.12)
	};
}

function scoreBoardAppearanceHypothesis(
	cv: OpenCvModule,
	rgb: InstanceType<OpenCvModule['Mat']>,
	gray: InstanceType<OpenCvModule['Mat']>,
	quad: ImagePoint[],
	cols: number,
	rows: number
) {
	if (!isConvexQuad(quad)) {
		return Number.NEGATIVE_INFINITY;
	}

	const appearance = getBoardAppearanceMetrics(cv, rgb, gray, quad);
	const area = quadArea(quad);
	const center = meanPoint(quad);
	const centerDistance = Math.hypot(center.x - cols / 2, center.y - rows / 2);
	const boundsPenalty = getOutOfBoundsPenalty(quad, cols, rows);

	return (
		appearance.colorSeparation * 0.9
		- appearance.classSpread * 0.45
		- appearance.averageCellStd * 0.55
		+ appearance.lineDelta * 11
		+ appearance.borderStrength * 0.28
		+ Math.sqrt(Math.max(0, area)) * 0.6
		- centerDistance * 0.18
		- boundsPenalty * 95
	);
}

function generateSearchSeedQuads(cols: number, rows: number) {
	const centerX = cols / 2;
	const centerY = rows / 2;
	const base = Math.min(cols, rows);
	const candidateQuads: ImagePoint[][] = [];
	const heightScales = [0.34, 0.44, 0.54];
	const widthScales = [0.36, 0.48, 0.6];
	const topRatios = [0.62, 0.76, 0.9];
	const centerYOffsets = [-0.06, 0, 0.06];
	const shearRatios = [-0.08, 0, 0.08];

	for (const widthScale of widthScales) {
		for (const heightScale of heightScales) {
			for (const topRatio of topRatios) {
				for (const centerYOffset of centerYOffsets) {
					for (const shearRatio of shearRatios) {
						const halfBottomWidth = base * widthScale / 2;
						const halfTopWidth = halfBottomWidth * topRatio;
						const halfHeight = base * heightScale / 2;
						const cy = centerY + rows * centerYOffset;
						const shear = halfBottomWidth * shearRatio;
						candidateQuads.push([
							{ x: centerX - halfTopWidth + shear, y: cy - halfHeight },
							{ x: centerX + halfTopWidth + shear, y: cy - halfHeight },
							{ x: centerX + halfBottomWidth - shear, y: cy + halfHeight },
							{ x: centerX - halfBottomWidth - shear, y: cy + halfHeight }
						]);
					}
				}
			}
		}
	}

	return candidateQuads;
}

function optimizeBoardByAppearance(
	cv: OpenCvModule,
	rgb: InstanceType<OpenCvModule['Mat']>,
	gray: InstanceType<OpenCvModule['Mat']>,
	initialQuad: ImagePoint[],
	cols: number,
	rows: number
) {
	let bestQuad = initialQuad.map((point) => ({ ...point }));
	let bestScore = scoreBoardAppearanceHypothesis(cv, rgb, gray, bestQuad, cols, rows);
	const stepSizes = [42, 24, 12, 6, 3];

	for (const step of stepSizes) {
		let improved = true;
		while (improved) {
			improved = false;

			const candidateTransforms: ImagePoint[][] = [];
			for (let index = 0; index < 4; index++) {
				for (const dx of [-step, 0, step]) {
					for (const dy of [-step, 0, step]) {
						if (dx === 0 && dy === 0) continue;
						const nextQuad = bestQuad.map((point) => ({ ...point }));
						nextQuad[index] = clampQuadPoint(
							{ x: nextQuad[index].x + dx, y: nextQuad[index].y + dy },
							cols,
							rows
						);
						candidateTransforms.push(nextQuad);
					}
				}
			}

			const topEdgeUp = bestQuad.map((point) => ({ ...point }));
			topEdgeUp[0] = clampQuadPoint({ x: topEdgeUp[0].x, y: topEdgeUp[0].y - step }, cols, rows);
			topEdgeUp[1] = clampQuadPoint({ x: topEdgeUp[1].x, y: topEdgeUp[1].y - step }, cols, rows);
			candidateTransforms.push(topEdgeUp);

			const topEdgeDown = bestQuad.map((point) => ({ ...point }));
			topEdgeDown[0] = clampQuadPoint({ x: topEdgeDown[0].x, y: topEdgeDown[0].y + step }, cols, rows);
			topEdgeDown[1] = clampQuadPoint({ x: topEdgeDown[1].x, y: topEdgeDown[1].y + step }, cols, rows);
			candidateTransforms.push(topEdgeDown);

			const bottomEdgeUp = bestQuad.map((point) => ({ ...point }));
			bottomEdgeUp[2] = clampQuadPoint({ x: bottomEdgeUp[2].x, y: bottomEdgeUp[2].y - step }, cols, rows);
			bottomEdgeUp[3] = clampQuadPoint({ x: bottomEdgeUp[3].x, y: bottomEdgeUp[3].y - step }, cols, rows);
			candidateTransforms.push(bottomEdgeUp);

			const bottomEdgeDown = bestQuad.map((point) => ({ ...point }));
			bottomEdgeDown[2] = clampQuadPoint({ x: bottomEdgeDown[2].x, y: bottomEdgeDown[2].y + step }, cols, rows);
			bottomEdgeDown[3] = clampQuadPoint({ x: bottomEdgeDown[3].x, y: bottomEdgeDown[3].y + step }, cols, rows);
			candidateTransforms.push(bottomEdgeDown);

			const leftEdgeLeft = bestQuad.map((point) => ({ ...point }));
			leftEdgeLeft[0] = clampQuadPoint({ x: leftEdgeLeft[0].x - step, y: leftEdgeLeft[0].y }, cols, rows);
			leftEdgeLeft[3] = clampQuadPoint({ x: leftEdgeLeft[3].x - step, y: leftEdgeLeft[3].y }, cols, rows);
			candidateTransforms.push(leftEdgeLeft);

			const leftEdgeRight = bestQuad.map((point) => ({ ...point }));
			leftEdgeRight[0] = clampQuadPoint({ x: leftEdgeRight[0].x + step, y: leftEdgeRight[0].y }, cols, rows);
			leftEdgeRight[3] = clampQuadPoint({ x: leftEdgeRight[3].x + step, y: leftEdgeRight[3].y }, cols, rows);
			candidateTransforms.push(leftEdgeRight);

			const rightEdgeLeft = bestQuad.map((point) => ({ ...point }));
			rightEdgeLeft[1] = clampQuadPoint({ x: rightEdgeLeft[1].x - step, y: rightEdgeLeft[1].y }, cols, rows);
			rightEdgeLeft[2] = clampQuadPoint({ x: rightEdgeLeft[2].x - step, y: rightEdgeLeft[2].y }, cols, rows);
			candidateTransforms.push(rightEdgeLeft);

			const rightEdgeRight = bestQuad.map((point) => ({ ...point }));
			rightEdgeRight[1] = clampQuadPoint({ x: rightEdgeRight[1].x + step, y: rightEdgeRight[1].y }, cols, rows);
			rightEdgeRight[2] = clampQuadPoint({ x: rightEdgeRight[2].x + step, y: rightEdgeRight[2].y }, cols, rows);
			candidateTransforms.push(rightEdgeRight);

			for (const candidateQuad of candidateTransforms) {
				const score = scoreBoardAppearanceHypothesis(cv, rgb, gray, candidateQuad, cols, rows);
				if (score > bestScore) {
					bestQuad = candidateQuad;
					bestScore = score;
					improved = true;
				}
			}
		}
	}

	return {
		quad: bestQuad as [ImagePoint, ImagePoint, ImagePoint, ImagePoint],
		score: bestScore
	};
}

export function localizeChessboardFromImageDataByWarpSearch(
	cv: OpenCvModule,
	imageData: ImageData
) {
	const src = matFromImageData(cv, imageData);
	const rgb = new cv.Mat();
	const gray = new cv.Mat();
	cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB, 0);
	cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

	let bestDetection: {
		quad: [ImagePoint, ImagePoint, ImagePoint, ImagePoint];
		score: number;
	} | null = null;

	for (const seed of generateSearchSeedQuads(src.cols, src.rows)) {
		const detection = optimizeBoardByAppearance(cv, rgb, gray, seed, src.cols, src.rows);
		if (!bestDetection || detection.score > bestDetection.score) {
			bestDetection = detection;
		}
	}

	src.delete();
	rgb.delete();
	gray.delete();

	return bestDetection
		? {
			quad: bestDetection.quad,
			score: bestDetection.score,
			candidateCount: 0,
			selectedCount: 0
		}
		: null;
}

type RgbaFrame = {
	width: number;
	height: number;
	data: Uint8ClampedArray | Uint8Array;
};

function createGrayBuffer(frame: RgbaFrame) {
	const gray = new Float32Array(frame.width * frame.height);
	for (let index = 0; index < gray.length; index++) {
		const offset = index * 4;
		gray[index] = (
			frame.data[offset] * 0.299
			+ frame.data[offset + 1] * 0.587
			+ frame.data[offset + 2] * 0.114
		);
	}
	return gray;
}

function solvePerspectiveFromQuad(quad: ImagePoint[]) {
	const matrix: number[][] = [];
	const values: number[] = [];
	const boardPoints = [
		[0, 0],
		[1, 0],
		[1, 1],
		[0, 1]
	] as const;

	for (let index = 0; index < 4; index++) {
		const [u, v] = boardPoints[index];
		const { x, y } = quad[index];
		matrix.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
		values.push(x);
		matrix.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
		values.push(y);
	}

	for (let pivot = 0; pivot < 8; pivot++) {
		let pivotRow = pivot;
		for (let row = pivot + 1; row < 8; row++) {
			if (Math.abs(matrix[row][pivot]) > Math.abs(matrix[pivotRow][pivot])) {
				pivotRow = row;
			}
		}

		if (Math.abs(matrix[pivotRow][pivot]) < 1e-8) {
			return null;
		}

		[matrix[pivot], matrix[pivotRow]] = [matrix[pivotRow], matrix[pivot]];
		[values[pivot], values[pivotRow]] = [values[pivotRow], values[pivot]];

		const divisor = matrix[pivot][pivot];
		for (let column = pivot; column < 8; column++) {
			matrix[pivot][column] /= divisor;
		}
		values[pivot] /= divisor;

		for (let row = 0; row < 8; row++) {
			if (row === pivot) continue;
			const factor = matrix[row][pivot];
			if (factor === 0) continue;
			for (let column = pivot; column < 8; column++) {
				matrix[row][column] -= factor * matrix[pivot][column];
			}
			values[row] -= factor * values[pivot];
		}
	}

	return {
		a: values[0],
		b: values[1],
		c: values[2],
		d: values[3],
		e: values[4],
		f: values[5],
		g: values[6],
		h: values[7]
	};
}

function mapBoardPointToImage(
	transform: ReturnType<typeof solvePerspectiveFromQuad>,
	u: number,
	v: number
) {
	if (!transform) return null;
	const denominator = transform.g * u + transform.h * v + 1;
	if (Math.abs(denominator) < 1e-8) return null;
	return {
		x: (transform.a * u + transform.b * v + transform.c) / denominator,
		y: (transform.d * u + transform.e * v + transform.f) / denominator
	};
}

function sampleGrayBilinear(gray: Float32Array, width: number, height: number, x: number, y: number) {
	if (x < 0 || y < 0 || x > width - 1 || y > height - 1) {
		return null;
	}

	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const x1 = Math.min(width - 1, x0 + 1);
	const y1 = Math.min(height - 1, y0 + 1);
	const dx = x - x0;
	const dy = y - y0;

	const top = gray[y0 * width + x0] * (1 - dx) + gray[y0 * width + x1] * dx;
	const bottom = gray[y1 * width + x0] * (1 - dx) + gray[y1 * width + x1] * dx;
	return top * (1 - dy) + bottom * dy;
}

function scoreBoardAppearanceFromGray(
	gray: Float32Array,
	width: number,
	height: number,
	quad: ImagePoint[]
) {
	if (!isConvexQuad(quad)) {
		return Number.NEGATIVE_INFINITY;
	}

	const transform = solvePerspectiveFromQuad(quad);
	if (!transform) {
		return Number.NEGATIVE_INFINITY;
	}

	const evenMeans: number[] = [];
	const oddMeans: number[] = [];
	const cellStdDeviations: number[] = [];
	let outOfBoundsSamples = 0;

	for (let row = 0; row < 8; row++) {
		for (let col = 0; col < 8; col++) {
			const samples: number[] = [];
			for (const dv of [0.28, 0.5, 0.72]) {
				for (const du of [0.28, 0.5, 0.72]) {
					const mapped = mapBoardPointToImage(transform, (col + du) / 8, (row + dv) / 8);
					if (!mapped) {
						outOfBoundsSamples++;
						continue;
					}

					const sample = sampleGrayBilinear(gray, width, height, mapped.x, mapped.y);
					if (sample === null) {
						outOfBoundsSamples++;
						continue;
					}
					samples.push(sample);
				}
			}

			if (samples.length === 0) {
				return Number.NEGATIVE_INFINITY;
			}

			const average = mean(samples);
			const variance = mean(samples.map((value) => (value - average) ** 2));
			cellStdDeviations.push(Math.sqrt(variance));

			if ((row + col) % 2 === 0) evenMeans.push(average);
			else oddMeans.push(average);
		}
	}

	let gridContrast = 0;
	let midCellContrast = 0;
	let gridContrastCount = 0;
	let midCellContrastCount = 0;

	for (let row = 0; row < 8; row++) {
		for (let boundary = 1; boundary < 8; boundary++) {
			for (const dv of [0.25, 0.5, 0.75]) {
				const left = mapBoardPointToImage(transform, (boundary - 0.08) / 8, (row + dv) / 8);
				const right = mapBoardPointToImage(transform, (boundary + 0.08) / 8, (row + dv) / 8);
				if (!left || !right) continue;
				const leftSample = sampleGrayBilinear(gray, width, height, left.x, left.y);
				const rightSample = sampleGrayBilinear(gray, width, height, right.x, right.y);
				if (leftSample === null || rightSample === null) continue;
				gridContrast += Math.abs(leftSample - rightSample);
				gridContrastCount++;
			}
		}

		for (let mid = 0; mid < 8; mid++) {
			for (const dv of [0.25, 0.5, 0.75]) {
				const left = mapBoardPointToImage(transform, (mid + 0.42) / 8, (row + dv) / 8);
				const right = mapBoardPointToImage(transform, (mid + 0.58) / 8, (row + dv) / 8);
				if (!left || !right) continue;
				const leftSample = sampleGrayBilinear(gray, width, height, left.x, left.y);
				const rightSample = sampleGrayBilinear(gray, width, height, right.x, right.y);
				if (leftSample === null || rightSample === null) continue;
				midCellContrast += Math.abs(leftSample - rightSample);
				midCellContrastCount++;
			}
		}
	}

	const evenMean = mean(evenMeans);
	const oddMean = mean(oddMeans);
	const classSpread = mean(evenMeans.map((value) => Math.abs(value - evenMean)))
		+ mean(oddMeans.map((value) => Math.abs(value - oddMean)));
	const area = quadArea(quad);
	const center = meanPoint(quad);
	const centerDistance = Math.hypot(center.x - width / 2, center.y - height / 2);
	const boundsPenalty = getOutOfBoundsPenalty(quad, width, height) + outOfBoundsSamples / 120;

	return (
		Math.abs(evenMean - oddMean) * 1.8
		- classSpread * 0.9
		- mean(cellStdDeviations) * 1.1
		+ (gridContrastCount > 0 ? gridContrast / gridContrastCount : 0) * 1.4
		- (midCellContrastCount > 0 ? midCellContrast / midCellContrastCount : 0) * 0.9
		+ Math.sqrt(Math.max(0, area)) * 0.35
		- centerDistance * 0.16
		- boundsPenalty * 120
	);
}

function optimizeBoardByGraySearch(
	gray: Float32Array,
	width: number,
	height: number,
	initialQuad: ImagePoint[]
) {
	let bestQuad = initialQuad.map((point) => ({ ...point }));
	let bestScore = scoreBoardAppearanceFromGray(gray, width, height, bestQuad);
	const stepSizes = [36, 18, 9, 4, 2];

	for (const step of stepSizes) {
		let improved = true;
		while (improved) {
			improved = false;
			const candidateTransforms: ImagePoint[][] = [];

			for (let index = 0; index < 4; index++) {
				for (const dx of [-step, 0, step]) {
					for (const dy of [-step, 0, step]) {
						if (dx === 0 && dy === 0) continue;
						const nextQuad = bestQuad.map((point) => ({ ...point }));
						nextQuad[index] = clampQuadPoint(
							{ x: nextQuad[index].x + dx, y: nextQuad[index].y + dy },
							width,
							height
						);
						candidateTransforms.push(nextQuad);
					}
				}
			}

			for (const candidateQuad of candidateTransforms) {
				const score = scoreBoardAppearanceFromGray(gray, width, height, candidateQuad);
				if (score > bestScore) {
					bestQuad = candidateQuad;
					bestScore = score;
					improved = true;
				}
			}
		}
	}

	return {
		quad: bestQuad as [ImagePoint, ImagePoint, ImagePoint, ImagePoint],
		score: bestScore
	};
}

export function localizeChessboardFromImageDataByGridSearch(frame: RgbaFrame) {
	const gray = createGrayBuffer(frame);
	const seeds = generateSearchSeedQuads(frame.width, frame.height)
		.map((quad) => ({
			quad,
			score: scoreBoardAppearanceFromGray(gray, frame.width, frame.height, quad)
		}))
		.sort((a, b) => b.score - a.score)
		.slice(0, 6);

	let bestDetection: {
		quad: [ImagePoint, ImagePoint, ImagePoint, ImagePoint];
		score: number;
	} | null = null;

	for (const seed of seeds) {
		const detection = optimizeBoardByGraySearch(gray, frame.width, frame.height, seed.quad);
		if (!bestDetection || detection.score > bestDetection.score) {
			bestDetection = detection;
		}
	}

	return bestDetection
		? {
			quad: bestDetection.quad,
			score: bestDetection.score,
			candidateCount: seeds.length,
			selectedCount: seeds.length
		}
		: null;
}

function scoreOccupancyCell(
	gray: InstanceType<OpenCvModule['Mat']>,
	referenceGray: InstanceType<OpenCvModule['Mat']> | null,
	row: number,
	col: number
) {
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

	const current = sampleGrayStats(gray, x0, y0, x1, y1);
	if (!referenceGray) {
		return current.std * 1.15 + current.edge * 0.85;
	}

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

function scoreTextureOccupancyCell(
	gray: InstanceType<OpenCvModule['Mat']>,
	row: number,
	col: number
) {
	const cellSize = gray.cols / 8;
	const inset = cellSize * 0.15;
	const x0 = Math.floor(col * cellSize + inset);
	const x1 = Math.floor((col + 1) * cellSize - inset);
	const y0 = Math.floor(row * cellSize + inset);
	const y1 = Math.floor((row + 1) * cellSize - inset);
	const current = sampleGrayStats(gray, x0, y0, x1, y1);
	return current.std + current.edge * 0.5;
}

function inferOccupiedIndices(scores: number[]) {
	const sorted = scores
		.map((score, index) => ({ score, index }))
		.sort((a, b) => b.score - a.score);

	const scoreMedian = median(scores);
	const scoreMad = median(scores.map((score) => Math.abs(score - scoreMedian)));
	const average = mean(scores);
	const variance = mean(scores.map((score) => (score - average) ** 2));
	const absoluteThreshold = Math.max(
		12,
		scoreMedian + Math.max(2.25, scoreMad) * 2.1,
		average + Math.sqrt(variance) * 0.45
	);
	const aboveThreshold = sorted.filter((entry) => entry.score >= absoluteThreshold);

	if (aboveThreshold.length === 0) return [];

	let inferredCount = Math.min(aboveThreshold.length, 32);
	let bestGap = 0;

	for (let i = 0; i < Math.min(39, sorted.length - 1); i++) {
		if (sorted[i].score < absoluteThreshold) break;
		const gap = sorted[i].score - sorted[i + 1].score;
		if (gap > bestGap) {
			bestGap = gap;
			inferredCount = i + 1;
		}
	}

	if (bestGap < 1.25) {
		inferredCount = Math.min(aboveThreshold.length, 32);
	}

	// When the board transitions from an empty captured reference to the initial setup,
	// the top 32 cells separate sharply from the rest even though the absolute threshold
	// above may only classify a few extreme outliers as occupied.
	if (
		inferredCount <= 4
		&& sorted.length >= 33
		&& sorted[31].score >= 20
		&& sorted[31].score >= sorted[32].score * 1.75
	) {
		return sorted.slice(0, 32).map((entry) => entry.index);
	}

	return sorted.slice(0, Math.min(inferredCount, 32)).map((entry) => entry.index);
}

export function classifyOccupiedIndicesFromReference(referenceScores: number[], textureScores: number[]) {
	return referenceScores
		.map((referenceScore, index) => ({
			index,
			referenceScore,
			textureScore: textureScores[index] ?? 0
		}))
		.filter(({ referenceScore, textureScore }) =>
			referenceScore >= 22 || (referenceScore >= 16 && textureScore >= 10)
		)
		.map(({ index }) => index);
}

export function boardLooksEmpty(referenceScores: number[]) {
	if (referenceScores.length === 0) return true;
	const average = mean(referenceScores);
	const peak = Math.max(...referenceScores);
	return average < 14 && peak < 38;
}

export function analyzeBoardFrame(
	cv: OpenCvModule,
	frameImageData: ImageData,
	normalizedQuad: BoardCalibration['normalizedQuad'],
	referenceImageData: ImageData | null
) {
	const frameMat = matFromImageData(cv, frameImageData);
	const frameGray = new cv.Mat();
	cv.cvtColor(frameMat, frameGray, cv.COLOR_RGBA2GRAY, 0);

	const quad = denormalizeQuad(normalizedQuad, frameImageData.width, frameImageData.height);
	const warpedBoard = warpQuad(cv, frameMat, quad, WARP_SIZE);
	const warpedGray = warpQuad(cv, frameGray, quad, WARP_SIZE);

	let referenceWarpGray: InstanceType<OpenCvModule['Mat']> | null = null;
	if (referenceImageData) {
		const referenceMat = matFromImageData(cv, referenceImageData);
		const referenceGray = new cv.Mat();
		cv.cvtColor(referenceMat, referenceGray, cv.COLOR_RGBA2GRAY, 0);
		const referenceQuad = denormalizeQuad(
			normalizedQuad,
			referenceImageData.width,
			referenceImageData.height
		);
		referenceWarpGray = warpQuad(cv, referenceGray, referenceQuad, WARP_SIZE);
		referenceMat.delete();
		referenceGray.delete();
	}

	const scores: number[] = [];
	const referenceScores: number[] = [];
	for (let row = 0; row < 8; row++) {
		for (let col = 0; col < 8; col++) {
			scores.push(scoreTextureOccupancyCell(warpedGray, row, col));
			if (referenceWarpGray) {
				referenceScores.push(scoreOccupancyCell(warpedGray, referenceWarpGray, row, col));
			}
		}
	}

	const occupiedIndices = referenceWarpGray
		? (boardLooksEmpty(referenceScores) ? [] : classifyOccupiedIndicesFromReference(referenceScores, scores))
		: inferOccupiedIndices(scores);
	const boardImageData = imageDataFromMat(warpedBoard);

	frameMat.delete();
	frameGray.delete();
	warpedBoard.delete();
	warpedGray.delete();
	referenceWarpGray?.delete();

	return {
		boardImageData,
		occupiedIndices,
		scores,
		referenceScores
	};
}
