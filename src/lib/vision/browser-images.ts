type FrameElement = HTMLImageElement | HTMLVideoElement;

type CaptureOptions = {
	maxDimension?: number;
};

function scaleToMaxDimension(width: number, height: number, maxDimension?: number) {
	if (!maxDimension || maxDimension <= 0) {
		return { width, height };
	}

	const largestDimension = Math.max(width, height);
	if (!largestDimension || largestDimension <= maxDimension) {
		return { width, height };
	}

	const scale = maxDimension / largestDimension;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

export function captureImageDataFromElement(
	source: FrameElement,
	canvas: HTMLCanvasElement,
	options: CaptureOptions = {}
) {
	const sourceWidth = source instanceof HTMLVideoElement
		? (source.videoWidth || source.clientWidth)
		: (source.naturalWidth || source.width);
	const sourceHeight = source instanceof HTMLVideoElement
		? (source.videoHeight || source.clientHeight)
		: (source.naturalHeight || source.height);

	if (!sourceWidth || !sourceHeight) {
		throw new Error('Camera frame is not ready yet.');
	}

	const { width, height } = scaleToMaxDimension(sourceWidth, sourceHeight, options.maxDimension);
	canvas.width = width;
	canvas.height = height;

	const context = canvas.getContext('2d');
	if (!context) {
		throw new Error('2D canvas is unavailable.');
	}

	context.drawImage(source, 0, 0, width, height);
	return context.getImageData(0, 0, width, height);
}

export function imageDataToDataUrl(
	source: FrameElement,
	canvas: HTMLCanvasElement,
	type = 'image/jpeg',
	quality = 0.92,
	options: CaptureOptions = {}
) {
	captureImageDataFromElement(source, canvas, options);
	return canvas.toDataURL(type, quality);
}

export async function loadImageDataFromUrl(dataUrl: string) {
	const image = new Image();
	image.crossOrigin = 'anonymous';
	image.src = dataUrl;

	await new Promise<void>((resolve, reject) => {
		image.onload = () => resolve();
		image.onerror = () => reject(new Error('Failed to load reference image.'));
	});

	const canvas = document.createElement('canvas');
	return captureImageDataFromElement(image, canvas);
}

export function drawImageDataToCanvas(
	canvas: HTMLCanvasElement,
	imageData: ImageData
) {
	canvas.width = imageData.width;
	canvas.height = imageData.height;

	const context = canvas.getContext('2d');
	if (!context) {
		throw new Error('2D canvas is unavailable.');
	}

	context.putImageData(imageData, 0, 0);
	return context;
}
