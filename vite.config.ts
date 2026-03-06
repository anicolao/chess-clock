import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

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

export default defineConfig({
	plugins: [sveltekit()],
	define: {
		'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
		'import.meta.env.VITE_APP_COMMIT_HASH': JSON.stringify(getGitHash()),
		'import.meta.env.VITE_APP_BUILD_DATE': JSON.stringify(new Date().toISOString()),
		'import.meta.env.VITE_APP_DIRTY_FLAG': JSON.stringify(getGitDirty())
	}
});
