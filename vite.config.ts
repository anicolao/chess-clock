import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { execSync } from 'child_process';
import { createReadStream, readFileSync } from 'fs';
import { resolve } from 'path';

// Helper to get git info
const getGitHash = () => {
	if (process.env.COMMIT_HASH) {
		return process.env.COMMIT_HASH.substring(0, 7);
	}
	try {
		return execSync('git rev-parse --short HEAD').toString().trim();
	} catch {
		return 'unknown';
	}
};

const getGitDirty = () => {
	try {
		return execSync('git status --porcelain').toString().trim().length > 0;
	} catch {
		return false;
	}
};

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const opencvBrowserScriptPath = resolve('node_modules/@techstark/opencv-js/dist/opencv.js');

const serveOpenCvBrowserScript = () => ({
	name: 'serve-opencv-browser-script',
	configureServer(server: {
		middlewares: {
			use: (path: string, handler: (req: unknown, res: {
				setHeader: (name: string, value: string) => void;
			}, next: (error?: Error) => void) => void) => void;
		};
	}) {
		server.middlewares.use('/vendor/opencv.js', (_req, res, next) => {
			try {
				res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
				createReadStream(opencvBrowserScriptPath).pipe(res as unknown as NodeJS.WritableStream);
			} catch (error) {
				next(error instanceof Error ? error : new Error('Failed to serve OpenCV browser script.'));
			}
		});
	},
	generateBundle(this: {
		emitFile: (asset: {
			type: 'asset';
			fileName: string;
			source: string | Uint8Array;
		}) => void;
	}) {
		this.emitFile({
			type: 'asset',
			fileName: 'vendor/opencv.js',
			source: readFileSync(opencvBrowserScriptPath)
		});
	}
});

export default defineConfig({
	plugins: [serveOpenCvBrowserScript(), sveltekit()],
	worker: {
		format: 'es'
	},
	define: {
		'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
		'import.meta.env.VITE_APP_COMMIT_HASH': JSON.stringify(getGitHash()),
		'import.meta.env.VITE_APP_BUILD_DATE': JSON.stringify(new Date().toISOString()),
		'import.meta.env.VITE_APP_DIRTY_FLAG': JSON.stringify(getGitDirty())
	}
});
