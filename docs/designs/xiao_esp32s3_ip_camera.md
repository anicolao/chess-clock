# Design Document: IP Camera for Move Tracking & Clock Advancement

## 1. Overview
This document outlines the design for an IP camera implementation using the **Seeed Studio XIAO ESP32S3 Sense** written in C. The primary purpose of this camera is to capture the state of a physical chessboard and stream the imagery to a backend system responsible for move tracking and automatic clock advancement.

## 2. Hardware Considerations
- **Microcontroller**: Seeed Studio XIAO ESP32S3 Sense (Dual-core Xtensa LX7, 8MB PSRAM, 8MB Flash).
- **Camera Sensor**: OV2640 (included with the Sense board).
- **Network**: Integrated 802.11 b/g/n Wi-Fi.
- **Power**: 5V via USB-C or 3.7V via Lipo battery pad.

## 3. Software Architecture
The firmware will be written in C, utilizing the **ESP-IDF** (Espressif IoT Development Framework) along with FreeRTOS for task management.

### 3.1. Core Subsystems
1. **Wi-Fi Subsystem**: Responsible for maintaining a persistent connection to the local network. Includes auto-reconnect logic and static IP / mDNS configuration for reliable discovery by the central tracking server.
2. **Camera Subsystem**: Utilizes the `esp32-camera` driver to interface with the OV2640. 
   - **Resolution**: UXGA (1600x1200) or SVGA (800x600). SVGA is recommended to maintain a higher framerate and reduce network latency while providing enough detail for computer vision processing.
   - **Format**: JPEG (for MJPEG streaming).
3. **HTTP Streaming Subsystem**: An embedded HTTP server (using `esp_http_server`) that provides a persistent MJPEG stream to clients.
4. **Control API**: A lightweight REST API running on the same HTTP server to adjust camera settings (exposure, white balance, resolution) dynamically depending on ambient room lighting.

### 3.2. Data Flow
1. **Capture**: The ESP32S3 triggers a frame capture via I2S/DMA from the OV2640.
2. **Compress**: The OV2640 is configured to output JPEG directly, saving CPU cycles and memory.
3. **Stream**: The frame is pushed to an HTTP chunked response queue for connected clients.
4. **Processing (Host-side)**: The main move tracking system pulls the MJPEG stream, compares frames, detects hand presence (to wait for move completion), tracks piece movement, and updates the chess clock state.

## 4. Wi-Fi Provisioning & Phone Pairing
To ensure a seamless user experience without requiring hardcoded network credentials, the camera will utilize a QR-code-based provisioning and pairing flow:
1. **QR Code Generation**: The user opens the Chess Clock PWA on their phone and provides their local Wi-Fi SSID and password. The PWA generates a QR code containing these credentials along with a unique, securely generated "pairing token".
2. **Scanning**: Upon boot-up, if no Wi-Fi credentials are saved in non-volatile storage (NVS), the ESP32S3 enters a provisioning mode. It captures frames and runs a lightweight QR code decoding library (e.g., `quirc`).
3. **Connection**: The user holds the PWA's generated QR code in front of the camera lens. Once decoded, the camera connects to the Wi-Fi network and saves the credentials and the pairing token to NVS.
4. **Discovery**: The camera announces its presence on the local network via mDNS (e.g., `chess-cam.local`).
5. **Authentication**: The PWA attempts to communicate with the camera using the mDNS hostname or by scanning local IP ranges. It authenticates its requests using the pairing token previously shared via the QR code. This ensures only the paired phone can control the camera and access its video feed.

## 5. PWA Integration & Image Retrieval
The PWA running on the phone must reliably fetch images from the camera for computer vision processing.
1. **Direct Local Network Access**: The PWA communicates directly with the camera's local IP over the local Wi-Fi network. *(Note: To mitigate Mixed Content errors in browsers since the PWA is typically HTTPS and the camera is local HTTP, the system will rely on standard secure-context exceptions for local IPs, or require specific user permission for local network queries).*
2. **Image Fetching Strategies**:
   - **Snapshot Polling (Preferred for Computer Vision)**: The PWA periodically requests a single JPEG frame by calling a `/capture` REST endpoint via `fetch()`. This allows the PWA to tightly control the frame rate (e.g., 2-5 FPS), conserving phone battery and network bandwidth. The fetched JPEG is drawn onto a `<canvas>` element where image differencing and move-detection algorithms are executed.
   - **MJPEG Stream (For Live Preview)**: For displaying a live feed to the user, the PWA can use a standard HTML `<img>` tag with the `src` attribute pointed to the camera's `/stream` endpoint.
3. **CORS Configuration**: The ESP32S3's embedded HTTP server will be configured to send Cross-Origin Resource Sharing (CORS) headers (e.g., `Access-Control-Allow-Origin: *`) to allow the PWA to fetch resources without being blocked by the browser.

## 6. Move Tracking & Clock Advancement Integration
Since the ESP32S3 acts purely as an IP camera, network latency and frame stability are critical to accurate clock advancement.
- **Low Latency**: The firmware will disable Nagle's algorithm (`TCP_NODELAY`) and prioritize the streaming task to ensure sub-100ms camera-to-network latency.
- **Exposure / Lighting Controls**: Chess events can have varying lighting. The firmware will expose endpoints to lock exposure and white balance to prevent auto-adjustments from triggering false "move" detections in the host's difference-checking algorithms.
- **Future Enhancement (Edge AI)**: The ESP32S3 includes vector instructions (AI acceleration). While the current design relies on a host system for heavy computer vision, future iterations could utilize Edge Impulse or ESP-DL to detect "hand over board" events locally to trigger the clock instantly, avoiding network round-trip overhead.

## 7. Security & Deployment
- Over-The-Air (OTA) updates will be supported to push new firmware easily without dismantling the camera rig.
- Simple Basic Auth or token-based authentication on the MJPEG stream endpoint will be implemented to prevent unauthorized access.

## 8. Development Milestones
1. **Phase 1**: Hardware bring-up, ESP-IDF environment setup, Wi-Fi connectivity.
2. **Phase 2**: Camera driver initialization and static image capture.
3. **Phase 3**: MJPEG streaming implementation and performance tuning (framerate vs. resolution).
4. **Phase 4**: REST API for configuration (exposure, white balance, OTA).
5. **Phase 5**: Integration testing with the main move-tracking server.
