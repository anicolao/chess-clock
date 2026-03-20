import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

type NormalizedCase = {
	sourceFile: string;
	gameId: string;
	summary: {
		moveCaptureCount: number;
		moveCaptureArmed?: boolean;
	};
	currentMoveCaptureDiagnostics: {
		state: string;
		reason: string;
	} | null;
	moveCaptures: Array<{
		moveIndex: number;
		acceptedAfterMs: number;
		changedSquareIndices: number[];
		occupiedPiecesCount: number;
	}>;
	interestingActions: Array<{
		type: string;
		state?: string;
		reason?: string;
		armed?: boolean;
	}>;
};

function loadCase(fileName: string) {
	const fullPath = path.join(process.cwd(), 'tests/fixtures/game-log-cases', fileName);
	return JSON.parse(fs.readFileSync(fullPath, 'utf8')) as NormalizedCase;
}

describe('normalized game log cases', () => {
	it('captures the pre-auto-arm report as committed moves without arming metadata', () => {
		const gameCase = loadCase('issue-34-pre-auto-arm.case.json');
		expect(gameCase.summary.moveCaptureCount).toBe(6);
		expect(gameCase.summary.moveCaptureArmed ?? false).toBe(false);
		expect(gameCase.interestingActions.some((action) => action.type === 'game/moveCaptureArmedChanged')).toBe(false);
		expect(gameCase.moveCaptures).toHaveLength(6);
	});

	it('captures the auto-arm report with arm transition and compact diagnostics', () => {
		const gameCase = loadCase('issue-35-auto-arm.case.json');
		expect(gameCase.summary.moveCaptureArmed).toBe(true);
		expect(gameCase.currentMoveCaptureDiagnostics?.state).toBe('stable');
		expect(
			gameCase.interestingActions.some((action) =>
				action.type === 'game/moveCaptureArmedChanged' && action.armed === true
			)
		).toBe(true);
		expect(
			gameCase.interestingActions.some((action) =>
				action.type === 'game/moveCaptureStateUpdated' && action.reason === 'awaiting-initial-setup'
			)
		).toBe(true);
		expect(gameCase.moveCaptures).toHaveLength(3);
		expect(gameCase.moveCaptures.every((capture) => capture.acceptedAfterMs >= 500)).toBe(true);
	});
});
