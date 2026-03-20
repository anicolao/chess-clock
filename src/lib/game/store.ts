import { browser } from '$app/environment';
import { configureStore, createSlice, type Middleware, type PayloadAction } from '@reduxjs/toolkit';

import { appendReduxActionLog } from '$lib/game/action-log';
import type {
	ConnectionStatus,
	GameState,
	LayoutMode,
	MoveCaptureDiagnostics,
	MoveCompletionRecord,
	Player
} from '$lib/game/types';

const SESSION_STORAGE_KEY = 'chess-clock.current-game-id';
const DEFAULT_CAMERA_URL = 'http://chesscam.local';

function generateSessionId() {
	if (browser && sessionStorage.getItem(SESSION_STORAGE_KEY)) {
		return sessionStorage.getItem(SESSION_STORAGE_KEY)!;
	}

	const generated = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `game-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

	if (browser) {
		sessionStorage.setItem(SESSION_STORAGE_KEY, generated);
	}

	return generated;
}

function createInitialMoveCaptureDiagnostics(): MoveCaptureDiagnostics {
	return {
		state: 'idle',
		stableSampleCount: 0,
		changedSquareIndices: [],
		occupiedPieceCount: 0,
		whitePieceCount: 0,
		blackPieceCount: 0,
		reason: 'not-started',
		lastSampleAtMs: null
	};
}

function createInitialState(): GameState {
	return {
		sessionId: generateSessionId(),
		baseTimeMs: 60000,
		timeWhite: 60000,
		timeBlack: 60000,
		incrementMs: 0,
		activePlayer: null,
		gameState: 'idle',
		winner: null,
		lastTickMs: null,
		warningPlayed: {
			white: false,
			black: false
		},
		connectionStatus: 'offline',
		cameraUrl: DEFAULT_CAMERA_URL,
		layoutMode: 'opposing',
		moveCaptureArmed: false,
		moveCaptureActivatedAtMs: null,
		moveCaptureDiagnostics: createInitialMoveCaptureDiagnostics(),
		moveCaptures: [],
		lastLogReportAtMs: null
	};
}

function applyElapsedTime(state: GameState, player: Player, deltaMs: number) {
	if (player === 'white') {
		state.timeWhite = Math.max(0, state.timeWhite - deltaMs);
		if (state.timeWhite <= 30000) {
			state.warningPlayed.white = true;
		}
		if (state.timeWhite === 0) {
			state.gameState = 'gameover';
			state.winner = 'black';
			state.activePlayer = null;
			return true;
		}
		return false;
	}

	state.timeBlack = Math.max(0, state.timeBlack - deltaMs);
	if (state.timeBlack <= 30000) {
		state.warningPlayed.black = true;
	}
	if (state.timeBlack === 0) {
		state.gameState = 'gameover';
		state.winner = 'white';
		state.activePlayer = null;
		return true;
	}
	return false;
}

const gameSlice = createSlice({
	name: 'game',
	initialState: createInitialState(),
	reducers: {
		configureFromQuery(
			state,
			action: PayloadAction<{
				baseTimeMs?: number;
				incrementMs?: number;
				cameraUrl?: string;
			}>
		) {
			if (typeof action.payload.baseTimeMs === 'number' && state.gameState === 'idle') {
				state.baseTimeMs = action.payload.baseTimeMs;
				state.timeWhite = action.payload.baseTimeMs;
				state.timeBlack = action.payload.baseTimeMs;
			}
			if (typeof action.payload.incrementMs === 'number') {
				state.incrementMs = action.payload.incrementMs;
			}
			if (typeof action.payload.cameraUrl === 'string' && action.payload.cameraUrl) {
				state.cameraUrl = action.payload.cameraUrl;
			}
		},
		connectionStatusChanged(state, action: PayloadAction<ConnectionStatus>) {
			state.connectionStatus = action.payload;
		},
		layoutModeToggled(state) {
			state.layoutMode = state.layoutMode === 'opposing' ? 'edge' : 'opposing';
		},
		moveCaptureArmedChanged(
			state,
			action: PayloadAction<{
				armed: boolean;
				activatedAtMs: number | null;
			}>
		) {
			state.moveCaptureArmed = action.payload.armed;
			state.moveCaptureActivatedAtMs = action.payload.activatedAtMs;
		},
		clockTapped(
			state,
			action: PayloadAction<{
				player: Player;
				nowMs: number;
			}>
		) {
			const { player, nowMs } = action.payload;
			if (state.gameState === 'gameover') return;

			if (state.gameState === 'idle') {
				state.gameState = 'running';
				state.activePlayer = player === 'white' ? 'black' : 'white';
				state.lastTickMs = nowMs;
				return;
			}

			if (state.gameState !== 'running' || state.activePlayer !== player || state.lastTickMs === null) {
				return;
			}

			const deltaMs = Math.max(0, nowMs - state.lastTickMs);
			const gameEnded = applyElapsedTime(state, player, deltaMs);
			if (gameEnded) {
				state.lastTickMs = null;
				return;
			}

			if (player === 'white') {
				state.timeWhite += state.incrementMs;
			} else {
				state.timeBlack += state.incrementMs;
			}
			state.activePlayer = player === 'white' ? 'black' : 'white';
			state.lastTickMs = nowMs;
		},
		tickElapsed(state, action: PayloadAction<{ nowMs: number }>) {
			if (state.gameState !== 'running' || !state.activePlayer || state.lastTickMs === null) return;
			const deltaMs = Math.max(0, action.payload.nowMs - state.lastTickMs);
			state.lastTickMs = action.payload.nowMs;
			const gameEnded = applyElapsedTime(state, state.activePlayer, deltaMs);
			if (gameEnded) {
				state.lastTickMs = null;
			}
		},
		moveCaptureStateUpdated(state, action: PayloadAction<MoveCaptureDiagnostics>) {
			state.moveCaptureDiagnostics = action.payload;
		},
		moveCompletionCommitted(state, action: PayloadAction<MoveCompletionRecord>) {
			state.moveCaptures.push(action.payload);
			state.moveCaptureDiagnostics = {
				state: 'capture_committed',
				stableSampleCount: action.payload.acceptedAfterSamples,
				changedSquareIndices: action.payload.changedSquareIndices,
				occupiedPieceCount: action.payload.occupiedPieces.length,
				whitePieceCount: action.payload.occupiedPieces.filter((piece) => piece.color === 'white').length,
				blackPieceCount: action.payload.occupiedPieces.filter((piece) => piece.color === 'black').length,
				reason: 'move-completion-committed',
				lastSampleAtMs: action.payload.capturedAtMs
			};
		},
		logReportPrepared(state, action: PayloadAction<{ preparedAtMs: number }>) {
			state.lastLogReportAtMs = action.payload.preparedAtMs;
		}
	}
});

const PERSISTED_ACTION_TYPES = new Set<string>([
	gameSlice.actions.configureFromQuery.type,
	gameSlice.actions.connectionStatusChanged.type,
	gameSlice.actions.layoutModeToggled.type,
	gameSlice.actions.moveCaptureArmedChanged.type,
	gameSlice.actions.clockTapped.type,
	gameSlice.actions.moveCaptureStateUpdated.type,
	gameSlice.actions.moveCompletionCommitted.type,
	gameSlice.actions.logReportPrepared.type
]);

let lastMoveCaptureStateLogKey = '';

const actionLogMiddleware: Middleware = (api) => (next) => (action) => {
	const result = next(action);

	if (
		browser
		&& typeof action === 'object'
		&& action !== null
		&& 'type' in action
		&& typeof action.type === 'string'
		&& PERSISTED_ACTION_TYPES.has(action.type)
	) {
		const state = api.getState() as { game: GameState };
		if (action.type === gameSlice.actions.moveCaptureStateUpdated.type) {
			const payload = ('payload' in action ? action.payload : null) as MoveCaptureDiagnostics | null;
			const nextLogKey = JSON.stringify({
				gameId: state.game.sessionId,
				state: payload?.state ?? null,
				reason: payload?.reason ?? null
			});
			if (nextLogKey === lastMoveCaptureStateLogKey) {
				return result;
			}
			lastMoveCaptureStateLogKey = nextLogKey;
		}
		void appendReduxActionLog({
			gameId: state.game.sessionId,
			recordedAtMs: Date.now(),
			type: action.type,
			payload: 'payload' in action ? action.payload : null
		});
	}

	return result;
};

export const gameStore = configureStore({
	reducer: {
		game: gameSlice.reducer
	},
	middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(actionLogMiddleware)
});

export const {
	configureFromQuery,
	connectionStatusChanged,
	layoutModeToggled,
	moveCaptureArmedChanged,
	clockTapped,
	tickElapsed,
	moveCaptureStateUpdated,
	moveCompletionCommitted,
	logReportPrepared
} = gameSlice.actions;

export type RootState = ReturnType<typeof gameStore.getState>;
export type AppDispatch = typeof gameStore.dispatch;
