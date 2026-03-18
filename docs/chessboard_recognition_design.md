# Chessboard Position Recognition Design Document

## 1. Introduction
This document outlines the high-level design for recognizing chessboard positions from incoming images within the web application. The MVP will focus on processing a media stream from a standard webcam. The architecture is designed to be easily extensible in the future to support raw JPEG images sent from an embedded camera system.

## 2. Technology Stack
* **Image Capture:** HTML5 MediaDevices API (WebRTC) for accessing the webcam stream.
* **Computer Vision:** A WebAssembly-compiled Computer Vision library (such as OpenCV.js) running directly in the browser.
* **Processing Environment:** Web Workers to perform computationally intensive image analysis off the main UI thread, ensuring the web interface remains highly responsive.

## 3. Architecture Overview
The system extracts frames from a continuous video feed, passes them to a background worker for analysis, and returns a structured representation of the board state. This state is then compared against the rules of chess to deduce the actual moves played by the users.

### 3.1 Input Source (MVP)
A live webcam feed will be streamed into an off-screen or UI-embedded video element. Periodically, the application will snapshot the current frame onto a canvas element, extract the raw image data, and send it to the processing worker.

## 4. Image Processing Pipeline
The core of the recognition engine consists of a sequential pipeline of computer vision transformations.

### Step A: Preprocessing
The incoming raw image is converted to grayscale to reduce computational complexity. Noise reduction techniques (such as Gaussian blurring) are applied, followed by edge detection algorithms to highlight boundaries within the image.

### Step B: Board Localization
The system detects contours within the edge-mapped image. The system identifies candidate quadrilateral shapes that could represent individual chessboard squares. Starting with squares near the center of the image, it extrapolates an 8x8 grid and validates it against the expected alternating light and dark checkerboard pattern. Once a valid grid is found, a local search optimization fine-tunes the outer boundary corners to perfectly snap to the board edges, ensuring a tight encasement. A perspective transformation is then applied to warp the detected board area into a perfectly square, top-down, 2D orientation.

### Step C: Grid Segmentation
The flattened, top-down board image is geometrically subdivided into a consistent 8x8 grid, representing the 64 squares of the chessboard.

### Step D: Square Analysis & Piece Classification
Each isolated square is individually analyzed to determine two things:
1. Is the square occupied by a piece or is it empty?
2. If occupied, what is the color and type of the piece?
This step will utilize background subtraction (comparing against known empty square colors) and feature matching or a lightweight web-based classification model to identify the specific piece.

### Step E: State Output
The pipeline aggregates the classifications of all 64 squares into a unified board state format, such as Forsyth-Edwards Notation (FEN).

## 5. State Reconciliation and Error Handling
Computer vision is inherently prone to occasional errors (e.g., a player's hand blocking the camera, lighting changes, moving shadows). The engine will include a reconciliation layer:
* **Temporal Smoothing:** Require a recognized board state to remain stable over multiple consecutive frames before accepting it as the new truth.
* **Rule-Based Validation:** Compare the newly detected board state with the previously known valid state. The transition between states must represent a legal chess move. If a detected state is impossible (e.g., missing a king, or a piece appearing out of nowhere), it is discarded as a visual anomaly or an intermediate state (e.g., a piece mid-move).
* **Calibration UI:** The web application will provide a visual overlay showing the detected board outline over the live camera feed, allowing users to manually adjust the camera angle or lighting if automatic localization struggles.

## 6. Future Considerations for Embedded System Integration
When migrating from the webcam MVP to the embedded system hardware, the core processing architecture will remain identical. Instead of capturing frames from a local media stream, the web application will receive discrete JPEG images transferred over the network from the embedded hardware. These images will bypass the webcam capture step and be injected directly into the beginning of the Image Processing Pipeline.
