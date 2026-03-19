type FrameElement = HTMLImageElement | HTMLVideoElement;

type CaptureOptions = {
	maxDimension?: number;
	coverAspectRatio?: number;
};

function getCoverCrop(
	sourceWidth: number,
	sourceHeight: number,
	coverAspectRatio?: number
) {
	if (!coverAspectRatio || coverAspectRatio <= 0 || !sourceWidth || !sourceHeight) {
		return {
			x: 0,
			y: 0,
			width: sourceWidth,
			height: sourceHeight
		};
	}

	const sourceAspectRatio = sourceWidth / sourceHeight;
	if (Math.abs(sourceAspectRatio - coverAspectRatio) < 1e-3) {
		return {
			x: 0,
			y: 0,
			width: sourceWidth,
			height: sourceHeight
		};
	}

	if (sourceAspectRatio > coverAspectRatio) {
		const cropWidth = sourceHeight * coverAspectRatio;
		return {
			x: (sourceWidth - cropWidth) / 2,
			y: 0,
			width: cropWidth,
			height: sourceHeight
		};
	}

	const cropHeight = sourceWidth / coverAspectRatio;
	return {
		x: 0,
		y: (sourceHeight - cropHeight) / 2,
		width: sourceWidth,
		height: cropHeight
	};
}

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

	const crop = getCoverCrop(sourceWidth, sourceHeight, options.coverAspectRatio);
	const { width, height } = scaleToMaxDimension(crop.width, crop.height, options.maxDimension);
	canvas.width = width;
	canvas.height = height;

	const context = canvas.getContext('2d');
	if (!context) {
		throw new Error('2D canvas is unavailable.');
	}

	context.drawImage(
		source,
		crop.x,
		crop.y,
		crop.width,
		crop.height,
		0,
		0,
		width,
		height
	);
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

export function imageDataFrameToDataUrl(
	imageData: ImageData,
	type = 'image/jpeg',
	quality = 0.9
) {
	const canvas = document.createElement('canvas');
	drawImageDataToCanvas(canvas, imageData);
	return canvas.toDataURL(type, quality);
}
