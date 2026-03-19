import opencvScriptUrl from '@techstark/opencv-js/dist/opencv.js?url';
import { localizeChessboardFromImageDataByGridSearch } from '$lib/vision/chessboard';

type OpenCvModule = typeof import('@techstark/opencv-js');
type DetectionResult = ReturnType<typeof localizeChessboardFromImageDataByGridSearch>;
type OpenCvRuntime = OpenCvModule & {
	onRuntimeInitialized?: () => void;
};

const workerSelf = globalThis as typeof globalThis & {
	cv?: OpenCvRuntime;
	postMessage: (message: unknown) => void;
	onmessage: ((event: MessageEvent<{
		id: number;
		type: 'detect';
		width: number;
		height: number;
		data: ArrayBuffer;
	}>) => void) | null;
};

let cvPromise: Promise<OpenCvModule> | null = null;

async function loadWorkerCv() {
	if (!cvPromise) {
		cvPromise = new Promise<OpenCvModule>(async (resolve, reject) => {
			const existingCv = workerSelf.cv;
			if (existingCv && typeof existingCv.Mat === 'function') {
				resolve(existingCv);
				return;
			}

			const cv = existingCv ?? {} as OpenCvRuntime;
			const previousInitializer = cv.onRuntimeInitialized;
			cv.onRuntimeInitialized = () => {
				previousInitializer?.();
				if (workerSelf.cv && typeof workerSelf.cv.Mat === 'function') {
					resolve(workerSelf.cv);
				}
			};
			workerSelf.cv = cv;

			try {
				workerSelf.postMessage({
					id: -1,
					type: 'detect-progress',
					stage: 'Loading OpenCV in the worker.'
				});
				const scriptResponse = await fetch(opencvScriptUrl);
				if (!scriptResponse.ok) {
					reject(new Error(`Failed to fetch OpenCV worker script: ${scriptResponse.status}`));
					return;
				}

				const scriptSource = await scriptResponse.text();
				(0, eval)(scriptSource);

				let pollAttempts = 0;
				const maxPollAttempts = 400;
				const pollId = workerSelf.setInterval(() => {
					if (workerSelf.cv && typeof workerSelf.cv.Mat === 'function') {
						workerSelf.clearInterval(pollId);
						workerSelf.postMessage({
							id: -1,
							type: 'detect-progress',
							stage: 'OpenCV worker ready.'
						});
						resolve(workerSelf.cv);
						return;
					}

					pollAttempts += 1;
					if (pollAttempts >= maxPollAttempts) {
						workerSelf.clearInterval(pollId);
						reject(new Error('OpenCV loaded in the worker but never became ready.'));
					}
				}, 25);

				if (workerSelf.cv && typeof workerSelf.cv.Mat === 'function') {
					workerSelf.clearInterval(pollId);
					workerSelf.postMessage({
						id: -1,
						type: 'detect-progress',
						stage: 'OpenCV worker ready.'
					});
					resolve(workerSelf.cv);
				}
			} catch (error) {
				reject(error instanceof Error ? error : new Error('Failed to load the OpenCV worker script.'));
			}
		}).catch((error) => {
			cvPromise = null;
			throw error;
		});
	}

	return cvPromise;
}

workerSelf.onmessage = async (
	event: MessageEvent<{
		id: number;
		type: 'detect';
		width: number;
		height: number;
		data: ArrayBuffer;
	}>
) => {
	if (event.data.type !== 'detect') return;

	try {
		workerSelf.postMessage({
			id: event.data.id,
			type: 'detect-progress',
			stage: 'Running board detection on the worker.'
		});
		void loadWorkerCv().catch(() => {});
		workerSelf.setTimeout(() => {
			try {
				const detection: DetectionResult = localizeChessboardFromImageDataByGridSearch({
					width: event.data.width,
					height: event.data.height,
					data: new Uint8ClampedArray(event.data.data)
				});
				workerSelf.postMessage({
					id: event.data.id,
					type: 'detect-progress',
					stage: detection
						? `Scored ${detection.selectedCount} candidate seeds.`
						: 'Board search finished without a match.'
				});
				workerSelf.postMessage({
					id: event.data.id,
					type: 'detect-result',
					detection
				});
			} catch (error) {
				workerSelf.postMessage({
					id: event.data.id,
					type: 'detect-error',
					error: error instanceof Error ? error.message : 'Board detection worker failed.'
				});
			}
		}, 0);
	} catch (error) {
		workerSelf.postMessage({
			id: event.data.id,
			type: 'detect-error',
			error: error instanceof Error ? error.message : 'Board detection worker failed.'
		});
	}
};
