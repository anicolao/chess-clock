import type { ImagePoint } from '$lib/vision/chessboard';

function clamp(value: number, min: number, max: number) {
	return Math.max(min, Math.min(max, value));
}

function mean(values: number[]) {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: number[], average: number) {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
}

function toLumaArray(imageData: ImageData) {
	const { data, width, height } = imageData;
	const luma = new Float32Array(width * height);

	for (let offset = 0, index = 0; offset < data.length; offset += 4, index += 1) {
		luma[index] = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
	}

	return luma;
}

function sampleCellMean(
	luma: Float32Array,
	width: number,
	height: number,
	x0: number,
	y0: number,
	x1: number,
	y1: number
) {
	let sum = 0;
	let count = 0;

	const startX = clamp(Math.floor(x0), 0, width - 1);
	const endX = clamp(Math.ceil(x1), startX + 1, width);
	const startY = clamp(Math.floor(y0), 0, height - 1);
	const endY = clamp(Math.ceil(y1), startY + 1, height);

	for (let y = startY; y < endY; y += 1) {
		const rowOffset = y * width;
		for (let x = startX; x < endX; x += 1) {
			sum += luma[rowOffset + x];
			count += 1;
		}
	}

	return count === 0 ? 0 : sum / count;
}

function scoreCheckerboardRegion(
	luma: Float32Array,
	width: number,
	height: number,
	x: number,
	y: number,
	boardWidth: number,
	boardHeight: number
) {
	const cellMeans: number[] = [];
	const evenMeans: number[] = [];
	const oddMeans: number[] = [];
	const rowContrast: number[] = [];
	const colContrast: number[] = [];

	const cellWidth = boardWidth / 8;
	const cellHeight = boardHeight / 8;

	for (let row = 0; row < 8; row += 1) {
		for (let col = 0; col < 8; col += 1) {
			const insetX = cellWidth * 0.18;
			const insetY = cellHeight * 0.18;
			const x0 = x + col * cellWidth + insetX;
			const x1 = x + (col + 1) * cellWidth - insetX;
			const y0 = y + row * cellHeight + insetY;
			const y1 = y + (row + 1) * cellHeight - insetY;
			const cellMean = sampleCellMean(luma, width, height, x0, y0, x1, y1);
			cellMeans.push(cellMean);

			if ((row + col) % 2 === 0) evenMeans.push(cellMean);
			else oddMeans.push(cellMean);
		}
	}

	for (let row = 0; row < 8; row += 1) {
		for (let col = 0; col < 7; col += 1) {
			const left = cellMeans[row * 8 + col];
			const right = cellMeans[row * 8 + col + 1];
			rowContrast.push(Math.abs(left - right));
		}
	}

	for (let row = 0; row < 7; row += 1) {
		for (let col = 0; col < 8; col += 1) {
			const top = cellMeans[row * 8 + col];
			const bottom = cellMeans[(row + 1) * 8 + col];
			colContrast.push(Math.abs(top - bottom));
		}
	}

	const evenMean = mean(evenMeans);
	const oddMean = mean(oddMeans);
	const classContrast = Math.abs(evenMean - oddMean);
	const internalContrast = mean(rowContrast) + mean(colContrast);
	const classVariance = variance(evenMeans, evenMean) + variance(oddMeans, oddMean);
	const aspectPenalty = Math.abs(boardWidth - boardHeight);

	return classContrast * 3 + internalContrast * 0.85 - classVariance * 0.09 - aspectPenalty * 0.04;
}

export function estimateCheckerboardQuad(imageData: ImageData): [ImagePoint, ImagePoint, ImagePoint, ImagePoint] | null {
	const { width, height } = imageData;
	const luma = toLumaArray(imageData);
	const minBoardSize = Math.round(Math.min(width, height) * 0.32);
	const maxBoardWidth = Math.round(width * 0.82);
	const maxBoardHeight = Math.round(height * 0.82);

	let best:
		| {
			score: number;
			x: number;
			y: number;
			boardWidth: number;
			boardHeight: number;
		}
		| null = null;

	for (let boardHeight = minBoardSize; boardHeight <= maxBoardHeight; boardHeight += Math.max(18, Math.round(height * 0.06))) {
		for (let boardWidth = minBoardSize; boardWidth <= maxBoardWidth; boardWidth += Math.max(18, Math.round(width * 0.06))) {
			const aspect = boardWidth / boardHeight;
			if (aspect < 0.7 || aspect > 1.35) continue;

			const stepX = Math.max(14, Math.round(boardWidth * 0.1));
			const stepY = Math.max(14, Math.round(boardHeight * 0.1));

			for (let y = 0; y <= height - boardHeight; y += stepY) {
				for (let x = 0; x <= width - boardWidth; x += stepX) {
					const score = scoreCheckerboardRegion(luma, width, height, x, y, boardWidth, boardHeight);
					if (!best || score > best.score) {
						best = { score, x, y, boardWidth, boardHeight };
					}
				}
			}
		}
	}

	if (!best || best.score < 22) {
		return null;
	}

	return [
		{ x: best.x, y: best.y },
		{ x: best.x + best.boardWidth, y: best.y },
		{ x: best.x + best.boardWidth, y: best.y + best.boardHeight },
		{ x: best.x, y: best.y + best.boardHeight }
	];
}
