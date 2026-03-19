<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	import {
		clearBoardCalibration,
		type CameraMode,
		cloneQuad,
		createDefaultQuad,
		loadBoardCalibration,
		saveBoardCalibration,
		type BoardCalibration
	} from '$lib/board-calibration';
	import { captureImageDataFromElement, imageDataToDataUrl, loadImageDataFromUrl } from '$lib/vision/browser-images';
	import BoardDetectorWorker from '$lib/workers/board-detector.worker?worker&inline';
	import {
		analyzeBoardFrame,
		localizeChessboardFromImageDataFast,
		normalizeQuad,
		WARP_SIZE
	} from '$lib/vision/chessboard';
	import { loadOpenCv } from '$lib/vision/opencv-browser';

	type OpenCvModule = typeof import('@techstark/opencv-js');
	const HANDLE_RADIUS = 0.034;
	const HANDLE_GRAB_RADIUS = 0.14;
	const SETUP_ANALYSIS_MAX_DIMENSION = 448;
	const SETUP_REFERENCE_MAX_DIMENSION = 720;
	const SETUP_AUTODETECT_ATTEMPTS = 6;
	const SETUP_AUTODETECT_INTERVAL_MS = 200;
	const DEFAULT_CAMERA_URL = 'http://chesscam.local';
	const BROWSER_CAMERA_NOTICE = 'Browser camera works from secure preview links. Remote http camera URLs will be blocked on https.';

	let {
		initialCameraUrl = DEFAULT_CAMERA_URL
	}: {
		initialCameraUrl?: string;
	} = $props();

	let streamImage = $state<HTMLImageElement | null>(null);
	let streamVideo = $state<HTMLVideoElement | null>(null);
	let snapshotCanvas = $state<HTMLCanvasElement | null>(null);
	let previewCanvas = $state<HTMLCanvasElement | null>(null);

	let cameraMode = $state<CameraMode>('browser');
	let cameraUrl = $state(DEFAULT_CAMERA_URL);
	let normalizedQuad = $state(createDefaultQuad());
	let referenceImageDataUrl = $state<string | null>(null);
	let detectedBoardScore = $state<number | null>(null);
	let cameraFrameReady = $state(false);
	let busyLabel = $state<string | null>(null);
	let statusMessage = $state('Load the live board, fine tune the quad, then capture an empty-board reference.');
	let errorMessage = $state<string | null>(null);
	let savedAt = $state<number | null>(null);
	let dragHandleIndex = $state<number | null>(null);
	let streamEnabled = $state(false);

	let cvModule: OpenCvModule | null = null;
	let referenceImageData: ImageData | null = null;
	let mediaStream: MediaStream | null = null;
	let cvWarmupPromise: Promise<OpenCvModule | null> | null = null;
	let autodetectTimeoutId: number | null = null;
	let autodetectAttemptsRemaining = 0;
	let detectionWorker: Worker | null = null;
	let detectionRequestId = 0;
	const pendingDetections = new Map<
		number,
		{
			resolve: (detection: ReturnType<typeof localizeChessboardFromImageDataFast>) => void;
			reject: (error: Error) => void;
		}
	>();

	const quadSegments = $derived([
		[normalizedQuad[0], normalizedQuad[1]],
		[normalizedQuad[1], normalizedQuad[2]],
		[normalizedQuad[2], normalizedQuad[3]],
		[normalizedQuad[3], normalizedQuad[0]]
	]);
	const streamSrc = $derived(
		streamEnabled && cameraMode === 'remote' && cameraUrl
			? `${cameraUrl.replace(/\/$/, '')}/stream`
			: ''
	);
	const hasReference = $derived(Boolean(referenceImageDataUrl));
	const isRemoteMixedContentBlocked = $derived(
		cameraMode === 'remote'
			&& typeof window !== 'undefined'
			&& window.location.protocol === 'https:'
			&& /^http:\/\//i.test(cameraUrl)
	);

	$effect(() => {
		if (cameraMode === 'browser' && streamVideo && mediaStream && streamVideo.srcObject !== mediaStream) {
			streamVideo.srcObject = mediaStream;
			void streamVideo.play().catch(() => {});
		}
	});

	onMount(async () => {
		if (typeof Worker !== 'undefined') {
			detectionWorker = new BoardDetectorWorker();
			detectionWorker.onmessage = (
				event: MessageEvent<
					| {
						id: number;
						type: 'detect-result';
						detection: ReturnType<typeof localizeChessboardFromImageDataFast>;
					}
					| {
						id: number;
						type: 'detect-error';
						error: string;
					}
				>
			) => {
				const pendingDetection = pendingDetections.get(event.data.id);
				if (!pendingDetection) return;

				pendingDetections.delete(event.data.id);
				if (event.data.type === 'detect-result') {
					pendingDetection.resolve(event.data.detection);
					return;
				}

				pendingDetection.reject(new Error(event.data.error));
			};
		}

		const savedCalibration = loadBoardCalibration();
		if (savedCalibration) {
			cameraMode = savedCalibration.cameraMode;
			cameraUrl = initialCameraUrl !== DEFAULT_CAMERA_URL
				? initialCameraUrl
				: (savedCalibration.cameraUrl || initialCameraUrl);
			normalizedQuad = cloneQuad(savedCalibration.normalizedQuad);
			referenceImageDataUrl = savedCalibration.referenceImageDataUrl;
			savedAt = savedCalibration.updatedAt;
		} else {
			cameraMode = initialCameraUrl !== DEFAULT_CAMERA_URL ? 'remote' : 'browser';
			cameraUrl = initialCameraUrl;
		}

		if (referenceImageDataUrl) {
			referenceImageData = await loadReferenceImage(referenceImageDataUrl);
		}

		statusMessage = cameraMode === 'browser'
			? 'Tap Start webcam, then drag the corners or run auto-detect.'
			: 'Connect the remote camera, then drag the corners or run auto-detect.';
	});

	onDestroy(() => {
		for (const pendingDetection of pendingDetections.values()) {
			pendingDetection.reject(new Error('Board detector worker was stopped.'));
		}
		pendingDetections.clear();
		detectionWorker?.terminate();
		detectionWorker = null;
		if (autodetectTimeoutId) {
			clearTimeout(autodetectTimeoutId);
		}
		stopBrowserCamera();
	});

	function stopBrowserCamera() {
		clearAutodetectSession();
		mediaStream?.getTracks().forEach((track) => track.stop());
		mediaStream = null;
	}

	async function waitForNextPaint() {
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	}

	async function loadReferenceImage(dataUrl: string) {
		try {
			return await loadImageDataFromUrl(dataUrl);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to load the saved empty-board reference.';
			return null;
		}
	}

	function clearAutodetectSession() {
		if (autodetectTimeoutId) {
			clearTimeout(autodetectTimeoutId);
			autodetectTimeoutId = null;
		}
		autodetectAttemptsRemaining = 0;
	}

	async function detectBoardInWorker(frame: ImageData, fallbackCv: OpenCvModule) {
		if (!detectionWorker) {
			return localizeChessboardFromImageDataFast(fallbackCv, frame);
		}

		return new Promise<ReturnType<typeof localizeChessboardFromImageDataFast>>((resolve, reject) => {
			const requestId = detectionRequestId++;
			pendingDetections.set(requestId, {
				resolve,
				reject
			});
			detectionWorker!.postMessage({
				id: requestId,
				type: 'detect',
				imageData: frame
			});
		});
	}

	function updateHandlePosition(index: number, clientX: number, clientY: number) {
		const source = cameraMode === 'browser' ? streamVideo : streamImage;
		if (!source) return;
		const rect = source.getBoundingClientRect();
		if (!rect.width || !rect.height) return;

		const nextX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		const nextY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
		const nextQuad = cloneQuad(normalizedQuad);
		nextQuad[index] = { x: nextX, y: nextY };
		normalizedQuad = nextQuad;
		detectedBoardScore = null;
		errorMessage = null;
		statusMessage = `Adjusting corner ${index + 1}. Save when the quad matches the board.`;
	}

	function findNearestHandleIndex(clientX: number, clientY: number) {
		const source = cameraMode === 'browser' ? streamVideo : streamImage;
		if (!source) return null;

		const rect = source.getBoundingClientRect();
		if (!rect.width || !rect.height) return null;

		const normalizedX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		const normalizedY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));

		let nearestIndex: number | null = null;
		let nearestDistance = Number.POSITIVE_INFINITY;

		for (const [index, point] of normalizedQuad.entries()) {
			const distance = Math.hypot(point.x - normalizedX, point.y - normalizedY);
			if (distance < nearestDistance) {
				nearestDistance = distance;
				nearestIndex = index;
			}
		}

		return nearestDistance <= HANDLE_GRAB_RADIUS ? nearestIndex : null;
	}

	function beginDrag(index: number, event: PointerEvent) {
		dragHandleIndex = index;
		event.preventDefault();
		event.stopPropagation();
		(event.currentTarget as SVGCircleElement | null)?.ownerSVGElement?.setPointerCapture?.(event.pointerId);
		updateHandlePosition(index, event.clientX, event.clientY);
	}

	function beginOverlayDrag(event: PointerEvent) {
		if (dragHandleIndex !== null) return;

		const nearestHandleIndex = findNearestHandleIndex(event.clientX, event.clientY);
		if (nearestHandleIndex === null) return;

		dragHandleIndex = nearestHandleIndex;
		event.preventDefault();
		(event.currentTarget as SVGSVGElement | null)?.setPointerCapture?.(event.pointerId);
		updateHandlePosition(nearestHandleIndex, event.clientX, event.clientY);
	}

	function continueDrag(event: PointerEvent) {
		if (dragHandleIndex === null) return;
		updateHandlePosition(dragHandleIndex, event.clientX, event.clientY);
	}

	function endDrag(event: PointerEvent) {
		if (dragHandleIndex === null) return;
		(event.currentTarget as SVGElement | null)?.releasePointerCapture?.(event.pointerId);
		dragHandleIndex = null;
	}

	function captureFrame(maxDimension = SETUP_ANALYSIS_MAX_DIMENSION) {
		const source = cameraMode === 'browser' ? streamVideo : streamImage;
		if (!source || !snapshotCanvas) {
			throw new Error('Live camera frame is unavailable.');
		}

		try {
			return captureImageDataFromElement(source, snapshotCanvas, {
				maxDimension
			});
		} catch (error) {
			throw new Error(
				error instanceof Error
					? `${error.message} The camera stream must allow cross-origin canvas access.`
					: 'The camera stream must allow cross-origin canvas access.'
			);
		}
	}

	function selectSource(mode: CameraMode) {
		clearAutodetectSession();
		cameraMode = mode;
		streamEnabled = false;
		cameraFrameReady = false;
		errorMessage = null;
		statusMessage = mode === 'browser'
			? 'Start the browser camera, then fine tune the quad and capture an empty board.'
			: BROWSER_CAMERA_NOTICE;

		if (mode === 'browser') {
			statusMessage = 'Tap Start webcam to begin the browser camera.';
		} else {
			stopBrowserCamera();
			statusMessage = 'Tap Connect camera to start the remote stream.';
		}
	}

	async function startBrowserCamera() {
		stopBrowserCamera();
		streamEnabled = true;
		busyLabel = 'Opening camera';
		errorMessage = null;
		cameraFrameReady = false;
		statusMessage = 'Requesting access to the device camera.';

		if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
			errorMessage = 'Browser camera requires a secure context with camera permissions.';
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
				statusMessage = 'Browser camera connected. Drag a corner handle or run auto-detect.';
				void warmCvModule();
			} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to open the browser camera.';
			statusMessage = 'Camera permission or access failed.';
		} finally {
			busyLabel = null;
		}
	}

	function enableRemoteCamera() {
		stopBrowserCamera();
		streamEnabled = true;
		cameraFrameReady = false;
		if (isRemoteMixedContentBlocked) {
			errorMessage = BROWSER_CAMERA_NOTICE;
		}
		statusMessage = isRemoteMixedContentBlocked
			? BROWSER_CAMERA_NOTICE
			: 'Connecting to the remote camera stream.';
	}

	async function ensureCvModule() {
		if (cvModule) return cvModule;

		try {
			busyLabel = 'Loading vision';
			statusMessage = 'Loading OpenCV so the board can be analyzed.';
			await waitForNextPaint();
			cvModule = await loadOpenCv();
			statusMessage = 'Vision ready. You can auto-detect the board or drag the corners manually.';
			return cvModule;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to load OpenCV.';
			return null;
		} finally {
			if (busyLabel === 'Loading vision') {
				busyLabel = null;
			}
		}
	}

	async function warmCvModule() {
		if (cvModule) return cvModule;
		if (cvWarmupPromise) return cvWarmupPromise;

		cvWarmupPromise = loadOpenCv()
			.then((loadedCv) => {
				cvModule = loadedCv;
				if (busyLabel === 'Detecting board' && autodetectAttemptsRemaining > 0) {
					statusMessage = 'Vision ready. Scanning live frames for the board.';
				}
				return loadedCv;
			})
			.catch((error) => {
				errorMessage = error instanceof Error ? error.message : 'Failed to load OpenCV.';
				return null;
			})
			.finally(() => {
				cvWarmupPromise = null;
			});

		return cvWarmupPromise;
	}

	function scheduleAutodetectTick(delayMs: number) {
		if (autodetectTimeoutId) {
			clearTimeout(autodetectTimeoutId);
		}
		autodetectTimeoutId = window.setTimeout(() => {
			void runAutodetectTick();
		}, delayMs);
	}

	async function runAutodetectTick() {
		if (autodetectAttemptsRemaining <= 0) {
			busyLabel = null;
			statusMessage = 'No chessboard candidate was found in the live frames. Drag the corners manually or try again.';
			clearAutodetectSession();
			return;
		}

		if (!cameraFrameReady || dragHandleIndex !== null) {
			scheduleAutodetectTick(SETUP_AUTODETECT_INTERVAL_MS);
			return;
		}

		const activeCv = cvModule ?? await warmCvModule();
		if (!activeCv) {
			busyLabel = null;
			clearAutodetectSession();
			return;
		}

		const attemptIndex = SETUP_AUTODETECT_ATTEMPTS - autodetectAttemptsRemaining + 1;
		statusMessage = `Scanning live frame ${attemptIndex} of ${SETUP_AUTODETECT_ATTEMPTS} for the board.`;
		await waitForNextPaint();

		try {
			const frame = captureFrame(SETUP_ANALYSIS_MAX_DIMENSION);
			const detection = await detectBoardInWorker(frame, activeCv);
			if (detection) {
				normalizedQuad = normalizeQuad(detection.quad, frame.width, frame.height);
				detectedBoardScore = detection.score;
				statusMessage = `Board detected from ${detection.selectedCount} square candidates.`;
				busyLabel = null;
				clearAutodetectSession();
				await renderPreview();
				return;
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Board detection failed.';
			busyLabel = null;
			clearAutodetectSession();
			return;
		}

		autodetectAttemptsRemaining -= 1;
		scheduleAutodetectTick(SETUP_AUTODETECT_INTERVAL_MS);
	}

	async function autodetectBoard() {
		errorMessage = null;
		statusMessage = 'Loading OpenCV so the board can be analyzed.';

		clearAutodetectSession();
		autodetectAttemptsRemaining = SETUP_AUTODETECT_ATTEMPTS;
		busyLabel = 'Detecting board';
		void warmCvModule();
		scheduleAutodetectTick(0);
	}

	async function captureReference() {
		busyLabel = 'Capturing empty board';
		errorMessage = null;
		statusMessage = 'Capturing the empty-board reference for occupancy tracking.';

		try {
			await waitForNextPaint();
			const source = cameraMode === 'browser' ? streamVideo : streamImage;
			if (!source || !snapshotCanvas) {
				throw new Error('Live camera frame is unavailable.');
			}

			referenceImageDataUrl = imageDataToDataUrl(source, snapshotCanvas, 'image/jpeg', 0.9, {
				maxDimension: SETUP_REFERENCE_MAX_DIMENSION
			});
			referenceImageData = await loadReferenceImage(referenceImageDataUrl);
			statusMessage = 'Empty-board reference captured. Save calibration to use it from the clock.';
			await renderPreview();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to capture the empty-board reference.';
		} finally {
			busyLabel = null;
		}
	}

	function saveCalibrationToStorage() {
		const calibration: BoardCalibration = {
			cameraMode,
			cameraUrl,
			normalizedQuad,
			referenceImageDataUrl,
			updatedAt: Date.now()
		};

		saveBoardCalibration(calibration);
		savedAt = calibration.updatedAt;
		statusMessage = 'Calibration saved locally. The clock page will use this board view.';
		errorMessage = null;
	}

	function connectCamera() {
		if (cameraMode === 'browser') {
			void startBrowserCamera();
			return;
		}

		enableRemoteCamera();
	}

	function resetCalibration() {
		normalizedQuad = createDefaultQuad();
		referenceImageDataUrl = null;
		referenceImageData = null;
		detectedBoardScore = null;
		savedAt = null;
		clearBoardCalibration();
		statusMessage = 'Saved calibration cleared. Adjust the quad and capture a new empty-board reference.';
		errorMessage = null;
	}

	function drawOccupancyOverlay(context: CanvasRenderingContext2D, occupiedIndices: number[]) {
		const boardSize = context.canvas.width;
		const cellSize = boardSize / 8;

		context.strokeStyle = 'rgba(237, 240, 227, 0.36)';
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

			context.fillStyle = '#ff6b57';
			context.beginPath();
			context.arc(x, y, Math.max(4, boardSize * 0.035), 0, Math.PI * 2);
			context.fill();

			context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
			context.lineWidth = 1.5;
			context.stroke();
		}
	}

	async function renderPreview() {
		if (!previewCanvas || !cameraFrameReady) return;

		const context = previewCanvas.getContext('2d');
		if (!context) return;

		context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

		if (!referenceImageDataUrl) {
			context.fillStyle = '#0f172a';
			context.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
			context.fillStyle = '#cbd5e1';
			context.font = '14px sans-serif';
			context.textAlign = 'center';
			context.fillText('Capture empty board to preview occupancy', previewCanvas.width / 2, previewCanvas.height / 2);
			return;
		}

		await waitForNextPaint();
		const activeCv = await ensureCvModule();
		if (!activeCv) return;
		const frame = captureFrame(SETUP_ANALYSIS_MAX_DIMENSION);
		const analysis = analyzeBoardFrame(activeCv, frame, normalizedQuad, referenceImageData);
		previewCanvas.width = WARP_SIZE;
		previewCanvas.height = WARP_SIZE;
		context.putImageData(analysis.boardImageData, 0, 0);
		drawOccupancyOverlay(context, analysis.occupiedIndices);
	}

	function formatTime(timestamp: number | null) {
		if (!timestamp) return 'Not saved';
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(timestamp);
	}
</script>

<section class="setup-panel">
	<div class="panel-header">
		<div>
			<h2>Board Setup</h2>
			<p>Adjust the live board crop and lock in an empty-board reference for occupancy tracking.</p>
		</div>
		<div class="status-chip">{busyLabel ?? 'Ready'}</div>
	</div>

	<div class="input-row">
		<p class="field-label">Video Source</p>
		<div class="source-row">
			<button
				class="source-btn {cameraMode === 'browser' ? 'active' : ''}"
				type="button"
				onclick={() => selectSource('browser')}
			>
				Device webcam
			</button>
			<button
				class="source-btn {cameraMode === 'remote' ? 'active' : ''}"
				type="button"
				onclick={() => selectSource('remote')}
			>
				Remote camera
			</button>
		</div>
	</div>

	<div class="input-row">
		<label for="camera-url">
			{cameraMode === 'browser' ? 'Browser camera' : 'Camera URL'}
		</label>
		<div class="camera-url-row">
			{#if cameraMode === 'remote'}
				<input
					id="camera-url"
					type="url"
					bind:value={cameraUrl}
					placeholder="http://chesscam.local"
					autocomplete="off"
				/>
			{:else}
				<p class="camera-help">{BROWSER_CAMERA_NOTICE}</p>
			{/if}
			<button class="action-btn" type="button" onclick={connectCamera}>
				{cameraMode === 'browser' ? 'Start webcam' : 'Connect camera'}
			</button>
		</div>
	</div>

	<div class="workspace">
		<div class="stream-card">
			<div class="card-title">
				<span>Live Frame</span>
				<span>{cameraFrameReady ? 'Streaming' : 'Waiting for camera'}</span>
			</div>

			<div class="stream-stage">
				{#if cameraMode === 'browser'}
					<video
						bind:this={streamVideo}
						class="stream-image"
						autoplay
						muted
						playsinline
						onloadeddata={() => {
							cameraFrameReady = true;
							statusMessage = 'Live camera ready. Drag the corner handles or run auto-detect.';
							errorMessage = null;
							void warmCvModule();
						}}
					></video>
				{:else}
					<img
						bind:this={streamImage}
						class="stream-image"
						src={streamSrc}
						alt="Live chessboard camera frame"
						crossorigin="anonymous"
						onload={() => {
							cameraFrameReady = true;
							statusMessage = 'Remote camera ready. Drag the corner handles or run auto-detect.';
							errorMessage = null;
							void warmCvModule();
						}}
						onerror={() => {
							cameraFrameReady = false;
							errorMessage = isRemoteMixedContentBlocked
								? BROWSER_CAMERA_NOTICE
								: 'The live camera stream could not be loaded.';
						}}
					/>
				{/if}

				{#if cameraFrameReady}
					<svg
						class="quad-overlay"
						viewBox="0 0 1 1"
						preserveAspectRatio="none"
						onpointerdown={beginOverlayDrag}
						onpointermove={continueDrag}
						onpointerup={endDrag}
						onpointercancel={endDrag}
						role="presentation"
					>
						<polygon
							points={normalizedQuad.map((point) => `${point.x},${point.y}`).join(' ')}
							fill="rgba(74, 222, 128, 0.18)"
							stroke="#4ade80"
							stroke-width="0.0075"
						/>

						{#each quadSegments as [start, end]}
							<line
								x1={start.x}
								y1={start.y}
								x2={end.x}
								y2={end.y}
								stroke="#fef08a"
								stroke-width="0.006"
								stroke-dasharray="0.025 0.012"
							/>
						{/each}

						{#each normalizedQuad as point, index}
							<circle
								cx={point.x}
								cy={point.y}
								r={HANDLE_RADIUS}
								fill="#0f172a"
								stroke="#ffffff"
								stroke-width="0.007"
								class="handle"
								role="slider"
								aria-label={`Board corner ${index + 1}`}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={Math.round(((point.x + point.y) / 2) * 100)}
								tabindex="-1"
								onpointerdown={(event) => beginDrag(index, event)}
							/>
						{/each}
					</svg>
				{/if}
			</div>

			<p class="stream-help">
				Drag a corner dot, or touch near a corner to move it. Auto-detect will try to snap the quad to the board.
			</p>

			{#if errorMessage}
				<p class="inline-notice error">{errorMessage}</p>
			{:else}
				<p class="inline-notice">{statusMessage}</p>
			{/if}

			<div class="card-actions">
				<button class="action-btn primary" type="button" onclick={autodetectBoard} disabled={!cameraFrameReady || !!busyLabel}>
					Auto-detect board
				</button>
				<button class="action-btn" type="button" onclick={captureReference} disabled={!cameraFrameReady || !!busyLabel}>
					Capture empty board
				</button>
				<button class="action-btn" type="button" onclick={saveCalibrationToStorage}>
					Save calibration
				</button>
				<button class="action-btn subtle" type="button" onclick={resetCalibration}>
					Clear saved data
				</button>
			</div>
		</div>

		<div class="preview-card">
			<div class="card-title">
				<span>Board Preview</span>
				<span>{hasReference ? 'Live occupancy' : 'Warp only'}</span>
			</div>

			<canvas bind:this={previewCanvas} class="preview-canvas" width={WARP_SIZE} height={WARP_SIZE}></canvas>
			<button class="action-btn" type="button" onclick={renderPreview} disabled={!cameraFrameReady || !!busyLabel}>
				Refresh preview
			</button>

			<div class="detail-list">
				<div>
					<span>Detection score</span>
					<strong>{detectedBoardScore === null ? 'Manual / saved' : detectedBoardScore.toFixed(1)}</strong>
				</div>
				<div>
					<span>Reference frame</span>
					<strong>{hasReference ? 'Captured' : 'Missing'}</strong>
				</div>
				<div>
					<span>Last saved</span>
					<strong>{formatTime(savedAt)}</strong>
				</div>
			</div>
		</div>
	</div>

	<canvas bind:this={snapshotCanvas} class="hidden-canvas" aria-hidden="true"></canvas>
</section>

<style>
	.setup-panel {
		margin-top: 3rem;
		padding: 1.5rem;
		border-radius: 24px;
		background:
			linear-gradient(160deg, rgba(27, 35, 48, 0.98), rgba(16, 22, 31, 0.96)),
			radial-gradient(circle at top left, rgba(74, 222, 128, 0.14), transparent 45%);
		border: 1px solid rgba(148, 163, 184, 0.2);
		box-shadow: 0 22px 60px rgba(0, 0, 0, 0.32);
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: flex-start;
		margin-bottom: 1.25rem;
	}

	.panel-header h2 {
		margin: 0 0 0.35rem;
		font-size: 1.5rem;
	}

	.panel-header p {
		margin: 0;
		max-width: 44rem;
		color: #cbd5e1;
	}

	.status-chip {
		padding: 0.45rem 0.8rem;
		border-radius: 999px;
		background: rgba(71, 85, 105, 0.46);
		color: #e2e8f0;
		font-size: 0.85rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.input-row {
		margin-bottom: 1.5rem;
	}

	.input-row label {
		display: block;
		margin-bottom: 0.45rem;
		font-size: 0.9rem;
		color: #cbd5e1;
	}

	.field-label {
		margin: 0 0 0.45rem;
		font-size: 0.9rem;
		color: #cbd5e1;
	}

	.input-row input {
		width: min(100%, 32rem);
		padding: 0.8rem 0.95rem;
		border-radius: 14px;
		border: 1px solid rgba(148, 163, 184, 0.28);
		background: rgba(15, 23, 42, 0.8);
		color: #f8fafc;
		font-size: 1rem;
	}

	.camera-url-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}

	.camera-url-row input {
		flex: 1 1 20rem;
	}

	.camera-help {
		flex: 1 1 20rem;
		margin: 0;
		color: #cbd5e1;
	}

	.source-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.source-btn {
		padding: 0.72rem 1rem;
		border-radius: 999px;
		border: 1px solid rgba(148, 163, 184, 0.22);
		background: rgba(15, 23, 42, 0.7);
		color: #e2e8f0;
		font-weight: 600;
		cursor: pointer;
	}

	.source-btn.active {
		background: rgba(74, 222, 128, 0.18);
		border-color: rgba(74, 222, 128, 0.64);
		color: #d1fae5;
	}

	.workspace {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.8fr);
		gap: 1.25rem;
	}

	.stream-card,
	.preview-card {
		padding: 1rem;
		border-radius: 20px;
		background: rgba(15, 23, 42, 0.68);
		border: 1px solid rgba(148, 163, 184, 0.16);
	}

	.card-title {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.85rem;
		font-size: 0.88rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #94a3b8;
	}

	.stream-stage {
		position: relative;
		border-radius: 18px;
		overflow: hidden;
		background:
			linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 59, 0.92));
		aspect-ratio: 4 / 3;
	}

	.stream-image,
	.quad-overlay {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.stream-image {
		background: rgba(15, 23, 42, 0.9);
		pointer-events: none;
	}

	.quad-overlay {
		touch-action: none;
		pointer-events: auto;
	}

	.handle {
		cursor: grab;
		filter: drop-shadow(0 0 8px rgba(15, 23, 42, 0.85));
	}

	.stream-help {
		margin: 0.8rem 0 0;
		color: #cbd5e1;
		font-size: 0.92rem;
	}

	.inline-notice {
		margin: 0.8rem 0 0;
		padding: 0.75rem 0.9rem;
		border-radius: 14px;
		background: rgba(30, 41, 59, 0.72);
		color: #dbeafe;
		font-size: 0.92rem;
	}

	.inline-notice.error {
		background: rgba(127, 29, 29, 0.28);
		color: #fecaca;
	}

	.card-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.action-btn {
		padding: 0.72rem 1rem;
		border-radius: 999px;
		border: 1px solid rgba(148, 163, 184, 0.22);
		background: rgba(30, 41, 59, 0.84);
		color: #f8fafc;
		font-weight: 600;
		cursor: pointer;
	}

	.action-btn.primary {
		background: linear-gradient(135deg, #4ade80, #22c55e);
		border-color: transparent;
		color: #052e16;
	}

	.action-btn.subtle {
		color: #cbd5e1;
	}

	.action-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.preview-canvas {
		width: 100%;
		aspect-ratio: 1;
		border-radius: 18px;
		background: #0f172a;
		image-rendering: auto;
	}

	.detail-list {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.detail-list div {
		padding: 0.75rem;
		border-radius: 14px;
		background: rgba(30, 41, 59, 0.7);
	}

	.detail-list span {
		display: block;
		margin-bottom: 0.35rem;
		font-size: 0.76rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #94a3b8;
	}

	.detail-list strong {
		font-size: 0.98rem;
		color: #f8fafc;
	}

	.hidden-canvas {
		display: none;
	}

	@media (max-width: 960px) {
		.workspace {
			grid-template-columns: 1fr;
		}

		.detail-list {
			grid-template-columns: 1fr;
		}

		.panel-header {
			flex-direction: column;
		}
	}
</style>
