import type { BoardCalibration, NormalizedPoint } from '$lib/board-calibration';

export const WARP_SIZE = 192;

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

function scoreOccupancyCell(
	gray: InstanceType<OpenCvModule['Mat']>,
	referenceGray: InstanceType<OpenCvModule['Mat']> | null,
	row: number,
	col: number
) {
	const cellSize = gray.cols / 8;
	const x0 = Math.floor(col * cellSize + cellSize * 0.15);
	const x1 = Math.floor((col + 1) * cellSize - cellSize * 0.15);
	const y0 = Math.floor(row * cellSize + cellSize * 0.15);
	const y1 = Math.floor((row + 1) * cellSize - cellSize * 0.15);

	const current = sampleGrayStats(gray, x0, y0, x1, y1);
	const reference = referenceGray
		? sampleGrayStats(referenceGray, x0, y0, x1, y1)
		: { mean: current.mean, std: 0, edge: 0 };

	return current.std * 0.8 + current.edge * 0.55 + Math.abs(current.mean - reference.mean) * 1.15;
}

function inferOccupiedIndices(scores: number[]) {
	const sorted = scores
		.map((score, index) => ({ score, index }))
		.sort((a, b) => b.score - a.score);

	const average = mean(scores);
	const variance = mean(scores.map((score) => (score - average) ** 2));
	const absoluteThreshold = Math.max(10, average + Math.sqrt(variance) * 0.85);
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

	return sorted.slice(0, Math.min(inferredCount, 32)).map((entry) => entry.index);
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
	for (let row = 0; row < 8; row++) {
		for (let col = 0; col < 8; col++) {
			scores.push(scoreOccupancyCell(warpedGray, referenceWarpGray, row, col));
		}
	}

	const occupiedIndices = inferOccupiedIndices(scores);
	const boardImageData = imageDataFromMat(warpedBoard);

	frameMat.delete();
	frameGray.delete();
	warpedBoard.delete();
	warpedGray.delete();
	referenceWarpGray?.delete();

	return {
		boardImageData,
		occupiedIndices,
		scores
	};
}
