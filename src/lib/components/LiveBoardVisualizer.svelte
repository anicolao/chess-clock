<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { base } from '$app/paths';

	import {
		DEFAULT_OCCUPANCY_THRESHOLD,
		type CameraMode,
		loadBoardCalibration
	} from '$lib/board-calibration';
	import { captureImageDataFromElement, loadImageDataFromUrl } from '$lib/vision/browser-images';
	import {
		analyzeBoardFrame,
		boardLooksEmpty,
		type OccupiedPiece,
		WARP_SIZE
	} from '$lib/vision/chessboard';
	import { loadOpenCv } from '$lib/vision/opencv-browser';
	import { imageDataFrameToDataUrl } from '$lib/vision/browser-images';
	import {
		buildOccupiedPiecesFingerprint,
		looksLikeInitialBoardSetup,
		MoveCaptureEngine
	} from '$lib/game/move-capture-engine';
	import {
		gameStore,
		moveCaptureArmedChanged,
		moveCaptureStateUpdated,
		moveCompletionCommitted
	} from '$lib/game/store';
	import type { GameState } from '$lib/game/types';

	type OpenCvModule = typeof import('@techstark/opencv-js');

	const DEFAULT_CAMERA_URL = 'http://chesscam.local';
	const CAMERA_STAGE_ASPECT_RATIO = 4 / 3;
	const LIVE_ANALYSIS_INTERVAL_MS = 100;
	const LIVE_CAPTURE_MAX_DIMENSION = 640;

	let {
		cameraUrl = DEFAULT_CAMERA_URL,
		setupHref = `${base}/settings`
	}: {
		cameraUrl?: string;
		setupHref?: string;
	} = $props();

	let streamImage = $state<HTMLImageElement | null>(null);
	let streamVideo = $state<HTMLVideoElement | null>(null);
	let snapshotCanvas = $state<HTMLCanvasElement | null>(null);
	let boardCanvas = $state<HTMLCanvasElement | null>(null);

	let statusLabel = $state('Load board setup');
	let streamReady = $state(false);
	let errorMessage = $state<string | null>(null);
	let streamEnabled = $state(false);
	let cameraMode = $state<CameraMode>('browser');

	let cvModule = $state<OpenCvModule | null>(null);
	let referenceImageData: ImageData | null = null;
	let mediaStream: MediaStream | null = null;
	let processingTimeoutId: ReturnType<typeof setTimeout> | null = null;
	let processing = false;
	let mounted = false;
	let calibration = $state<ReturnType<typeof loadBoardCalibration>>(loadBoardCalibration());
	let loadedReferenceUrl = $state<string | null>(null);
	let game = $state<GameState>(gameStore.getState().game);
	let storeUnsubscribe: (() => void) | null = null;
	let initialSetupFingerprint = '';
	let initialSetupSampleCount = 0;
	let initialSetupSinceMs = 0;
	let primeToneAudio: HTMLAudioElement | null = null;
	let moveToneAudio: HTMLAudioElement | null = null;
	let moveTonePrimed = $state(false);

	const moveCaptureEngine = new MoveCaptureEngine();
	const INITIAL_SETUP_SAMPLE_COUNT = 3;
	const INITIAL_SETUP_DWELL_MS = 500;

	const effectiveCameraUrl = $derived(cameraUrl || calibration?.cameraUrl || DEFAULT_CAMERA_URL);
	const streamSrc = $derived(
		streamEnabled && cameraMode === 'remote'
			? `${effectiveCameraUrl.replace(/\/$/, '')}/stream`
			: ''
	);
	const canAnalyze = $derived(Boolean(calibration?.normalizedQuad));
	const setupPrompt = $derived(canAnalyze ? null : 'Tap to set up board');
	const remoteMixedContentBlocked = $derived(
		cameraMode === 'remote'
			&& typeof window !== 'undefined'
			&& window.location.protocol === 'https:'
			&& /^http:\/\//i.test(effectiveCameraUrl)
	);

	$effect(() => {
		if (cameraMode === 'browser' && streamVideo && mediaStream && streamVideo.srcObject !== mediaStream) {
			streamVideo.srcObject = mediaStream;
			void streamVideo.play().catch(() => {});
		}
	});

	onMount(async () => {
		storeUnsubscribe = gameStore.subscribe(() => {
			const nextGame = gameStore.getState().game;
			if (nextGame.sessionId !== game.sessionId) {
				moveCaptureEngine.reset('idle', 'new-game-session');
			}
			game = nextGame;
		});

		mounted = true;
		if (typeof window !== 'undefined') {
			window.addEventListener('pointerdown', primeMoveToneContext, { passive: true });
			window.addEventListener('touchend', primeMoveToneContext, { passive: true });
			window.addEventListener('keydown', primeMoveToneContext, { passive: true });
		}
		calibration = loadBoardCalibration();
		cameraMode = calibration?.cameraMode ?? 'browser';
		if (calibration?.referenceImageDataUrl) {
			try {
				referenceImageData = await loadImageDataFromUrl(calibration.referenceImageDataUrl);
				loadedReferenceUrl = calibration.referenceImageDataUrl;
			} catch (error) {
				errorMessage = error instanceof Error ? error.message : 'Failed to load the board reference.';
			}
		}

		if (calibration?.normalizedQuad) {
			if (cameraMode === 'browser') {
				statusLabel = 'Starting camera';
				void startBrowserCamera();
			} else {
				streamEnabled = true;
				statusLabel = 'Connecting camera';
			}
		}

		scheduleProcessing(120);
	});

	onDestroy(() => {
		mounted = false;
		if (typeof window !== 'undefined') {
			window.removeEventListener('pointerdown', primeMoveToneContext);
			window.removeEventListener('touchend', primeMoveToneContext);
			window.removeEventListener('keydown', primeMoveToneContext);
		}
		clearScheduledProcessing();
		stopBrowserCamera();
		primeToneAudio?.pause();
		moveToneAudio?.pause();
		primeToneAudio = null;
		moveToneAudio = null;
		storeUnsubscribe?.();
	});

	function clearScheduledProcessing() {
		if (processingTimeoutId) {
			clearTimeout(processingTimeoutId);
			processingTimeoutId = null;
		}
	}

	function scheduleProcessing(delay = LIVE_ANALYSIS_INTERVAL_MS) {
		if (!mounted) return;
		clearScheduledProcessing();
		processingTimeoutId = setTimeout(() => {
			void processFrame();
		}, delay);
	}

	function stopBrowserCamera() {
		mediaStream?.getTracks().forEach((track) => track.stop());
		mediaStream = null;
	}

	function resetInitialSetupTracker() {
		initialSetupFingerprint = '';
		initialSetupSampleCount = 0;
		initialSetupSinceMs = 0;
	}

	function createToneDataUrl(
		{
			startHz,
			endHz,
			durationMs,
			peakAmplitude
		}: {
			startHz: number;
			endHz: number;
			durationMs: number;
			peakAmplitude: number;
		}
	) {
		const sampleRate = 22050;
		const sampleCount = Math.max(1, Math.round((sampleRate * durationMs) / 1000));
		const bytesPerSample = 2;
		const dataSize = sampleCount * bytesPerSample;
		const buffer = new ArrayBuffer(44 + dataSize);
		const view = new DataView(buffer);
		const durationSeconds = durationMs / 1000;

		const writeAscii = (offset: number, value: string) => {
			for (let index = 0; index < value.length; index += 1) {
				view.setUint8(offset + index, value.charCodeAt(index));
			}
		};

		writeAscii(0, 'RIFF');
		view.setUint32(4, 36 + dataSize, true);
		writeAscii(8, 'WAVE');
		writeAscii(12, 'fmt ');
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, 1, true);
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, sampleRate * bytesPerSample, true);
		view.setUint16(32, bytesPerSample, true);
		view.setUint16(34, 16, true);
		writeAscii(36, 'data');
		view.setUint32(40, dataSize, true);

		for (let index = 0; index < sampleCount; index += 1) {
			const t = index / sampleRate;
			const progress = sampleCount <= 1 ? 1 : index / (sampleCount - 1);
			const frequency = startHz * Math.pow(endHz / startHz, progress);
			const fadeIn = Math.min(1, t / 0.02);
			const fadeOut = Math.min(1, (durationSeconds - t) / 0.05);
			const envelope = Math.max(0, Math.min(fadeIn, fadeOut));
			const sample = Math.sin(2 * Math.PI * frequency * t) * peakAmplitude * envelope;
			view.setInt16(44 + (index * bytesPerSample), Math.round(sample * 32767), true);
		}

		let binary = '';
		const bytes = new Uint8Array(buffer);
		for (const byte of bytes) {
			binary += String.fromCharCode(byte);
		}
		return `data:audio/wav;base64,${btoa(binary)}`;
	}

	function ensureMoveToneAudio() {
		if (typeof window === 'undefined') {
			return null;
		}
		if (!primeToneAudio) {
			primeToneAudio = new Audio(createToneDataUrl({
				startHz: 523.25,
				endHz: 659.25,
				durationMs: 160,
				peakAmplitude: 0.24
			}));
			primeToneAudio.preload = 'auto';
			primeToneAudio.setAttribute('playsinline', '');
			primeToneAudio.setAttribute('webkit-playsinline', '');
		}
		if (!moveToneAudio) {
			moveToneAudio = new Audio(createToneDataUrl({
				startHz: 659.25,
				endHz: 783.99,
				durationMs: 240,
				peakAmplitude: 0.28
			}));
			moveToneAudio.preload = 'auto';
			moveToneAudio.setAttribute('playsinline', '');
			moveToneAudio.setAttribute('webkit-playsinline', '');
		}
		return { primeToneAudio, moveToneAudio };
	}

	async function primeMoveToneContext() {
		if (moveTonePrimed) return;
		const audio = ensureMoveToneAudio();
		if (!audio) return;
		audio.primeToneAudio.currentTime = 0;
		try {
			await audio.primeToneAudio.play();
			moveTonePrimed = true;
		} catch {
			moveTonePrimed = false;
		}
	}

	function playMoveRecognizedTone() {
		const audio = ensureMoveToneAudio();
		if (!audio) return;
		const moveAudio = audio.moveToneAudio;
		moveAudio.pause();
		moveAudio.currentTime = 0;
		void moveAudio.play().catch(() => {
			return;
		});
	}

	async function startBrowserCamera() {
		stopBrowserCamera();
		streamEnabled = true;
		streamReady = false;
		errorMessage = null;
		statusLabel = 'Starting camera';

		if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
			errorMessage = 'Browser camera requires a secure context.';
			statusLabel = 'Camera unavailable';
			scheduleProcessing(1600);
			return;
		}

		try {
			const browserDeviceId = calibration?.browserDeviceId;
			mediaStream = await navigator.mediaDevices.getUserMedia({
				video: {
					...(browserDeviceId
						? { deviceId: { exact: browserDeviceId } }
						: { facingMode: { ideal: 'environment' } }),
					width: { ideal: 1280 },
					height: { ideal: 720 }
				},
				audio: false
			});
			if (streamVideo) {
				streamVideo.srcObject = mediaStream;
				await streamVideo.play().catch(() => {});
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to open the browser camera.';
			statusLabel = 'Camera unavailable';
		} finally {
			scheduleProcessing(800);
		}
	}

	function drawOverlay(context: CanvasRenderingContext2D, occupiedPieces: OccupiedPiece[]) {
		const boardSize = context.canvas.width;
		const cellSize = boardSize / 8;

		context.strokeStyle = 'rgba(255, 255, 255, 0.16)';
		context.lineWidth = 1;
		for (let index = 1; index < 8; index++) {
			const position = index * cellSize;
			context.beginPath();
			context.moveTo(position, 0);
			context.lineTo(position, boardSize);
			context.stroke();

			context.beginPath();
			context.moveTo(0, position);
			context.lineTo(boardSize, position);
			context.stroke();
		}

		for (const occupiedPiece of occupiedPieces) {
			const occupiedIndex = occupiedPiece.index;
			const row = Math.floor(occupiedIndex / 8);
			const col = occupiedIndex % 8;
			const x = (col + 0.5) * cellSize;
			const y = (row + 0.5) * cellSize;

			context.fillStyle = occupiedPiece.color === 'white' ? '#f6efdc' : '#3a3935';
			context.beginPath();
			context.arc(x, y, Math.max(3.5, boardSize * 0.036), 0, Math.PI * 2);
			context.fill();

			context.strokeStyle = occupiedPiece.color === 'white'
				? 'rgba(45, 35, 22, 0.85)'
				: 'rgba(255, 255, 255, 0.85)';
			context.lineWidth = 1.3;
			context.stroke();
		}
	}

	async function ensureCvModule() {
		if (cvModule) return cvModule;

		try {
			cvModule = await loadOpenCv();
			return cvModule;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to load OpenCV.';
			return null;
		}
	}

	async function processFrame() {
		const source = cameraMode === 'browser' ? streamVideo : streamImage;
		if (processing || !boardCanvas || !snapshotCanvas || !source || !streamReady) {
			scheduleProcessing(streamReady ? LIVE_ANALYSIS_INTERVAL_MS : 800);
			return;
		}

		calibration = loadBoardCalibration();
		if (!calibration) {
			moveCaptureEngine.reset('uncalibrated', 'missing-calibration');
			gameStore.dispatch(moveCaptureStateUpdated(moveCaptureEngine.getDiagnostics()));
			statusLabel = 'Set up board';
			streamEnabled = false;
			streamReady = false;
			stopBrowserCamera();
			scheduleProcessing(1600);
			return;
		}
		if (calibration.cameraMode !== cameraMode) {
			cameraMode = calibration.cameraMode;
			streamReady = false;
			if (cameraMode === 'browser') {
				void startBrowserCamera();
			} else {
				stopBrowserCamera();
				streamEnabled = true;
				statusLabel = 'Connecting camera';
			}
			scheduleProcessing(600);
			return;
		}

		if (calibration.referenceImageDataUrl !== loadedReferenceUrl) {
			referenceImageData = calibration.referenceImageDataUrl
				? await loadImageDataFromUrl(calibration.referenceImageDataUrl)
				: null;
			loadedReferenceUrl = calibration.referenceImageDataUrl;
		}

		processing = true;

		try {
			const activeCv = await ensureCvModule();
			if (!activeCv) {
				statusLabel = 'Loading vision';
				scheduleProcessing(1200);
				return;
			}

			const frame = captureImageDataFromElement(source, snapshotCanvas, {
				maxDimension: LIVE_CAPTURE_MAX_DIMENSION,
				coverAspectRatio: CAMERA_STAGE_ASPECT_RATIO
			});
			const analysis = analyzeBoardFrame(
				activeCv,
				frame,
				calibration.normalizedQuad,
				referenceImageData,
				calibration.occupancyThreshold ?? DEFAULT_OCCUPANCY_THRESHOLD
			);
			const resolvedOccupiedIndices = !referenceImageData
				? []
				: analysis.referenceScores.length > 0 && boardLooksEmpty(analysis.referenceScores)
					? []
					: analysis.occupiedIndices;
			const resolvedOccupiedPieces = !referenceImageData
				? []
				: analysis.referenceScores.length > 0 && boardLooksEmpty(analysis.referenceScores)
					? []
					: analysis.occupiedPieces;
			const context = boardCanvas.getContext('2d');
			if (!context) {
				throw new Error('2D canvas is unavailable.');
			}

			boardCanvas.width = WARP_SIZE;
			boardCanvas.height = WARP_SIZE;
			context.putImageData(analysis.boardImageData, 0, 0);

			if (referenceImageData) {
				drawOverlay(context, resolvedOccupiedPieces);
				const sampleTimestampMs = Date.now();
				if (!game.moveCaptureArmed) {
					const initialSetupDetected = looksLikeInitialBoardSetup(resolvedOccupiedPieces);
					if (initialSetupDetected) {
						const fingerprint = buildOccupiedPiecesFingerprint(resolvedOccupiedPieces);
						if (fingerprint !== initialSetupFingerprint) {
							initialSetupFingerprint = fingerprint;
							initialSetupSampleCount = 1;
							initialSetupSinceMs = sampleTimestampMs;
						} else {
							initialSetupSampleCount += 1;
						}

						const settledForMs = sampleTimestampMs - initialSetupSinceMs;
						if (
							initialSetupSampleCount >= INITIAL_SETUP_SAMPLE_COUNT
							&& settledForMs >= INITIAL_SETUP_DWELL_MS
						) {
							gameStore.dispatch(moveCaptureArmedChanged({
								armed: true,
								activatedAtMs: sampleTimestampMs
							}));
							moveCaptureEngine.reset('idle', 'capture-armed');
							resetInitialSetupTracker();
							const seededDecision = moveCaptureEngine.consumeSample({
								timestampMs: sampleTimestampMs,
								occupiedPieces: resolvedOccupiedPieces,
								analysisHealth: {
									boardMissing: false,
									referenceMissing: false,
									lowConfidence: false
								}
							});
							gameStore.dispatch(moveCaptureStateUpdated(seededDecision.diagnostics));
							statusLabel = `${resolvedOccupiedIndices.length} occupied · capture armed`;
						} else {
							gameStore.dispatch(moveCaptureStateUpdated({
								state: 'idle',
								stableSampleCount: initialSetupSampleCount,
								changedSquareIndices: [],
								occupiedPieceCount: resolvedOccupiedPieces.length,
								whitePieceCount: resolvedOccupiedPieces.filter((piece) => piece.color === 'white').length,
								blackPieceCount: resolvedOccupiedPieces.filter((piece) => piece.color === 'black').length,
								reason: 'awaiting-initial-setup-confirmation',
								lastSampleAtMs: sampleTimestampMs
							}));
							statusLabel = `${resolvedOccupiedIndices.length} occupied · arming capture`;
						}
					} else {
						resetInitialSetupTracker();
						moveCaptureEngine.reset('idle', 'awaiting-initial-setup');
						gameStore.dispatch(moveCaptureStateUpdated({
							state: 'idle',
							stableSampleCount: 0,
							changedSquareIndices: [],
							occupiedPieceCount: resolvedOccupiedPieces.length,
							whitePieceCount: resolvedOccupiedPieces.filter((piece) => piece.color === 'white').length,
							blackPieceCount: resolvedOccupiedPieces.filter((piece) => piece.color === 'black').length,
							reason: 'awaiting-initial-setup',
							lastSampleAtMs: sampleTimestampMs
						}));
						statusLabel = `${resolvedOccupiedIndices.length} occupied`;
					}
				} else {
					resetInitialSetupTracker();
					const decision = moveCaptureEngine.consumeSample({
						timestampMs: sampleTimestampMs,
						occupiedPieces: resolvedOccupiedPieces,
						analysisHealth: {
							boardMissing: false,
							referenceMissing: false,
							lowConfidence: false
						}
					});
					gameStore.dispatch(moveCaptureStateUpdated(decision.diagnostics));

					if (decision.commit) {
						gameStore.dispatch(moveCompletionCommitted({
							captureId: `${game.sessionId}-move-${decision.commit.moveIndex.toString().padStart(3, '0')}`,
							gameId: game.sessionId,
							moveIndex: decision.commit.moveIndex,
							capturedAtMs: sampleTimestampMs,
							source: cameraMode === 'browser' ? 'browser-webcam' : 'remote-camera',
							calibrationVersion: calibration.updatedAt,
							occupancyThreshold: calibration.occupancyThreshold ?? DEFAULT_OCCUPANCY_THRESHOLD,
							acceptedAfterSamples: decision.commit.acceptedAfterSamples,
							acceptedAfterMs: decision.commit.acceptedAfterMs,
							previousFingerprint: decision.commit.previousFingerprint,
							nextFingerprint: decision.commit.nextFingerprint,
							occupiedPieces: resolvedOccupiedPieces,
							occupancyScores: [...analysis.scores],
							referenceScores: [...analysis.referenceScores],
							rawFrameDataUrl: snapshotCanvas.toDataURL('image/jpeg', 0.9),
							warpedBoardDataUrl: imageDataFrameToDataUrl(analysis.boardImageData, 'image/jpeg', 0.92),
							rawFrameSize: {
								width: frame.width,
								height: frame.height
							},
							warpSize: {
								width: analysis.boardImageData.width,
								height: analysis.boardImageData.height
							},
							analysisHealth: {
								boardMissing: false,
								referenceMissing: false,
								lowConfidence: false
							},
							changedSquareIndices: decision.commit.changedSquareIndices
						}));
						playMoveRecognizedTone();
						statusLabel = `Move ${decision.commit.moveIndex} captured`;
					} else {
						statusLabel = `${resolvedOccupiedIndices.length} occupied · ${decision.diagnostics.state}`;
					}
				}
			} else {
				moveCaptureEngine.reset('uncalibrated', 'missing-reference');
				gameStore.dispatch(moveCaptureStateUpdated(moveCaptureEngine.getDiagnostics()));
				statusLabel = 'Capture empty board';
			}

			errorMessage = null;
		} catch (error) {
			errorMessage = remoteMixedContentBlocked
				? 'Use device webcam in setup on the secure preview link.'
				: (error instanceof Error ? error.message : 'Live board analysis failed.');
			statusLabel = 'Camera unavailable';
		} finally {
			processing = false;
			scheduleProcessing(LIVE_ANALYSIS_INTERVAL_MS);
		}
	}
</script>

<div class="live-board">
	{#if cameraMode === 'browser'}
		<video
			bind:this={streamVideo}
			class="stream-source"
			autoplay
			muted
			playsinline
			aria-hidden="true"
			onloadeddata={() => {
				streamReady = true;
				errorMessage = null;
				scheduleProcessing(0);
			}}
		></video>
	{:else}
		<img
			bind:this={streamImage}
			class="stream-source"
			src={streamSrc}
			alt=""
			crossorigin="anonymous"
			aria-hidden="true"
			onload={() => {
				streamReady = true;
				errorMessage = null;
				scheduleProcessing(0);
			}}
			onerror={() => {
				streamReady = false;
				statusLabel = 'Camera unavailable';
				errorMessage = remoteMixedContentBlocked
					? 'Use device webcam in setup on the secure preview link.'
					: 'The live camera stream could not be loaded.';
			}}
		/>
	{/if}

	<canvas bind:this={boardCanvas} class="board-canvas" width={WARP_SIZE} height={WARP_SIZE}></canvas>

	{#if setupPrompt}
		<a class="overlay-message action" href={setupHref}>{setupPrompt}</a>
	{:else if errorMessage}
		<a class="overlay-message error action" href={setupHref}>{errorMessage}</a>
	{/if}

	<div class="overlay-label">{statusLabel}</div>
	<canvas bind:this={snapshotCanvas} class="hidden-canvas" aria-hidden="true"></canvas>
</div>

<style>
	.live-board {
		position: relative;
		width: 100%;
		height: 100%;
		border-radius: 12px;
		overflow: hidden;
		background:
			radial-gradient(circle at 20% 20%, rgba(74, 222, 128, 0.2), transparent 42%),
			linear-gradient(160deg, #1f2937, #0f172a 72%);
	}

	.stream-source,
	.hidden-canvas {
		display: none;
	}

	.board-canvas {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.overlay-message,
	.overlay-label {
		position: absolute;
		left: 0.5rem;
		right: 0.5rem;
		text-align: center;
	}

	.overlay-message {
		top: 50%;
		transform: translateY(-50%);
		padding: 0.4rem 0.55rem;
		border-radius: 999px;
		background: rgba(15, 23, 42, 0.82);
		color: #f8fafc;
		font-size: 0.72rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.overlay-message.error {
		color: #fecaca;
	}

	.overlay-message.action {
		text-decoration: none;
	}

	.overlay-label {
		bottom: 0.45rem;
		padding: 0.3rem 0.45rem;
		border-radius: 999px;
		background: rgba(15, 23, 42, 0.72);
		backdrop-filter: blur(6px);
		color: #e5e7eb;
		font-size: 0.66rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}
</style>
