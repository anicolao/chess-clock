# Move Completion Frame Capture Design Document

## 1. Introduction
This document defines the design for capturing a canonical board frame each time a chess move is completed. The goal is to turn the current live occupancy preview into a reliable event source that can later drive two higher-level behaviors:

1. automatic clock switching
2. automatic move recording

The current application already localizes the board, warps it into a stable top-down view, and computes square occupancy from a saved empty-board reference. This design builds on that pipeline and adds a state machine that decides when a move has actually completed, which exact frame should be persisted, and what metadata must be recorded alongside it.

The UI should keep the current game state in Redux. The move-completion pipeline should emit Redux actions, and the persisted debugging history for a game should be the IndexedDB-backed Redux action log for that session.

## 2. Goals
- Capture exactly one canonical board frame for each completed move.
- Avoid capturing transient frames while a hand is in the scene or a piece is mid-move.
- Produce artifacts that are useful both for debugging and for later move reconstruction.
- Reuse the current browser-based calibrated board pipeline rather than creating a second recognition path.
- Provide a clear contract between board vision, clock control, and future move-recording logic.

## 3. Non-Goals
- Full SAN or UCI move generation in this phase.
- Full piece-type classification in this phase.
- Network upload, cloud sync, or permanent remote storage.
- Solving every occlusion case in the first implementation.
- Modifying the hardware or firmware transport layer.

## 4. Definitions

### 4.1 Raw Frame
The uncropped camera image sampled from the current webcam or remote stream.

### 4.2 Board Frame
The raw frame after applying the saved board quad and perspective warp into a square top-down image.

### 4.3 Board State
The structured recognition result for one sampled frame. For this design, the minimum useful state is:
- occupied squares
- white/black piece color per occupied square
- per-square confidence metrics

### 4.4 Stable State
A board state that remains materially unchanged across a configurable window of consecutive analysis samples.

### 4.5 Move Completion Event
The moment the system decides that one stable board state has transitioned to another stable board state and the new state should be accepted as the post-move truth.

### 4.6 Canonical Captured Frame
The single saved frame representing the accepted post-move board position.

## 5. Product Requirements

### 5.1 Functional Requirements
- The app must continuously analyze the live board during active play.
- The app must detect when the board leaves a stable state.
- The app must detect when the board settles into a new stable state.
- The app must capture and persist one canonical frame for that new stable state.
- The capture record must include enough metadata to reconstruct why the frame was accepted.

### 5.2 Quality Requirements
- False captures during hand motion must be rare.
- Duplicate captures for the same move must be prevented.
- Captures must be aligned with the saved board quad and current calibration.
- The mechanism must keep the UI responsive.
- Debugging a bad capture must be possible from stored artifacts and logs.

## 6. Current Baseline
The existing system already provides:
- a saved board calibration
- a live board warp
- occupancy detection from an empty-board reference
- white/black occupancy discs in the warped preview

The missing layer is event logic. The current system can tell what the board looks like in an individual frame, but it does not yet decide:
- whether the board is stable
- whether a move is in progress
- when the move finished
- which frame should be saved

## 7. High-Level Architecture

### 7.1 Components
- `Frame Sampler`
  Reads frames from the live camera source at a bounded cadence.
- `Board Analyzer`
  Produces the current warped board image plus the structured board state.
- `Move Completion Engine`
  Maintains temporal history and detects stable-state transitions.
- `Redux Store`
  Holds the live game state for the UI and receives move-completion events as first-class actions.
- `Capture Store`
  Persists the Redux action log and accepted move-completion artifacts locally in IndexedDB.
- `Clock Integration Layer`
  Consumes accepted move-completion events later to switch turns.
- `Move Reconstruction Layer`
  Consumes capture records later to infer and record moves.

### 7.2 Separation of Concerns
- Vision should answer: "What does the board look like in this frame?"
- Event logic should answer: "Has a move completed?"
- Redux should answer: "What is the current authoritative UI/game state?"
- Storage should answer: "What actions and artifacts were captured, and why?"
- Clock logic should answer later: "Should the active side switch now?"

That separation is important because the capture system must become the foundation for both auto-clock and move-recording without entangling all three concerns.

## 8. State Machine
The move-capture engine should be explicit and deterministic.

### 8.1 States
- `uncalibrated`
  No valid board calibration or reference frame exists.
- `idle`
  The game has not started yet. Stable board analysis may run, but move captures are not emitted.
- `stable`
  The board is considered settled and matches the last accepted board state.
- `transitioning`
  The board is changing, likely because a move is underway.
- `candidate_stable`
  A new board state appears settled, but has not yet satisfied the full acceptance window.
- `capture_committed`
  A new state has been accepted and a canonical frame has been recorded.

### 8.2 Normal Flow
1. Start in `stable` with the initial accepted board state.
2. Detect enough change from the last accepted state to enter `transitioning`.
3. While states continue fluctuating, remain in `transitioning`.
4. When successive samples begin matching one another, enter `candidate_stable`.
5. If the candidate remains stable long enough, emit a move-completion event and enter `capture_committed`.
6. Persist the accepted frame and transition back to `stable`.

### 8.3 Rejection Flow
If the board changes and then returns to the prior accepted state:
- treat it as aborted motion
- discard the candidate
- return to `stable`

This covers cases like hovering a hand, lifting a piece, and putting it back.

## 9. Board-State Representation
The move-completion engine should not work from raw pixels alone. It should consume a structured snapshot and emit a Redux action when a move is committed.

Recommended per-sample payload:
- `timestampMs`
- `cameraMode`
- `rawFrameSize`
- `warpSize`
- `occupiedSquares: number[]`
- `occupiedPieces: Array<{ index: number, color: 'white' | 'black' }>`
- `occupancyScores: number[]`
- `referenceScores: number[]`
- `boardImageDataUrl` or in-memory image blob
- `analysisHealth`
  Includes flags like `boardMissing`, `referenceMissing`, `lowConfidence`

This structure is rich enough to support debugging and later move inference without reanalyzing every raw frame from scratch.

## 10. How to Detect "Move Completed"

### 10.1 Frame Cadence
Use a bounded cadence such as 4-6 analyzed frames per second during active play. This is fast enough to detect changes while keeping CPU predictable.

### 10.2 Stable-State Fingerprint
Each analyzed frame should yield a normalized fingerprint:
- sorted occupied indices
- occupied piece colors

This fingerprint should ignore tiny score jitter that does not change board meaning. Raw occupancy/reference scores may still be carried in the Redux action payload for debugging and later reducer tuning, but they should not be part of the MVP fingerprint.

### 10.3 Transition Detection
Enter `transitioning` when the current fingerprint differs materially from the last accepted stable state. Material difference means one or more of:
- occupied square added or removed
- occupied piece color changed on a square
- too many per-square confidence changes at once, indicating motion or occlusion

### 10.4 Candidate Stability Window
A candidate post-move state should only be accepted after matching for `N` consecutive samples or `T` milliseconds.

Recommended MVP defaults:
- `N = 3` consecutive matching analyzed frames
- minimum stable dwell of `400-700ms`

The exact numbers should remain configurable.

### 10.5 Acceptance Rule
Accept the candidate as a completed move when:
- the board has left the old stable state
- the new fingerprint has remained stable for the configured window
- the analyzer still sees a valid localized board
- no "board obscured" or "low confidence" health flag is active

### 10.6 Deduplication
Do not emit a new capture if the newly accepted fingerprint is identical to the most recently committed fingerprint.

## 11. What Frame to Save
When a candidate becomes accepted, save more than one representation.

### 11.1 Required Artifacts
- original raw frame
- warped top-down board image
- structured board-state JSON
- event metadata JSON

### 11.2 Canonical Frame Choice
The canonical saved frame should be the final sample that satisfied the stability rule, not the first sample that looked promising. That biases toward a fully settled piece placement.

### 11.3 Optional Ring Buffer
Maintain a short rolling buffer of the last few analyzed frames. This allows later expansion to also save:
- one pre-move frame
- one mid-transition frame
- one post-move canonical frame

For the MVP, only the canonical post-move frame needs to be committed, but the ring buffer is useful to include in the design because it simplifies later debugging and move reconstruction.

## 12. Capture Record Format
Each committed move-completion event should produce one record like:

```json
{
  "captureId": "uuid-or-sequence",
  "gameId": "session-id",
  "moveIndex": 12,
  "capturedAtMs": 1760000000000,
  "source": "browser-webcam",
  "calibrationVersion": 3,
  "occupancyThreshold": 3.25,
  "acceptedAfterSamples": 3,
  "acceptedAfterMs": 540,
  "previousFingerprint": "...",
  "nextFingerprint": "...",
  "occupiedPieces": [
    { "index": 0, "color": "white" }
  ],
  "artifacts": {
    "rawFramePath": "...",
    "warpedBoardPath": "...",
    "analysisJsonPath": "..."
  }
}
```

## 13. Storage Strategy

### 13.1 MVP Storage
Store captures locally in browser-managed storage first:
- IndexedDB table for persisted Redux actions for the current game
- IndexedDB payload storage for image-heavy move-completion action content
- optional lightweight local manifest for browsing captures by game later

IndexedDB is preferable to localStorage because the artifacts include image blobs and the primary debugging unit is the ordered Redux action stream.

### 13.2 Retention
Use per-game retention with explicit cleanup rules. The app should be able to:
- keep only the current game
- keep the last `N` games
- export captures before deletion later

### 13.3 Naming
Use monotonic move indices rather than timestamps in filenames when possible:
- `game-<id>/move-001/raw.jpg`
- `game-<id>/move-001/warp.jpg`
- `game-<id>/move-001/analysis.json`

That makes review easier and aligns with later PGN reconstruction.

## 14. Relationship to Automatic Clock Switching
Automatic clock switching should not key off a raw occupancy diff. It should key off a committed move-completion event.

### 14.1 Why
If the clock switches during `transitioning`, it will be wrong whenever:
- a player hovers a piece
- a hand occludes squares
- the board briefly appears unstable

### 14.2 Contract
The clock subsystem should later subscribe to the committed Redux event:
- `game/moveCompletionCommitted(previousState, nextState, captureRecord)`

The clock then decides:
- whose clock should stop
- whose clock should start
- whether the move is legal enough to accept automatically

This design keeps the capture system as the authoritative temporal boundary between moves. The clock switch should always happen automatically as a downstream consequence of these committed events, but that clock automation is not part of the MVP implementation in this branch.

## 15. Relationship to Automatic Move Recording
The capture system is not itself the move recorder, but it must make move recording possible.

### 15.1 Minimal Requirement
Every committed capture must include enough state to compare:
- previous accepted board state
- next accepted board state

### 15.2 Future Move Reconstruction
Later logic can infer:
- source square
- destination square
- captures
- promotions
- castling

That move-reconstruction layer should operate on committed stable states only.

## 16. Observability and Debuggability
This system will be difficult to tune without explicit observability.

Required diagnostics per candidate and commit:
- sample timestamp
- current state-machine state
- stable-sample count
- changed square indices
- occupied piece count
- white piece count
- black piece count
- reason for acceptance or rejection

Recommended UI/debug surfaces:
- a debug panel showing `stable`, `transitioning`, or `candidate_stable`
- a move-capture event log
- thumbnails of recent canonical captured frames
- a per-game capture review page later
- a `Log report` action that turns the current game into a GitHub issue draft plus a downloadable JSON artifact bundle

## 17. Failure Modes

### 17.1 Hand or Arm Occlusion
Symptom:
- many squares change at once
- confidence collapses

Handling:
- stay in `transitioning`
- do not accept a candidate until stability returns

### 17.2 Lighting Shift or Shadow Sweep
Symptom:
- per-square scores rise globally without a coherent board-state change

Handling:
- rely on the already calibrated threshold plus stable-state matching
- reject candidates with too many simultaneous low-confidence changes

### 17.3 Calibration Drift
Symptom:
- warped grid no longer lines up with squares

Handling:
- emit health warnings
- pause automatic move capture
- require recalibration rather than recording bad moves

### 17.4 Missed Single Piece
Symptom:
- one square such as `b1` disappears due to thresholding

Handling:
- record the confidence profile in the candidate
- keep threshold configurable
- later add reconciliation against expected legal piece counts and legal moves

## 18. Recommended MVP Rollout

### Phase 1
Add the move-completion state machine, emit Redux move-completion actions, and commit the action log plus canonical captures to local storage.

Success criteria:
- one capture per completed move
- no duplicate captures for a single move
- stable debug log

### Phase 2
Add a capture review UI:
- list moves in order
- show raw frame, warped frame, and analyzed board state

Success criteria:
- easy manual validation of the captured sequence

### Phase 3
Use committed captures to drive automatic clock switching.

Success criteria:
- no premature clock flips during piece motion

### Phase 4
Use committed captures plus board-state diffs to produce automatic move records.

Success criteria:
- consistent move reconstruction across a full game

## 19. Recommended Initial Configuration
These are implementation defaults, not hard requirements:

- analyzed cadence: `4 Hz`
- candidate stable window: `3 consecutive samples`
- minimum stable dwell: `500 ms`
- duplicate-suppression window: until fingerprint changes again
- persisted artifact set:
  - raw frame
  - warped frame
  - analysis JSON

## 20. Open Questions
- Should a move completion also require the clock tap, or should vision alone be authoritative?
- Should the game begin only after a recognized initial setup, or can it begin from any stable calibrated state?
- Should the canonical raw frame always be stored, or is warped-frame-only sufficient for the MVP?
- How should we expose local captured frames for manual export and review beyond the initial GitHub issue draft + JSON bundle flow?
- When move reconstruction disagrees with the clock tap order, which source wins?

## 21. Recommendation
Implement move-completion capture as a temporal state machine layered on top of the existing calibrated board analyzer. Treat the committed stable post-move frame as the canonical event boundary for both automatic clock switching and future move recording.

This approach preserves the parts of the vision stack that are now working well, adds the missing temporal semantics, and creates a clean artifact trail for debugging and future expansion.
