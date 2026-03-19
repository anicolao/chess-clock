import { browser } from '$app/environment';

export type NormalizedPoint = { x: number; y: number };
export type CameraMode = 'browser' | 'remote';
export const DEFAULT_OCCUPANCY_THRESHOLD = 3.25;

export type BoardCalibration = {
	cameraMode: CameraMode;
	cameraUrl: string;
	normalizedQuad: [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint];
	referenceImageDataUrl: string | null;
	occupancyThreshold: number;
	updatedAt: number;
};

const STORAGE_KEY = 'chess-clock.board-calibration.v1';

export function createDefaultQuad(): BoardCalibration['normalizedQuad'] {
	return [
		{ x: 0.18, y: 0.18 },
		{ x: 0.82, y: 0.18 },
		{ x: 0.82, y: 0.82 },
		{ x: 0.18, y: 0.82 }
	];
}

function isValidPoint(value: unknown): value is NormalizedPoint {
	return !!value
		&& typeof value === 'object'
		&& typeof (value as NormalizedPoint).x === 'number'
		&& typeof (value as NormalizedPoint).y === 'number';
}

function isValidCalibration(value: unknown): value is BoardCalibration {
	return !!value
		&& typeof value === 'object'
		&& (((value as BoardCalibration).cameraMode === 'browser')
			|| (value as BoardCalibration).cameraMode === 'remote')
		&& typeof (value as BoardCalibration).cameraUrl === 'string'
		&& Array.isArray((value as BoardCalibration).normalizedQuad)
		&& (value as BoardCalibration).normalizedQuad.length === 4
		&& (value as BoardCalibration).normalizedQuad.every(isValidPoint)
		&& ((((value as { referenceImageDataUrl?: unknown }).referenceImageDataUrl) === null)
			|| typeof (value as BoardCalibration).referenceImageDataUrl === 'string')
		&& typeof (value as BoardCalibration).occupancyThreshold === 'number'
		&& Number.isFinite((value as BoardCalibration).occupancyThreshold)
		&& typeof (value as BoardCalibration).updatedAt === 'number';
}

export function loadBoardCalibration(): BoardCalibration | null {
	if (!browser) return null;

	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return null;

	try {
		const parsed = JSON.parse(raw) as Partial<BoardCalibration>;
		const normalized = {
			cameraMode: parsed.cameraMode === 'remote' ? 'remote' : 'browser',
			cameraUrl: typeof parsed.cameraUrl === 'string' ? parsed.cameraUrl : 'http://chesscam.local',
			normalizedQuad: parsed.normalizedQuad,
			referenceImageDataUrl: parsed.referenceImageDataUrl ?? null,
			occupancyThreshold: typeof parsed.occupancyThreshold === 'number'
				? parsed.occupancyThreshold
				: DEFAULT_OCCUPANCY_THRESHOLD,
			updatedAt: parsed.updatedAt
		};
		return isValidCalibration(normalized) ? normalized : null;
	} catch {
		return null;
	}
}

export function saveBoardCalibration(calibration: BoardCalibration) {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(calibration));
}

export function clearBoardCalibration() {
	if (!browser) return;
	localStorage.removeItem(STORAGE_KEY);
}

export function cloneQuad(
	quad: BoardCalibration['normalizedQuad']
): BoardCalibration['normalizedQuad'] {
	return quad.map((point) => ({ ...point })) as BoardCalibration['normalizedQuad'];
}
