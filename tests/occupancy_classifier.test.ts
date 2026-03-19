import { describe, expect, it } from 'vitest';

import {
	classifyOccupiedIndicesFromReference,
	classifyOccupiedPieceColorsFromReference
} from '../src/lib/vision/chessboard';

describe('classifyOccupiedIndicesFromReference', () => {
	it('classifies each square independently of other occupied squares', () => {
		const referenceScores = new Array(64).fill(6);
		const textureScores = new Array(64).fill(3);

		referenceScores[12] = 24;
		textureScores[12] = 12;

		expect(classifyOccupiedIndicesFromReference(referenceScores, textureScores, 1)).toEqual([12]);

		referenceScores[62] = 31;
		textureScores[62] = 15;

		expect(classifyOccupiedIndicesFromReference(referenceScores, textureScores, 1)).toEqual([12, 62]);

		referenceScores[62] = 6;
		textureScores[62] = 3;

		expect(classifyOccupiedIndicesFromReference(referenceScores, textureScores, 1)).toEqual([12]);
	});

	it('raises the bar for low-confidence occupancy when the threshold is increased', () => {
		const referenceScores = new Array(64).fill(6);
		const textureScores = new Array(64).fill(3);

		referenceScores[9] = 18;
		textureScores[9] = 12;
		referenceScores[40] = 33;
		textureScores[40] = 16;

		expect(classifyOccupiedIndicesFromReference(referenceScores, textureScores, 1)).toEqual([9, 40]);
		expect(classifyOccupiedIndicesFromReference(referenceScores, textureScores, 1.35)).toEqual([40]);
	});
});

describe('classifyOccupiedPieceColorsFromReference', () => {
	it('classifies bright occupied cores as white and dark occupied cores as black', () => {
		const referenceCoreLuminance = Array.from({ length: 64 }, (_, index): number => {
			const row = Math.floor(index / 8);
			const col = index % 8;
			return (row + col) % 2 === 0 ? 165 : 70;
		});
		const currentCoreLuminance = [...referenceCoreLuminance];

		currentCoreLuminance[4] = 46;
		currentCoreLuminance[12] = 58;
		currentCoreLuminance[52] = 176;
		currentCoreLuminance[60] = 168;

		expect(
			classifyOccupiedPieceColorsFromReference(referenceCoreLuminance, currentCoreLuminance, [4, 12, 52, 60])
		).toEqual([
			{ index: 4, color: 'black' },
			{ index: 12, color: 'black' },
			{ index: 52, color: 'white' },
			{ index: 60, color: 'white' }
		]);
	});
});
