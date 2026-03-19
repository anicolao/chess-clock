type FrameElement = HTMLImageElement | HTMLVideoElement;

export function captureImageDataFromElement(
	source: FrameElement,
	canvas: HTMLCanvasElement
) {
	const width = source instanceof HTMLVideoElement
		? (source.videoWidth || source.clientWidth)
		: (source.naturalWidth || source.width);
	const height = source instanceof HTMLVideoElement
		? (source.videoHeight || source.clientHeight)
		: (source.naturalHeight || source.height);

	if (!width || !height) {
		throw new Error('Camera frame is not ready yet.');
	}

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
	quality = 0.92
) {
	captureImageDataFromElement(source, canvas);
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
