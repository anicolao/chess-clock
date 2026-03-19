import { browser } from '$app/environment';
import opencvScriptUrl from '@techstark/opencv-js/dist/opencv.js?url';

type OpenCvModule = typeof import('@techstark/opencv-js');
type OpenCvRuntime = OpenCvModule & {
	onRuntimeInitialized?: () => void;
};

declare global {
	interface Window {
		cv?: OpenCvRuntime;
	}
}

let openCvPromise: Promise<OpenCvModule> | null = null;

function loadOpenCvScript() {
	return new Promise<OpenCvModule>((resolve, reject) => {
		const existingCv = window.cv;
		if (existingCv && typeof existingCv.Mat === 'function') {
			resolve(existingCv);
			return;
		}

		const cv = existingCv ?? {} as OpenCvRuntime;
		const previousInitializer = cv.onRuntimeInitialized;
		cv.onRuntimeInitialized = () => {
			previousInitializer?.();
			if (window.cv && typeof window.cv.Mat === 'function') {
				resolve(window.cv);
			}
		};
		window.cv = cv;

		let pollAttempts = 0;
		const maxPollAttempts = 400;
		const pollId = window.setInterval(() => {
			if (window.cv && typeof window.cv.Mat === 'function') {
				window.clearInterval(pollId);
				resolve(window.cv);
				return;
			}

			pollAttempts += 1;
			if (pollAttempts >= maxPollAttempts) {
				window.clearInterval(pollId);
				reject(new Error('OpenCV loaded in the browser but never became ready.'));
			}
		}, 25);

		const existingScript = document.querySelector<HTMLScriptElement>('script[data-opencv-script="true"]');
		if (existingScript) {
			return;
		}

		const script = document.createElement('script');
		script.src = opencvScriptUrl;
		script.async = true;
		script.dataset.opencvScript = 'true';
		script.onerror = () => {
			window.clearInterval(pollId);
			reject(new Error('Failed to load the OpenCV browser script.'));
		};
		document.head.append(script);
	});
}

export function loadOpenCv(): Promise<OpenCvModule> {
	if (!browser) {
		return Promise.reject(new Error('OpenCV is only available in the browser.'));
	}

	if (!openCvPromise) {
		openCvPromise = loadOpenCvScript().catch((error) => {
			openCvPromise = null;
			throw error;
		});
	}

	return openCvPromise;
}
