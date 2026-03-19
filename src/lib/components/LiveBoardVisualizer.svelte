<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	import { loadBoardCalibration } from '$lib/board-calibration';
	import { captureImageDataFromElement, loadImageDataFromUrl } from '$lib/vision/browser-images';
	import { analyzeBoardFrame, WARP_SIZE } from '$lib/vision/chessboard';
	import { loadOpenCv } from '$lib/vision/opencv-browser';

	type OpenCvModule = typeof import('@techstark/opencv-js');

	const DEFAULT_CAMERA_URL = 'http://chesscam.local';

	let {
		cameraUrl = DEFAULT_CAMERA_URL
	}: {
		cameraUrl?: string;
	} = $props();

	let streamImage: HTMLImageElement | null = null;
	let snapshotCanvas: HTMLCanvasElement | null = null;
	let boardCanvas: HTMLCanvasElement | null = null;

	let statusLabel = $state('Load board setup');
	let streamReady = $state(false);
	let errorMessage = $state<string | null>(null);
	let streamEnabled = $state(false);

	let cvModule = $state<OpenCvModule | null>(null);
	let referenceImageData: ImageData | null = null;
	let processingIntervalId: ReturnType<typeof setInterval> | null = null;
	let processing = false;
	let calibration = $state<ReturnType<typeof loadBoardCalibration>>(loadBoardCalibration());
	let loadedReferenceUrl = $state<string | null>(null);

	const effectiveCameraUrl = $derived(cameraUrl || calibration?.cameraUrl || DEFAULT_CAMERA_URL);
	const streamSrc = $derived(
		streamEnabled ? `${effectiveCameraUrl.replace(/\/$/, '')}/stream` : ''
	);
	const canAnalyze = $derived(Boolean(calibration?.normalizedQuad));

	onMount(async () => {
		const enableStream = () => {
			if (calibration?.normalizedQuad) {
				streamEnabled = true;
			}
		};

		if (document.readyState === 'complete') {
			enableStream();
		} else {
			window.addEventListener('load', enableStream, { once: true });
		}

		calibration = loadBoardCalibration();
		if (calibration?.referenceImageDataUrl) {
			try {
				referenceImageData = await loadImageDataFromUrl(calibration.referenceImageDataUrl);
				loadedReferenceUrl = calibration.referenceImageDataUrl;
			} catch (error) {
				errorMessage = error instanceof Error ? error.message : 'Failed to load the board reference.';
			}
		}

		processingIntervalId = setInterval(() => {
			void processFrame();
		}, 850);
		void processFrame();

		return () => {
			window.removeEventListener('load', enableStream);
		};
	});

	onDestroy(() => {
		if (processingIntervalId) {
			clearInterval(processingIntervalId);
		}
	});

	function drawOverlay(context: CanvasRenderingContext2D, occupiedIndices: number[]) {
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

		for (const occupiedIndex of occupiedIndices) {
			const row = Math.floor(occupiedIndex / 8);
			const col = occupiedIndex % 8;
			const x = (col + 0.5) * cellSize;
			const y = (row + 0.5) * cellSize;

			context.fillStyle = '#ff6947';
			context.beginPath();
			context.arc(x, y, Math.max(3.5, boardSize * 0.036), 0, Math.PI * 2);
			context.fill();

			context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
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
		if (processing || !boardCanvas || !snapshotCanvas || !streamImage || !streamReady) {
			return;
		}

		calibration = loadBoardCalibration();
		if (!calibration) {
			statusLabel = 'Open settings';
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
				return;
			}

			const frame = captureImageDataFromElement(streamImage, snapshotCanvas);
			const analysis = analyzeBoardFrame(
				activeCv,
				frame,
				calibration.normalizedQuad,
				referenceImageData
			);
			const context = boardCanvas.getContext('2d');
			if (!context) {
				throw new Error('2D canvas is unavailable.');
			}

			boardCanvas.width = WARP_SIZE;
			boardCanvas.height = WARP_SIZE;
			context.putImageData(analysis.boardImageData, 0, 0);

			if (referenceImageData) {
				drawOverlay(context, analysis.occupiedIndices);
				statusLabel = `${analysis.occupiedIndices.length} occupied`;
			} else {
				statusLabel = 'Capture empty board';
			}

			errorMessage = null;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Live board analysis failed.';
			statusLabel = 'Camera unavailable';
		} finally {
			processing = false;
		}
	}
</script>

<div class="live-board">
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
			void processFrame();
		}}
		onerror={() => {
			streamReady = false;
			statusLabel = 'Camera unavailable';
			errorMessage = 'The live camera stream could not be loaded.';
		}}
	/>

	<canvas bind:this={boardCanvas} class="board-canvas" width={WARP_SIZE} height={WARP_SIZE}></canvas>

	{#if !canAnalyze}
		<div class="overlay-message">Calibrate board</div>
	{:else if errorMessage}
		<div class="overlay-message error">{errorMessage}</div>
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
