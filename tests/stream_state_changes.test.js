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
