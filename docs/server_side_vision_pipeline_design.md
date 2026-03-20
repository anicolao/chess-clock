# Server-Side Vision Pipeline Design

## 1. Summary
We are changing the architecture for board recognition and move capture.

The browser will no longer run OpenCV, capture webcam frames, or perform move-settle analysis locally. The ESP32 camera will expose a network stream endpoint, and a new server-side vision service will own:

- frame acquisition from the ESP32 stream
- board localization and calibration
- warped board generation
- occupancy and piece-color analysis
- temporal move completion detection
- artifact capture for debugging and replay
- event emission to the PWA

The PWA becomes a thin client. It shows the live board state, current diagnostics, and game state received from the server. It does not do the heavy image processing.

## 2. Why We Are Changing Direction
The browser-based approach has hit the wrong constraint boundary:

- OpenCV in the browser is too slow on mobile hardware.
- Continuous frame analysis on-device overheats phones and tablets.
- Browser media policy differences make testing audio, capture cadence, and camera behavior noisy.
- Device-local frame capture makes it harder to produce deterministic playback fixtures and regression tests.

The ESP32 stream plus a server-side vision stack gives us better control over:

- CPU and memory budget
- deterministic logging and artifact retention
- reproducible playback tests
- observability during move-settle tuning
- future multi-client viewing of the same game state

## 3. Goals
- Move all image processing and move-completion logic off the PWA and onto a server.
- Use the ESP32 camera stream as the only live image source for the MVP.
- Preserve the current working board-localization and occupancy logic by reusing it in a server runtime.
- Make move-capture behavior observable and testable from recorded server-side artifacts.
- Drive the PWA entirely from server events and snapshots.
- Keep the path open for automatic clock switching and automatic move recording to become downstream consumers of committed server events.

## 4. Non-Goals
- Supporting the browser webcam path in parallel.
- Full chess legality checking in the first server implementation.
- Cloud hosting or multi-tenant internet deployment in the MVP.
- Rewriting the vision algorithm before we have reproduced the current Node behavior server-side.
- Firmware-side move recognition. The ESP32 only streams frames.

## 5. High-Level Architecture

### 5.1 Components
- `ESP32 Camera`
  Publishes an MJPEG stream or periodic JPEG endpoint over the local network.
- `Vision Server`
  Connects to the ESP32 stream, samples frames, runs board analysis, and owns calibration and move capture.
- `Artifact Store`
  Persists frames, warped boards, diagnostics, and event logs on the server filesystem.
- `PWA`
  Displays live board state, calibration UI, move timeline, diagnostics, and clock state based on server data.

### 5.2 Ownership Split
- ESP32:
  - image acquisition only
  - no board analysis
  - no move reasoning
- Vision server:
  - all computer vision
  - all move-settle state
  - all artifact capture
  - authoritative game events
- PWA:
  - presentation
  - local interaction
  - settings and review surfaces
  - no vision computation

## 6. Runtime Model

### 6.1 Frame Ingestion
The vision server connects to the ESP32 stream and maintains a controlled sampling loop. It should not attempt to process every incoming MJPEG frame.

Recommended MVP behavior:
- ingest the stream continuously
- keep only the latest decoded frame in memory
- analyze at a bounded cadence, initially `10 Hz` or slower if thermal/perf testing requires it
- drop stale frames rather than building a queue

This matches the real need. We care about current board state, not every intermediate camera frame.

### 6.2 Analysis Loop
For each sampled frame:
1. decode JPEG to an image matrix
2. localize the board from calibration or re-run localization when required
3. warp to top-down board view
4. compute occupancy and piece color
5. feed the structured result into the move-completion engine
6. emit zero or more server events

## 7. Calibration Model

### 7.1 Server-Owned Calibration
Calibration should move to the server because the server owns the source frame geometry.

Persisted calibration should include:
- camera source id or stream URL
- board quad in source-frame normalized coordinates
- empty-board reference frame
- occupancy threshold
- any board-localization tuning parameters
- metadata:
  - created at
  - updated at
  - algorithm version
  - source frame dimensions

### 7.2 PWA Calibration UX
The PWA still needs a calibration screen, but it becomes a remote control for server state.

The flow should be:
1. PWA requests the latest server frame.
2. Server returns the current source frame plus current quad.
3. User adjusts the quad in the browser UI.
4. PWA submits the updated quad to the server.
5. Server validates and stores the new calibration.
6. User captures an empty-board reference through the PWA.
7. Server stores that reference from the server-side frame source.

Important detail:
- the user edits overlays on a rendered copy of the server frame
- the browser does not become the source of truth for geometry

### 7.3 Manual and Automatic Localization
The server should support both:
- automatic board localization using the current OpenCV/Node approach
- manual quad adjustment through the PWA

Automatic localization should only produce an initial estimate. Manual correction remains essential.

## 8. Vision Pipeline

### 8.1 Baseline Requirement
The first server implementation should reuse the same board-localization and occupancy logic that already works in Node tests. We should not introduce a second detection algorithm at the same time as the architecture migration.

### 8.2 Structured Per-Frame Output
Each analyzed frame should produce a structured result like:

```json
{
  "timestampMs": 1760000000000,
  "sourceFrame": {
    "width": 1280,
    "height": 720
  },
  "boardDetected": true,
  "normalizedQuad": [[0.12, 0.18], [0.83, 0.16], [0.86, 0.89], [0.1, 0.9]],
  "occupiedPieces": [
    { "index": 0, "color": "white" }
  ],
  "occupiedIndices": [0],
  "occupancyScores": [],
  "referenceScores": [],
  "analysisHealth": {
    "boardMissing": false,
    "referenceMissing": false,
    "lowConfidence": false
  }
}
```

### 8.3 Board Re-Localization Policy
Board localization is expensive. We should not run full contour search on every frame once calibration is stable.

Recommended policy:
- use the saved manual/server calibration quad by default
- optionally run a cheaper alignment sanity check every analyzed frame
- trigger full relocalization only when:
  - calibration is missing
  - the board appears significantly misregistered
  - the operator explicitly requests it

## 9. Move Completion Model

### 9.1 Authoritative Server State Machine
The server owns the move-completion engine. The browser no longer decides when a move settled.

Recommended states:
- `uncalibrated`
- `idle`
- `stable`
- `transitioning`
- `candidate_stable`
- `capture_committed`
- `error`

### 9.2 Acceptance Logic
The server should accept a move only when:
- a prior stable fingerprint existed
- the fingerprint changed materially
- the new fingerprint remains stable across the configured window
- analysis health remains acceptable

The current stable fingerprint should be based on:
- occupied squares
- white/black piece color

Raw confidence scores should remain diagnostic data, not fingerprint identity.

### 9.3 Clock and Move Recording Contract
The server should emit a committed move event that later becomes the only trigger for:
- automatic clock switching
- move reconstruction

That downstream automation is not part of this design doc’s MVP, but the event contract should be designed for it now.

## 10. Server Event Model

### 10.1 Event Types
The vision server should emit structured events such as:
- `vision/frameAnalyzed`
- `vision/boardCalibrationUpdated`
- `vision/referenceCaptured`
- `vision/moveCaptureStateUpdated`
- `vision/moveCompletionCommitted`
- `vision/error`

### 10.2 Transport to the PWA
For the MVP, use one of:
- Server-Sent Events
- WebSocket

Recommendation:
- use SSE for one-way event streaming first
- keep normal REST endpoints for commands and snapshots

That split is simpler than putting everything on WebSocket immediately.

### 10.3 Redux Integration in the PWA
Redux should remain the authoritative UI state in the browser, but it should now be fed by server events instead of local vision analysis.

The PWA reducer should consume:
- current board snapshot
- current move-capture diagnostics
- committed move events
- calibration metadata
- server health

The IndexedDB Redux action log can remain useful, but it should log server-driven UI actions rather than high-volume local vision samples.

## 11. Server API Surface

### 11.1 Commands
Suggested endpoints:
- `GET /api/vision/status`
- `GET /api/vision/frame/latest`
- `POST /api/vision/calibration/estimate`
- `POST /api/vision/calibration/quad`
- `POST /api/vision/calibration/reference-capture`
- `POST /api/vision/session/start`
- `POST /api/vision/session/stop`
- `POST /api/vision/log-report`

### 11.2 Event Stream
Suggested stream:
- `GET /api/vision/events`

### 11.3 Artifact Access
Suggested review endpoints:
- `GET /api/games/:gameId/moves`
- `GET /api/games/:gameId/moves/:moveIndex`
- `GET /api/games/:gameId/artifacts/:artifactId`

## 12. Persistence and Artifacts

### 12.1 Server-Side Storage
Move artifacts should move from browser IndexedDB to server storage.

Persist:
- raw source frame for committed moves
- warped board image
- structured analysis JSON
- move-capture diagnostics
- calibration snapshots
- optional short pre/post buffers for later debugging

### 12.2 Naming
Use deterministic paths:
- `games/<gameId>/move-001/raw.jpg`
- `games/<gameId>/move-001/warp.jpg`
- `games/<gameId>/move-001/analysis.json`
- `games/<gameId>/events.ndjson`
- `games/<gameId>/calibration/reference.jpg`

### 12.3 Log Report
The `Log report` feature should now be server-backed.

When the user requests a log report:
1. the server assembles the current game’s event log and artifacts
2. it produces a compressed bundle or manifest
3. the PWA downloads that bundle
4. the PWA opens a GitHub issue draft with instructions to attach it

This is a better fit than asking the browser to assemble large artifact payloads from local state.

## 13. Testing Strategy

### 13.1 Core Principle
The new architecture should make playback-driven testing first-class.

Instead of treating real-device usage as the only ground truth, we should be able to replay recorded server inputs and assert:
- localization quality
- occupancy results
- move-settle timing
- emitted event sequences

### 13.2 Test Inputs
We should support at least three fixture forms:
- still image sequences
- recorded MJPEG/JPEG frame sequences
- exported game-log bundles from real sessions

### 13.3 Test Layers
- unit tests:
  - fingerprinting
  - settle-state machine
  - reducer behavior
- integration tests:
  - replay recorded frames through the server pipeline
  - assert emitted server events and saved artifacts
- browser e2e tests:
  - mock the server API and event stream
  - verify the PWA renders server state correctly
  - do not require browser OpenCV

### 13.4 Golden Playback Tests
The server should support a test mode that consumes a fixture directory as if it were a live camera source. That allows deterministic cases like:
- empty board
- initial setup
- move in progress
- move settled
- shadow sweep
- hand occlusion

### 13.5 Performance Tests
We should add explicit tests and benchmarks for:
- max sustained analysis rate
- CPU usage on the target server hardware
- per-frame latency
- dropped-frame behavior under load

## 14. Migration Plan

### Phase 1: Design and Extraction
- finalize the server-side design
- extract the Node vision pipeline into reusable server-side modules
- define server events and artifact format

### Phase 2: Server MVP
- connect to ESP32 stream
- run calibration and occupancy server-side
- expose latest board state and diagnostics over API

### Phase 3: PWA as Thin Client
- remove browser OpenCV and webcam capture path
- replace local analysis with server snapshots and event subscription
- keep the existing visual calibration UX, but back it with server calls

### Phase 4: Move Completion and Artifact Review
- emit committed move events server-side
- store canonical artifacts
- expose log-report bundles and replay fixtures

### Phase 5: Clock and Move Recording
- drive automatic clock switching from committed server events
- add move reconstruction on top of committed states

## 15. Risks

### 15.1 Network Reliability
The PWA now depends on server reachability. We need explicit UI states for:
- server disconnected
- camera disconnected
- stale frame age

### 15.2 Stream Decode Complexity
MJPEG parsing and reconnect behavior can be messy. The server should tolerate:
- dropped TCP connections
- malformed partial frames
- ESP32 restarts

### 15.3 Calibration Drift
If the physical camera moves, the server will happily keep analyzing bad geometry unless drift is detected and surfaced clearly.

### 15.4 Single Point of Failure
The server becomes the operational dependency for the whole system. That is acceptable for the MVP, but should be stated clearly.

## 16. Open Questions
- What exact server runtime do we want for the MVP: Node process inside the existing app, or a separate service?
- Should the server decode MJPEG continuously, or should the ESP32 also expose a single-frame snapshot endpoint that the server polls?
- Where should server artifacts live in development vs production?
- Do we want SSE or WebSocket first?
- How much of the current Redux action log should remain persisted client-side once the server owns the authoritative event stream?
- Should calibration edits apply immediately, or should the user explicitly save and activate them?

## 17. Recommendation
Stop investing in browser-side OpenCV and browser webcam capture. Treat the ESP32 stream as the only live image source, move all vision and move-settle logic to a server-side pipeline, and make the PWA a thin event-driven client.

This gives us a better thermal profile, a cleaner testing story, more reliable observability, and a path to deterministic move-capture tuning based on recorded server artifacts instead of browser-local heuristics.
