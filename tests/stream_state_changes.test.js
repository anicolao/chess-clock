// @ts-nocheck
import assert from 'node:assert/strict';

import {
	analyzeAllStreamStateChanges,
	waitForOpenCvReady
} from '../src/lib/server/stream_state_changes.js';

await waitForOpenCvReady();

const results = await analyzeAllStreamStateChanges('streamdata', { renderArtifacts: false });

assert.ok(results.length > 0, 'Expected at least one stream directory');

for (const result of results) {
	assert.ok(result.localization.score > 0, `Expected localization score for ${result.streamName}`);
	assert.ok(result.events.length > 0, `Expected at least one state change in ${result.streamName}`);

	let previousAfterFrameIndex = -1;
	for (const event of result.events) {
		assert.ok(
			event.beforeFrameIndex < event.afterFrameIndex,
			`Expected before/after ordering in ${result.streamName} event ${event.eventIndex}`
		);
		assert.ok(
			event.beforeFrameIndex >= previousAfterFrameIndex,
			`Expected non-overlapping, ordered events in ${result.streamName}`
		);
		assert.ok(
			event.beforeQuietStartFrameIndex <= event.beforeFrameIndex,
			`Expected before quiet window in ${result.streamName} event ${event.eventIndex}`
		);
		assert.ok(
			event.afterQuietStartFrameIndex <= event.afterFrameIndex,
			`Expected after quiet window in ${result.streamName} event ${event.eventIndex}`
		);
		assert.ok(
			event.triggerFrameIndex <= event.motionEndFrameIndex,
			`Expected motion span ordering in ${result.streamName} event ${event.eventIndex}`
		);

		for (let frameIndex = event.beforeQuietStartFrameIndex; frameIndex <= event.beforeFrameIndex; frameIndex += 1) {
			assert.ok(
				result.frameSummaries[frameIndex].quietScore <= result.thresholds.quiet + 1e-9,
				`Expected quiet before window in ${result.streamName} event ${event.eventIndex}`
			);
		}

		for (let frameIndex = event.afterQuietStartFrameIndex; frameIndex <= event.afterFrameIndex; frameIndex += 1) {
			assert.ok(
				result.frameSummaries[frameIndex].quietScore <= result.thresholds.quiet + 1e-9,
				`Expected quiet after window in ${result.streamName} event ${event.eventIndex}`
			);
		}

		const motionScores = result.frameSummaries
			.slice(event.triggerFrameIndex, event.motionEndFrameIndex + 1)
			.map((frame) => frame.diffScore);
		assert.ok(
			motionScores.some((score) => score >= result.thresholds.settle) ||
				event.peakAnchorDriftScore >= result.thresholds.motion,
			`Expected sustained departure from quiet in ${result.streamName} event ${event.eventIndex}`
		);
		previousAfterFrameIndex = event.afterFrameIndex;
	}
}

console.log(
	JSON.stringify(
		results.map((result) => ({
			stream: result.streamName,
			events: result.events.length
		})),
		null,
		2
	)
);
