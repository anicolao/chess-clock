import { base } from '$app/paths';
import { browser } from '$app/environment';

type OpenCvModule = typeof import('@techstark/opencv-js');
type OpenCvReady = {
	cv: OpenCvModule;
};

declare global {
	interface Window {
		cv?: OpenCvModule;
	}
}

let openCvPromise: Promise<OpenCvModule> | null = null;
const opencvScriptUrl = `${base}/vendor/opencv.js`;

function getReadyOpenCv() {
	if (!window.cv || typeof window.cv.Mat !== 'function') {
		return null;
	}

	if (typeof (window.cv as OpenCvModule & { then?: unknown }).then === 'function') {
		Object.defineProperty(window.cv, 'then', {
			value: undefined,
			writable: true,
			configurable: true
		});
	}

	return window.cv;
}

function waitForOpenCvReady(timeoutMs = 15000) {
	const readyCv = getReadyOpenCv();
	if (readyCv) {
		return Promise.resolve({ cv: readyCv } satisfies OpenCvReady);
	}

	return new Promise<OpenCvReady>((resolve, reject) => {
		let elapsedMs = 0;
		const intervalMs = 25;
		const intervalId = window.setInterval(() => {
			const cv = getReadyOpenCv();
			if (cv) {
				window.clearInterval(intervalId);
				resolve({ cv });
				return;
			}

			elapsedMs += intervalMs;
			if (elapsedMs >= timeoutMs) {
				window.clearInterval(intervalId);
				reject(new Error('OpenCV loaded in the browser but never became ready.'));
			}
		}, intervalMs);
	});
}

async function loadOpenCvScript(): Promise<OpenCvModule> {
	const readyCv = getReadyOpenCv();
	if (readyCv) {
		return readyCv;
	}

	const existingScript = document.querySelector<HTMLScriptElement>('script[data-opencv-script="true"]');
	if (existingScript) {
		return (await waitForOpenCvReady()).cv;
	}

	return await new Promise<OpenCvModule>((resolve, reject) => {
		const script = document.createElement('script');
		script.src = opencvScriptUrl;
		script.async = true;
		script.dataset.opencvScript = 'true';
		script.onload = () => {
			void waitForOpenCvReady().then(({ cv }) => resolve(cv), reject);
		};
		script.onerror = () => {
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
