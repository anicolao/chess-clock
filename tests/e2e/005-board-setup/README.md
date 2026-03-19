# Test: Setup screen works with the mocked webcam game frame

## Settings screen connects to the mocked webcam and shows the live game board frame

![Settings screen connects to the mocked webcam and shows the live game board frame](./screenshots/000-000-stream-ready.png)

**Verifications:**
- [x] Live frame is streaming
- [x] Auto-detect becomes available once the webcam is live
- [x] The mocked webcam frame is `tests/images/game/empty.jpg`

---

## Setup screen runs the browser OpenCV contour detector, detects the board on the mocked frame, and saves calibration

![Setup screen runs the browser OpenCV contour detector, detects the board on the mocked frame, and saves calibration](./screenshots/001-001-quad-adjusted-and-saved.png)

**Verifications:**
- [x] Board auto-detect updates the quad from the mocked webcam frame
- [x] Browser OpenCV contour detection finds the initial board quad from `tests/images/game/empty.jpg`
- [x] A detected corner handle can still be dragged afterward
- [x] The empty-board reference can be captured and saved locally

---
