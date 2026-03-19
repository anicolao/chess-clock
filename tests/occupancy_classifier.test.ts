import { describe, expect, it } from 'vitest';

import { classifyOccupiedIndicesFromReference } from '../src/lib/vision/chessboard';

describe('classifyOccupiedIndicesFromReference', () => {
	it('classifies each square independently of other occupied squares', () => {
		const referenceScores = new Array(64).fill(6);
		const textureScores = new Array(64).fill(3);

		referenceScores[12] = 24;
		textureScores[12] = 12;

		expect(classifyOccupiedIndicesFromReference(referenceScores, textureScores)).toEqual([12]);

		referenceScores[62] = 31;
		textureScores[62] = 15;

		expect(classifyOccupiedIndicesFromReference(referenceScores, textureScores)).toEqual([12, 62]);

		referenceScores[62] = 6;
		textureScores[62] = 3;

		expect(classifyOccupiedIndicesFromReference(referenceScores, textureScores)).toEqual([12]);
	});
});
