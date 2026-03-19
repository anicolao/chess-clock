<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { base } from '$app/paths';

	import { type CameraMode, loadBoardCalibration } from '$lib/board-calibration';
	import { captureImageDataFromElement, loadImageDataFromUrl } from '$lib/vision/browser-images';
	import { analyzeBoardFrame, WARP_SIZE } from '$lib/vision/chessboard';
	import { loadOpenCv } from '$lib/vision/opencv-browser';

	type OpenCvModule = typeof import('@techstark/opencv-js');

	const DEFAULT_CAMERA_URL = 'http://chesscam.local';

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
	let processingIntervalId: ReturnType<typeof setInterval> | null = null;
	let processing = false;
	let calibration = $state<ReturnType<typeof loadBoardCalibration>>(loadBoardCalibration());
	let loadedReferenceUrl = $state<string | null>(null);

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
				void startBrowserCamera();
			} else {
				streamEnabled = true;
			}
		}

		processingIntervalId = setInterval(() => {
			void processFrame();
		}, 850);
		void processFrame();
	});

	onDestroy(() => {
		if (processingIntervalId) {
			clearInterval(processingIntervalId);
		}
		stopBrowserCamera();
	});

	function stopBrowserCamera() {
		mediaStream?.getTracks().forEach((track) => track.stop());
		mediaStream = null;
	}

	async function startBrowserCamera() {
		stopBrowserCamera();
		streamEnabled = true;
		streamReady = false;
		errorMessage = null;

		if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
			errorMessage = 'Browser camera requires a secure context.';
			statusLabel = 'Camera unavailable';
			return;
		}

		try {
			mediaStream = await navigator.mediaDevices.getUserMedia({
				video: {
					facingMode: { ideal: 'environment' },
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
		}
	}

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
		const source = cameraMode === 'browser' ? streamVideo : streamImage;
		if (processing || !boardCanvas || !snapshotCanvas || !source || !streamReady) {
			return;
		}

		calibration = loadBoardCalibration();
		if (!calibration) {
			statusLabel = 'Set up board';
			return;
		}
		cameraMode = calibration.cameraMode;

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

			const frame = captureImageDataFromElement(source, snapshotCanvas);
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
			errorMessage = remoteMixedContentBlocked
				? 'Use device webcam in setup on the secure preview link.'
				: (error instanceof Error ? error.message : 'Live board analysis failed.');
			statusLabel = 'Camera unavailable';
		} finally {
			processing = false;
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
				void processFrame();
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
				void processFrame();
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
