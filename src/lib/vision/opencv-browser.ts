import { browser } from '$app/environment';

type OpenCvModule = typeof import('@techstark/opencv-js');

let openCvPromise: Promise<OpenCvModule> | null = null;

export function loadOpenCv(): Promise<OpenCvModule> {
	if (!browser) {
		return Promise.reject(new Error('OpenCV is only available in the browser.'));
	}

	if (!openCvPromise) {
		openCvPromise = import('@techstark/opencv-js').then((opencvModule) => {
			const cv = (
				(opencvModule as OpenCvModule & { default?: OpenCvModule }).default
				?? opencvModule
			);

			return new Promise<OpenCvModule>((resolve) => {
				if (typeof cv.Mat === 'function') {
					resolve(cv);
					return;
				}

				const previousHandler = cv.onRuntimeInitialized;
				cv.onRuntimeInitialized = () => {
					previousHandler?.();
					resolve(cv);
				};
			});
		});
	}

	return openCvPromise;
}
