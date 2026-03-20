#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function loadJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
}

function slugify(value) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function parseFingerprint(fingerprint) {
	const pieces = new Map();
	if (!fingerprint) {
		return pieces;
	}

	for (const token of fingerprint.split('|')) {
		if (!token) continue;
		const [indexText, color] = token.split(':');
		const index = Number.parseInt(indexText, 10);
		if (!Number.isFinite(index) || (color !== 'white' && color !== 'black')) continue;
		pieces.set(index, color);
	}
	return pieces;
}

function renderBoardFromFingerprint(fingerprint) {
	const pieces = parseFingerprint(fingerprint);
	const rows = ['  a b c d e f g h'];
	for (let row = 0; row < 8; row += 1) {
		const rank = 8 - row;
		const cells = [];
		for (let col = 0; col < 8; col += 1) {
			const index = row * 8 + col;
			const piece = pieces.get(index);
			cells.push(piece === 'white' ? 'W' : piece === 'black' ? 'B' : '.');
		}
		rows.push(`${rank} ${cells.join(' ')}`);
	}
	return rows.join('\n');
}

function summarizeChangedSquares(indices) {
	return indices.length > 0 ? indices.join(', ') : 'none';
}

function normalizeAction(action) {
	const payload = action.payload ?? null;
	if (action.type === 'game/moveCaptureStateUpdated') {
		return {
			recordedAtMs: action.recordedAtMs,
			type: action.type,
			state: payload?.state ?? null,
			reason: payload?.reason ?? null,
			changedSquareIndices: payload?.changedSquareIndices ?? [],
			stableSampleCount: payload?.stableSampleCount ?? null
		};
	}

	if (action.type === 'game/moveCaptureArmedChanged') {
		return {
			recordedAtMs: action.recordedAtMs,
			type: action.type,
			armed: payload?.armed ?? null,
			activatedAtMs: payload?.activatedAtMs ?? null
		};
	}

	if (action.type === 'game/moveCompletionCommitted') {
		return {
			recordedAtMs: action.recordedAtMs,
			type: action.type,
			moveIndex: payload?.moveIndex ?? null,
			acceptedAfterMs: payload?.acceptedAfterMs ?? null,
			changedSquareIndices: payload?.changedSquareIndices ?? [],
			occupiedPiecesCount: Array.isArray(payload?.occupiedPieces) ? payload.occupiedPieces.length : null
		};
	}

	if (action.type === 'game/clockTapped') {
		return {
			recordedAtMs: action.recordedAtMs,
			type: action.type,
			player: payload?.player ?? null
		};
	}

	return {
		recordedAtMs: action.recordedAtMs,
		type: action.type,
		payload
	};
}

function buildNormalizedCase(report, sourceFile) {
	const interestingActions = report.actions.filter((action) =>
		action.type === 'game/moveCaptureStateUpdated'
		|| action.type === 'game/moveCaptureArmedChanged'
		|| action.type === 'game/moveCompletionCommitted'
		|| action.type === 'game/clockTapped'
	);

	return {
		sourceFile,
		gameId: report.gameId,
		generatedAtMs: report.generatedAtMs,
		summary: report.summary,
		currentMoveCaptureDiagnostics: report.currentMoveCaptureDiagnostics ?? null,
		moveCaptures: report.moveCaptures.map((capture) => ({
			moveIndex: capture.moveIndex,
			capturedAtMs: capture.capturedAtMs,
			acceptedAfterMs: capture.acceptedAfterMs,
			acceptedAfterSamples: capture.acceptedAfterSamples,
			changedSquareIndices: capture.changedSquareIndices,
			occupiedPiecesCount: capture.occupiedPieces.length,
			previousFingerprint: capture.previousFingerprint,
			nextFingerprint: capture.nextFingerprint
		})),
		interestingActions: interestingActions.map(normalizeAction)
	};
}

function renderMarkdown(report, normalizedCase, sourceFile) {
	const lines = [];
	lines.push(`# Game Log Playback`);
	lines.push('');
	lines.push(`- Source: \`${sourceFile}\``);
	lines.push(`- Game ID: \`${report.gameId}\``);
	lines.push(`- Generated: ${new Date(report.generatedAtMs).toISOString()}`);
	lines.push(`- Move captures: ${report.moveCaptures.length}`);
	lines.push(`- Interesting actions: ${normalizedCase.interestingActions.length}`);
	lines.push(`- Capture armed: ${report.summary.moveCaptureArmed ?? false}`);
	lines.push('');
	lines.push('## Summary');
	lines.push('');
	lines.push('```json');
	lines.push(JSON.stringify({
		summary: report.summary,
		currentMoveCaptureDiagnostics: report.currentMoveCaptureDiagnostics ?? null
	}, null, 2));
	lines.push('```');
	lines.push('');
	lines.push('## Timeline');
	lines.push('');

	for (const action of normalizedCase.interestingActions) {
		const ts = new Date(action.recordedAtMs).toISOString();
		if (action.type === 'game/moveCaptureStateUpdated') {
			lines.push(`- ${ts} \`${action.type}\` state=\`${action.state}\` reason=\`${action.reason}\` changed=[${summarizeChangedSquares(action.changedSquareIndices)}] stableSamples=${action.stableSampleCount}`);
		} else if (action.type === 'game/moveCaptureArmedChanged') {
			lines.push(`- ${ts} \`${action.type}\` armed=\`${action.armed}\` activatedAtMs=${action.activatedAtMs}`);
		} else if (action.type === 'game/moveCompletionCommitted') {
			lines.push(`- ${ts} \`${action.type}\` move=${action.moveIndex} acceptedAfterMs=${action.acceptedAfterMs} changed=[${summarizeChangedSquares(action.changedSquareIndices)}] occupied=${action.occupiedPiecesCount}`);
		} else if (action.type === 'game/clockTapped') {
			lines.push(`- ${ts} \`${action.type}\` player=\`${action.player}\``);
		}
	}

	lines.push('');
	lines.push('## Captured Moves');
	lines.push('');

	for (const capture of normalizedCase.moveCaptures) {
		lines.push(`### Move ${capture.moveIndex}`);
		lines.push('');
		lines.push(`- Captured: ${new Date(capture.capturedAtMs).toISOString()}`);
		lines.push(`- Accepted after: ${capture.acceptedAfterMs}ms / ${capture.acceptedAfterSamples} samples`);
		lines.push(`- Changed squares: ${summarizeChangedSquares(capture.changedSquareIndices)}`);
		lines.push(`- Occupied squares after move: ${capture.occupiedPiecesCount}`);
		lines.push('');
		lines.push('Before:');
		lines.push('');
		lines.push('```text');
		lines.push(renderBoardFromFingerprint(capture.previousFingerprint));
		lines.push('```');
		lines.push('');
		lines.push('After:');
		lines.push('');
		lines.push('```text');
		lines.push(renderBoardFromFingerprint(capture.nextFingerprint));
		lines.push('```');
		lines.push('');
	}

	return `${lines.join('\n')}\n`;
}

function main() {
	const args = process.argv.slice(2);
	assert(args.length > 0, 'Usage: node scripts/convert_game_log_reports.mjs <report.json> [more reports.json]');

	const outDir = path.join(process.cwd(), 'tests', 'fixtures', 'game-log-cases');
	ensureDir(outDir);

	for (const reportPath of args) {
		const absolutePath = path.resolve(reportPath);
		const report = loadJson(absolutePath);
		const baseName = slugify(path.basename(reportPath, path.extname(reportPath)));
		const normalizedCase = buildNormalizedCase(report, path.relative(process.cwd(), absolutePath));
		const markdown = renderMarkdown(report, normalizedCase, path.relative(process.cwd(), absolutePath));

		const jsonOutPath = path.join(outDir, `${baseName}.case.json`);
		const mdOutPath = path.join(outDir, `${baseName}.md`);

		fs.writeFileSync(jsonOutPath, JSON.stringify(normalizedCase, null, 2));
		fs.writeFileSync(mdOutPath, markdown);
		console.log(`wrote ${path.relative(process.cwd(), jsonOutPath)}`);
		console.log(`wrote ${path.relative(process.cwd(), mdOutPath)}`);
	}
}

main();
