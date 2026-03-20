import { loadBoardCalibration } from '$lib/board-calibration';
import { listReduxActionLogs } from '$lib/game/action-log';
import type { GameLogReport, GameState } from '$lib/game/types';

const ISSUE_URL = 'https://github.com/anicolao/chess-clock/issues/new';

function buildIssueUrl(report: GameLogReport, fileName: string) {
	const title = `Game log report: ${report.gameId}`;
	const body = [
		'## Summary',
		`- Game ID: \`${report.gameId}\``,
		`- Generated: ${new Date(report.generatedAtMs).toISOString()}`,
		`- Move captures: ${report.summary.moveCaptureCount}`,
		`- Active player: ${report.summary.activePlayer ?? 'none'}`,
		`- Winner: ${report.summary.winner ?? 'none'}`,
		'',
		'## Attachment',
		`Attach the downloaded \`${fileName}\` JSON file to this issue.`,
		'The report includes the Redux action log, move-completion payloads, and calibration snapshot needed for debugging or test-case generation.'
	].join('\n');
	return `${ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

function downloadReport(report: GameLogReport) {
	const fileName = `chess-clock-log-report-${report.gameId}.json`;
	const blob = new Blob([JSON.stringify(report, null, 2)], {
		type: 'application/json'
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = fileName;
	anchor.click();
	URL.revokeObjectURL(url);
	return fileName;
}

function openIssue(report: GameLogReport, fileName: string, issueWindow?: Window | null) {
	const issueUrl = buildIssueUrl(report, fileName);
	if (issueWindow) {
		try {
			issueWindow.opener = null;
		} catch {
			// Ignore browsers that disallow mutating opener on the placeholder window.
		}
		issueWindow.location.replace(issueUrl);
		return;
	}
	window.open(issueUrl, '_blank');
}

export async function exportCurrentGameLogReport(gameState: GameState, issueWindow?: Window | null) {
	const actions = await listReduxActionLogs(gameState.sessionId);
	const report: GameLogReport = {
		generatedAtMs: Date.now(),
		gameId: gameState.sessionId,
		summary: {
			gameState: gameState.gameState,
			activePlayer: gameState.activePlayer,
			winner: gameState.winner,
			moveCaptureCount: gameState.moveCaptures.length,
			connectionStatus: gameState.connectionStatus,
			cameraUrl: gameState.cameraUrl,
			layoutMode: gameState.layoutMode
		},
		currentMoveCaptureDiagnostics: gameState.moveCaptureDiagnostics,
		calibration: loadBoardCalibration(),
		moveCaptures: gameState.moveCaptures,
		actions
	};

	const fileName = downloadReport(report);
	openIssue(report, fileName, issueWindow);
	return {
		fileName,
		actionCount: actions.length
	};
}
