import { browser } from '$app/environment';

type OpenCvModule = typeof import('@techstark/opencv-js');

let openCvPromise: Promise<OpenCvModule> | null = null;

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
		const pollId = window.setInterval(() => {
			if (typeof cv.Mat === 'function') {
				window.clearInterval(pollId);
				resolve(cv);
				return;
			}

			attempts += 1;
			if (attempts >= maxAttempts) {
				window.clearInterval(pollId);
				reject(new Error('OpenCV did not finish initializing.'));
			}
		}, 25);
	});
}

export function loadOpenCv(): Promise<OpenCvModule> {
	if (!browser) {
		return Promise.reject(new Error('OpenCV is only available in the browser.'));
	}

	if (!openCvPromise) {
		openCvPromise = import('@techstark/opencv-js').then(async (opencvModule) => {
			const cv = (
				(opencvModule as OpenCvModule & { default?: OpenCvModule }).default
				?? opencvModule
			);

			return waitForCvModule(cv);
		}).catch((error) => {
			openCvPromise = null;
			throw error;
		});
	}

	return openCvPromise;
}
