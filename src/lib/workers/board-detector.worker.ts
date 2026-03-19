import { localizeChessboardFromImageDataFast } from '$lib/vision/chessboard';

type OpenCvModule = typeof import('@techstark/opencv-js');
type DetectionResult = ReturnType<typeof localizeChessboardFromImageDataFast>;

let cvPromise: Promise<OpenCvModule> | null = null;

function waitForCvModule(cv: OpenCvModule) {
	if (typeof cv.Mat === 'function') {
		return Promise.resolve(cv);
	}

	if (typeof (cv as OpenCvModule & { then?: (resolve: (value: OpenCvModule) => void) => unknown }).then === 'function') {
		return new Promise<OpenCvModule>((resolve) => {
			(cv as OpenCvModule & { then: (resolve: (value: OpenCvModule) => void) => unknown }).then((resolvedCv) => {
				resolve(resolvedCv);
			});
		});
	}

	return new Promise<OpenCvModule>((resolve, reject) => {
		let attempts = 0;
		const maxAttempts = 200;
		const pollId = self.setInterval(() => {
			if (typeof cv.Mat === 'function') {
				self.clearInterval(pollId);
				resolve(cv);
				return;
			}

			attempts += 1;
			if (attempts >= maxAttempts) {
				self.clearInterval(pollId);
				reject(new Error('OpenCV did not finish initializing in the worker.'));
			}
		}, 25);
	});
}

async function loadWorkerCv() {
	if (!cvPromise) {
		cvPromise = import('@techstark/opencv-js')
			.then((opencvModule) => {
				const cv = (
					(opencvModule as OpenCvModule & { default?: OpenCvModule }).default
					?? opencvModule
				);
				return waitForCvModule(cv);
			})
			.catch((error) => {
				cvPromise = null;
				throw error;
			});
	}

	return cvPromise;
}

self.onmessage = async (
	event: MessageEvent<{
		id: number;
		type: 'detect';
		imageData: ImageData;
	}>
) => {
	if (event.data.type !== 'detect') return;

	try {
		const cv = await loadWorkerCv();
		const detection: DetectionResult = localizeChessboardFromImageDataFast(cv, event.data.imageData);
		self.postMessage({
			id: event.data.id,
			type: 'detect-result',
			detection
		});
	} catch (error) {
		self.postMessage({
			id: event.data.id,
			type: 'detect-error',
			error: error instanceof Error ? error.message : 'Board detection worker failed.'
		});
	}
};
