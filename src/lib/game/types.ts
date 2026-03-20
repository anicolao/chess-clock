export type Player = 'white' | 'black';
export type GameLifecycle = 'idle' | 'running' | 'paused' | 'gameover';
export type ConnectionStatus = 'offline' | 'synced' | 'error';
export type LayoutMode = 'opposing' | 'edge';
export type MoveCaptureEngineState =
	| 'uncalibrated'
	| 'idle'
	| 'stable'
	| 'transitioning'
	| 'candidate_stable'
	| 'capture_committed';

export type OccupiedPiece = {
	index: number;
	color: Player;
};

export type MoveCaptureAnalysisHealth = {
	boardMissing: boolean;
	referenceMissing: boolean;
	lowConfidence: boolean;
};

export type MoveCaptureDiagnostics = {
	state: MoveCaptureEngineState;
	stableSampleCount: number;
	changedSquareIndices: number[];
	occupiedPieceCount: number;
	whitePieceCount: number;
	blackPieceCount: number;
	reason: string | null;
	lastSampleAtMs: number | null;
};

export type MoveCompletionRecord = {
	captureId: string;
	gameId: string;
	moveIndex: number;
	capturedAtMs: number;
	source: 'browser-webcam' | 'remote-camera';
	calibrationVersion: number;
	occupancyThreshold: number;
	acceptedAfterSamples: number;
	acceptedAfterMs: number;
	previousFingerprint: string;
	nextFingerprint: string;
	occupiedPieces: OccupiedPiece[];
	occupancyScores: number[];
	referenceScores: number[];
	rawFrameDataUrl: string;
	warpedBoardDataUrl: string;
	rawFrameSize: {
		width: number;
		height: number;
	};
	warpSize: {
		width: number;
		height: number;
	};
	analysisHealth: MoveCaptureAnalysisHealth;
	changedSquareIndices: number[];
};

export type GameState = {
	sessionId: string;
	baseTimeMs: number;
	timeWhite: number;
	timeBlack: number;
	incrementMs: number;
	activePlayer: Player | null;
	gameState: GameLifecycle;
	winner: Player | null;
	lastTickMs: number | null;
	warningPlayed: Record<Player, boolean>;
	connectionStatus: ConnectionStatus;
	cameraUrl: string;
	layoutMode: LayoutMode;
	moveCaptureArmed: boolean;
	moveCaptureActivatedAtMs: number | null;
	moveCaptureDiagnostics: MoveCaptureDiagnostics;
	moveCaptures: MoveCompletionRecord[];
	lastLogReportAtMs: number | null;
};

export type GameLogReport = {
	generatedAtMs: number;
	gameId: string;
	summary: {
		gameState: GameLifecycle;
		activePlayer: Player | null;
		winner: Player | null;
		moveCaptureCount: number;
		connectionStatus: ConnectionStatus;
		cameraUrl: string;
		layoutMode: LayoutMode;
		moveCaptureArmed: boolean;
	};
	currentMoveCaptureDiagnostics: MoveCaptureDiagnostics;
	calibration: unknown;
	moveCaptures: MoveCompletionRecord[];
	actions: Array<{
		id?: number;
		gameId: string;
		recordedAtMs: number;
		type: string;
		payload: unknown;
	}>;
};
