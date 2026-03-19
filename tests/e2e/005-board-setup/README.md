# Test: Setup screen detects the board from a mocked webcam frame

## Settings screen connects to the mocked webcam and shows the live game board frame

![Settings screen connects to the mocked webcam and shows the live game board frame](./screenshots/000-000-stream-ready.png)

**Verifications:**
- [x] Live frame is streaming
- [x] Auto-detect becomes available once the webcam is live

---

## Setup screen detects the board and saves the empty-board calibration

![Setup screen detects the board and saves the empty-board calibration](./screenshots/001-001-quad-adjusted-and-saved.png)

**Verifications:**
- [x] Board auto-detect updates the quad from the mocked webcam frame
- [x] A detected corner handle can still be dragged afterward
- [x] The empty-board reference can be captured and saved locally

---
