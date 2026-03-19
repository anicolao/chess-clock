<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	import {
		clearBoardCalibration,
		cloneQuad,
		createDefaultQuad,
		loadBoardCalibration,
		saveBoardCalibration,
		type BoardCalibration
	} from '$lib/board-calibration';
	import { captureImageDataFromElement, imageDataToDataUrl, loadImageDataFromUrl } from '$lib/vision/browser-images';
	import {
		analyzeBoardFrame,
		localizeChessboardFromImageData,
		normalizeQuad,
		WARP_SIZE
	} from '$lib/vision/chessboard';
	import { loadOpenCv } from '$lib/vision/opencv-browser';

	type OpenCvModule = typeof import('@techstark/opencv-js');

	const HANDLE_RADIUS = 0.024;
	const DEFAULT_CAMERA_URL = 'http://chesscam.local';

	let {
		initialCameraUrl = DEFAULT_CAMERA_URL
	}: {
		initialCameraUrl?: string;
	} = $props();

	let streamImage: HTMLImageElement | null = null;
	let snapshotCanvas: HTMLCanvasElement | null = null;
	let previewCanvas: HTMLCanvasElement | null = null;

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
	let previewIntervalId: ReturnType<typeof setInterval> | null = null;
	let previewPending = false;

	const quadSegments = $derived([
		[normalizedQuad[0], normalizedQuad[1]],
		[normalizedQuad[1], normalizedQuad[2]],
		[normalizedQuad[2], normalizedQuad[3]],
		[normalizedQuad[3], normalizedQuad[0]]
	]);
	const streamSrc = $derived(
		streamEnabled && cameraUrl ? `${cameraUrl.replace(/\/$/, '')}/stream` : ''
	);
	const hasReference = $derived(Boolean(referenceImageDataUrl));

	onMount(async () => {
		let shouldAutoStartStream = initialCameraUrl !== DEFAULT_CAMERA_URL;
		const enableStream = () => {
			if (shouldAutoStartStream) {
				streamEnabled = true;
			}
		};

		const savedCalibration = loadBoardCalibration();
		if (savedCalibration) {
			shouldAutoStartStream = true;
			cameraUrl = initialCameraUrl !== DEFAULT_CAMERA_URL
				? initialCameraUrl
				: (savedCalibration.cameraUrl || initialCameraUrl);
			normalizedQuad = cloneQuad(savedCalibration.normalizedQuad);
			referenceImageDataUrl = savedCalibration.referenceImageDataUrl;
			savedAt = savedCalibration.updatedAt;
		} else {
			cameraUrl = initialCameraUrl;
		}

		if (document.readyState === 'complete') {
			enableStream();
		} else {
			window.addEventListener('load', enableStream, { once: true });
		}

		if (referenceImageDataUrl) {
			referenceImageData = await loadReferenceImage(referenceImageDataUrl);
		}

		previewIntervalId = setInterval(() => {
			void refreshPreview();
		}, 900);
		void refreshPreview();

		return () => {
			window.removeEventListener('load', enableStream);
		};
	});

	onDestroy(() => {
		if (previewIntervalId) {
			clearInterval(previewIntervalId);
		}
	});

	async function loadReferenceImage(dataUrl: string) {
		try {
			return await loadImageDataFromUrl(dataUrl);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to load the saved empty-board reference.';
			return null;
		}
	}

	function updateHandlePosition(index: number, clientX: number, clientY: number) {
		if (!streamImage) return;
		const rect = streamImage.getBoundingClientRect();
		if (!rect.width || !rect.height) return;

		const nextX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		const nextY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
		const nextQuad = cloneQuad(normalizedQuad);
		nextQuad[index] = { x: nextX, y: nextY };
		normalizedQuad = nextQuad;
		detectedBoardScore = null;
		errorMessage = null;
		void refreshPreview();
	}

	function beginDrag(index: number, event: PointerEvent) {
		dragHandleIndex = index;
		event.preventDefault();
		(event.currentTarget as SVGCircleElement | null)?.setPointerCapture(event.pointerId);
		updateHandlePosition(index, event.clientX, event.clientY);
	}

	function continueDrag(event: PointerEvent) {
		if (dragHandleIndex === null) return;
		updateHandlePosition(dragHandleIndex, event.clientX, event.clientY);
	}

	function endDrag(event: PointerEvent) {
		if (dragHandleIndex === null) return;
		(event.currentTarget as SVGSVGElement | null)?.releasePointerCapture?.(event.pointerId);
		dragHandleIndex = null;
	}

	function captureFrame() {
		if (!streamImage || !snapshotCanvas) {
			throw new Error('Live camera frame is unavailable.');
		}

		try {
			return captureImageDataFromElement(streamImage, snapshotCanvas);
		} catch (error) {
			throw new Error(
				error instanceof Error
					? `${error.message} The camera stream must allow cross-origin canvas access.`
					: 'The camera stream must allow cross-origin canvas access.'
			);
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

	async function autodetectBoard() {
		const activeCv = await ensureCvModule();
		if (!activeCv) {
			return;
		}

		busyLabel = 'Detecting board';
		errorMessage = null;

		try {
			const frame = captureFrame();
			const detection = localizeChessboardFromImageData(activeCv, frame);
			if (!detection) {
				throw new Error('No chessboard candidate was found in the current frame.');
			}

			normalizedQuad = normalizeQuad(detection.quad, frame.width, frame.height);
			detectedBoardScore = detection.score;
			statusMessage = `Board detected from ${detection.selectedCount} square candidates.`;
			await refreshPreview();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Board detection failed.';
		} finally {
			busyLabel = null;
		}
	}

	async function captureReference() {
		busyLabel = 'Capturing empty board';
		errorMessage = null;

		try {
			if (!streamImage || !snapshotCanvas) {
				throw new Error('Live camera frame is unavailable.');
			}

			referenceImageDataUrl = imageDataToDataUrl(streamImage, snapshotCanvas);
			referenceImageData = await loadReferenceImage(referenceImageDataUrl);
			statusMessage = 'Empty-board reference captured. Save calibration to use it from the clock.';
			await refreshPreview();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to capture the empty-board reference.';
		} finally {
			busyLabel = null;
		}
	}

	function saveCalibrationToStorage() {
		const calibration: BoardCalibration = {
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
		streamEnabled = true;
		cameraFrameReady = false;
		errorMessage = null;
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
		void refreshPreview();
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

	async function refreshPreview() {
		if (previewPending || !previewCanvas || !streamImage || !cameraFrameReady) {
			return;
		}

		previewPending = true;

		try {
			const activeCv = await ensureCvModule();
			if (!activeCv) {
				return;
			}
			const frame = captureFrame();
			const analysis = analyzeBoardFrame(activeCv, frame, normalizedQuad, referenceImageData);
			const context = previewCanvas.getContext('2d');
			if (!context) {
				throw new Error('2D canvas is unavailable.');
			}

			previewCanvas.width = WARP_SIZE;
			previewCanvas.height = WARP_SIZE;
			context.putImageData(analysis.boardImageData, 0, 0);

			if (referenceImageDataUrl) {
				drawOccupancyOverlay(context, analysis.occupiedIndices);
			}
		} catch (error) {
			if (error instanceof Error && !errorMessage) {
				errorMessage = error.message;
			}
		} finally {
			previewPending = false;
		}
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
		<label for="camera-url">Camera URL</label>
		<div class="camera-url-row">
			<input
				id="camera-url"
				type="url"
				bind:value={cameraUrl}
				placeholder="http://chesscam.local"
				autocomplete="off"
			/>
			<button class="action-btn" type="button" onclick={connectCamera}>
				Connect camera
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
				<img
					bind:this={streamImage}
					class="stream-image"
					src={streamSrc}
					alt="Live chessboard camera frame"
					crossorigin="anonymous"
					onload={() => {
						cameraFrameReady = true;
						errorMessage = null;
						void refreshPreview();
					}}
					onerror={() => {
						cameraFrameReady = false;
						errorMessage = 'The live camera stream could not be loaded.';
					}}
				/>

				{#if cameraFrameReady}
					<svg
						class="quad-overlay"
						viewBox="0 0 1 1"
						preserveAspectRatio="none"
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

	{#if errorMessage}
		<p class="notice error">{errorMessage}</p>
	{:else}
		<p class="notice">{statusMessage}</p>
	{/if}

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
	}

	.quad-overlay {
		touch-action: none;
	}

	.handle {
		cursor: grab;
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

	.notice {
		margin: 1rem 0 0;
		color: #dbeafe;
	}

	.notice.error {
		color: #fca5a5;
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
