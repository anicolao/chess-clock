import type {
	MoveCaptureAnalysisHealth,
	MoveCaptureDiagnostics,
	MoveCaptureEngineState,
	OccupiedPiece
} from '$lib/game/types';

const CANDIDATE_STABLE_SAMPLE_COUNT = 3;
const CANDIDATE_STABLE_DWELL_MS = 500;

type MoveCaptureSample = {
	timestampMs: number;
	occupiedPieces: OccupiedPiece[];
	analysisHealth: MoveCaptureAnalysisHealth;
};

type MoveCaptureCommit = {
	moveIndex: number;
	previousFingerprint: string;
	nextFingerprint: string;
	acceptedAfterSamples: number;
	acceptedAfterMs: number;
	changedSquareIndices: number[];
};

type MoveCaptureDecision = {
	diagnostics: MoveCaptureDiagnostics;
	commit: MoveCaptureCommit | null;
};

function createEmptyDiagnostics(
	state: MoveCaptureEngineState,
	reason: string | null = null
): MoveCaptureDiagnostics {
	return {
		state,
		stableSampleCount: 0,
		changedSquareIndices: [],
		occupiedPieceCount: 0,
		whitePieceCount: 0,
		blackPieceCount: 0,
		reason,
		lastSampleAtMs: null
	};
}

function buildFingerprint(occupiedPieces: OccupiedPiece[]) {
	return [...occupiedPieces]
		.sort((a, b) => a.index - b.index || a.color.localeCompare(b.color))
		.map((piece) => `${piece.index}:${piece.color}`)
		.join('|');
}

function diffChangedSquares(previousFingerprint: string, nextFingerprint: string) {
	const previousMap = new Map<number, string>();
	const nextMap = new Map<number, string>();

	for (const fingerprint of previousFingerprint ? previousFingerprint.split('|') : []) {
		if (!fingerprint) continue;
		const [indexText, color] = fingerprint.split(':');
		previousMap.set(Number.parseInt(indexText, 10), color);
	}
	for (const fingerprint of nextFingerprint ? nextFingerprint.split('|') : []) {
		if (!fingerprint) continue;
		const [indexText, color] = fingerprint.split(':');
		nextMap.set(Number.parseInt(indexText, 10), color);
	}

	const changed = new Set<number>();
	for (const [index, color] of previousMap.entries()) {
		if (nextMap.get(index) !== color) {
			changed.add(index);
		}
	}
	for (const [index, color] of nextMap.entries()) {
		if (previousMap.get(index) !== color) {
			changed.add(index);
		}
	}

	return [...changed].sort((a, b) => a - b);
}

export class MoveCaptureEngine {
	private acceptedFingerprint = '';
	private candidateFingerprint = '';
	private candidateSampleCount = 0;
	private candidateSinceMs = 0;
	private diagnostics: MoveCaptureDiagnostics = createEmptyDiagnostics('idle');
	private committedMoveCount = 0;
	private seeded = false;

	reset(state: MoveCaptureEngineState = 'idle', reason: string | null = null) {
		this.acceptedFingerprint = '';
		this.candidateFingerprint = '';
		this.candidateSampleCount = 0;
		this.candidateSinceMs = 0;
		this.committedMoveCount = 0;
		this.seeded = false;
		this.diagnostics = createEmptyDiagnostics(state, reason);
	}

	getDiagnostics() {
		return this.diagnostics;
	}

	consumeSample(sample: MoveCaptureSample): MoveCaptureDecision {
		const fingerprint = buildFingerprint(sample.occupiedPieces);
		const whitePieceCount = sample.occupiedPieces.filter((piece) => piece.color === 'white').length;
		const blackPieceCount = sample.occupiedPieces.length - whitePieceCount;

		if (
			sample.analysisHealth.boardMissing
			|| sample.analysisHealth.referenceMissing
			|| sample.analysisHealth.lowConfidence
		) {
			this.diagnostics = {
				state: 'transitioning',
				stableSampleCount: 0,
				changedSquareIndices: [],
				occupiedPieceCount: sample.occupiedPieces.length,
				whitePieceCount,
				blackPieceCount,
				reason: sample.analysisHealth.boardMissing
					? 'board-missing'
					: sample.analysisHealth.referenceMissing
						? 'reference-missing'
						: 'low-confidence',
				lastSampleAtMs: sample.timestampMs
			};
			return { diagnostics: this.diagnostics, commit: null };
		}

		if (!this.seeded) {
			this.seeded = true;
			this.acceptedFingerprint = fingerprint;
			this.diagnostics = {
				state: 'stable',
				stableSampleCount: 1,
				changedSquareIndices: [],
				occupiedPieceCount: sample.occupiedPieces.length,
				whitePieceCount,
				blackPieceCount,
				reason: 'seeded-stable-baseline',
				lastSampleAtMs: sample.timestampMs
			};
			return { diagnostics: this.diagnostics, commit: null };
		}

		if (fingerprint === this.acceptedFingerprint) {
			this.candidateFingerprint = '';
			this.candidateSampleCount = 0;
			this.candidateSinceMs = 0;
			this.diagnostics = {
				state: 'stable',
				stableSampleCount: 1,
				changedSquareIndices: [],
				occupiedPieceCount: sample.occupiedPieces.length,
				whitePieceCount,
				blackPieceCount,
				reason: 'matches-last-accepted',
				lastSampleAtMs: sample.timestampMs
			};
			return { diagnostics: this.diagnostics, commit: null };
		}

		const changedSquareIndices = diffChangedSquares(this.acceptedFingerprint, fingerprint);
		if (!this.candidateFingerprint || this.candidateFingerprint !== fingerprint) {
			this.candidateFingerprint = fingerprint;
			this.candidateSampleCount = 1;
			this.candidateSinceMs = sample.timestampMs;
			this.diagnostics = {
				state: this.diagnostics.state === 'transitioning' ? 'candidate_stable' : 'transitioning',
				stableSampleCount: this.diagnostics.state === 'transitioning' ? 1 : 0,
				changedSquareIndices,
				occupiedPieceCount: sample.occupiedPieces.length,
				whitePieceCount,
				blackPieceCount,
				reason: this.diagnostics.state === 'transitioning'
					? 'new-candidate-fingerprint'
					: 'transition-detected',
				lastSampleAtMs: sample.timestampMs
			};
			return { diagnostics: this.diagnostics, commit: null };
		}

		this.candidateSampleCount += 1;
		const acceptedAfterMs = sample.timestampMs - this.candidateSinceMs;
		const readyToCommit = this.candidateSampleCount >= CANDIDATE_STABLE_SAMPLE_COUNT
			&& acceptedAfterMs >= CANDIDATE_STABLE_DWELL_MS;

		if (!readyToCommit) {
			this.diagnostics = {
				state: 'candidate_stable',
				stableSampleCount: this.candidateSampleCount,
				changedSquareIndices,
				occupiedPieceCount: sample.occupiedPieces.length,
				whitePieceCount,
				blackPieceCount,
				reason: 'candidate-stabilizing',
				lastSampleAtMs: sample.timestampMs
			};
			return { diagnostics: this.diagnostics, commit: null };
		}

		const previousFingerprint = this.acceptedFingerprint;
		this.acceptedFingerprint = fingerprint;
		this.candidateFingerprint = '';
		this.candidateSampleCount = 0;
		this.candidateSinceMs = 0;
		this.committedMoveCount += 1;
		this.diagnostics = {
			state: 'capture_committed',
			stableSampleCount: CANDIDATE_STABLE_SAMPLE_COUNT,
			changedSquareIndices,
			occupiedPieceCount: sample.occupiedPieces.length,
			whitePieceCount,
			blackPieceCount,
			reason: 'move-completion-committed',
			lastSampleAtMs: sample.timestampMs
		};

		return {
			diagnostics: this.diagnostics,
			commit: {
				moveIndex: this.committedMoveCount,
				previousFingerprint,
				nextFingerprint: fingerprint,
				acceptedAfterSamples: CANDIDATE_STABLE_SAMPLE_COUNT,
				acceptedAfterMs,
				changedSquareIndices
			}
		};
	}
}
