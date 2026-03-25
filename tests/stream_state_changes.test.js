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
			event.triggerFrameIndex >= event.beforeFrameIndex,
			`Expected transition marker to be at or after the before bracket in ${result.streamName} event ${event.eventIndex}`
		);
		assert.ok(
			event.motionEndFrameIndex <= event.afterFrameIndex,
			`Expected transition marker to be at or before the after bracket in ${result.streamName} event ${event.eventIndex}`
		);
		assert.ok(
			event.beforeFrameIndex <= event.afterQuietStartFrameIndex,
			`Expected consecutive quiet runs in ${result.streamName} event ${event.eventIndex}`
		);

		for (let frameIndex = event.beforeQuietStartFrameIndex; frameIndex <= event.beforeFrameIndex; frameIndex += 1) {
			assert.ok(
				frameIndex === event.beforeQuietStartFrameIndex ||
					result.frameSummaries[frameIndex].diffScore <= result.thresholds.quiet + 1e-9,
				`Expected quiet before window in ${result.streamName} event ${event.eventIndex}`
			);
		}

		for (let frameIndex = event.afterQuietStartFrameIndex; frameIndex <= event.afterFrameIndex; frameIndex += 1) {
			assert.ok(
				frameIndex === event.afterQuietStartFrameIndex ||
					result.frameSummaries[frameIndex].diffScore <= result.thresholds.quiet + 1e-9,
				`Expected quiet after window in ${result.streamName} event ${event.eventIndex}`
			);
		}
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
