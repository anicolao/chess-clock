import { describe, expect, it } from 'vitest';

import {
	looksLikeInitialBoardSetup,
	MoveCaptureEngine
} from '$lib/game/move-capture-engine';

describe('MoveCaptureEngine', () => {
	it('commits only after a stable candidate window', () => {
		const engine = new MoveCaptureEngine();
		const baseline = [
			{ index: 0, color: 'white' as const },
			{ index: 63, color: 'black' as const }
		];
		const moved = [
			{ index: 8, color: 'white' as const },
			{ index: 63, color: 'black' as const }
		];

		expect(
			engine.consumeSample({
				timestampMs: 0,
				occupiedPieces: baseline,
				analysisHealth: {
					boardMissing: false,
					referenceMissing: false,
					lowConfidence: false
				}
			}).commit
		).toBeNull();

		expect(
			engine.consumeSample({
				timestampMs: 100,
				occupiedPieces: moved,
				analysisHealth: {
					boardMissing: false,
					referenceMissing: false,
					lowConfidence: false
				}
			}).commit
		).toBeNull();

		expect(
			engine.consumeSample({
				timestampMs: 300,
				occupiedPieces: moved,
				analysisHealth: {
					boardMissing: false,
					referenceMissing: false,
					lowConfidence: false
				}
			}).commit
		).toBeNull();

		const thirdDecision = engine.consumeSample({
			timestampMs: 650,
			occupiedPieces: moved,
			analysisHealth: {
				boardMissing: false,
				referenceMissing: false,
				lowConfidence: false
			}
		});
		expect(thirdDecision.commit).not.toBeNull();
		expect(thirdDecision.commit?.moveIndex).toBe(1);
		expect(thirdDecision.commit?.changedSquareIndices).toEqual([0, 8]);
	});

	it('drops a candidate when the board returns to the accepted state', () => {
		const engine = new MoveCaptureEngine();
		const baseline = [{ index: 12, color: 'white' as const }];
		const transient = [{ index: 20, color: 'white' as const }];

		engine.consumeSample({
			timestampMs: 0,
			occupiedPieces: baseline,
			analysisHealth: {
				boardMissing: false,
				referenceMissing: false,
				lowConfidence: false
			}
		});
		engine.consumeSample({
			timestampMs: 100,
			occupiedPieces: transient,
			analysisHealth: {
				boardMissing: false,
				referenceMissing: false,
				lowConfidence: false
			}
		});

		const reverted = engine.consumeSample({
			timestampMs: 200,
			occupiedPieces: baseline,
			analysisHealth: {
				boardMissing: false,
				referenceMissing: false,
				lowConfidence: false
			}
		});

		expect(reverted.commit).toBeNull();
		expect(reverted.diagnostics.state).toBe('stable');
		expect(reverted.diagnostics.reason).toBe('matches-last-accepted');
	});
});

describe('looksLikeInitialBoardSetup', () => {
	it('accepts a standard initial setup aligned by rows', () => {
		const occupiedPieces = [
			...Array.from({ length: 16 }, (_, index) => ({
				index,
				color: 'white' as const
			})),
			...Array.from({ length: 16 }, (_, offset) => ({
				index: 48 + offset,
				color: 'black' as const
			}))
		];

		expect(looksLikeInitialBoardSetup(occupiedPieces)).toBe(true);
	});

	it('rejects a non-start position with missing middle-rank separation', () => {
		const occupiedPieces = [
			...Array.from({ length: 8 }, (_, index) => ({
				index,
				color: 'white' as const
			})),
			...Array.from({ length: 8 }, (_, index) => ({
				index: 16 + index,
				color: 'white' as const
			})),
			...Array.from({ length: 8 }, (_, index) => ({
				index: 40 + index,
				color: 'black' as const
			})),
			...Array.from({ length: 8 }, (_, index) => ({
				index: 56 + index,
				color: 'black' as const
			}))
		];

		expect(looksLikeInitialBoardSetup(occupiedPieces)).toBe(false);
	});
});
