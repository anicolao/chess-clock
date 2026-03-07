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

## 4. Move Tracking & Clock Advancement Integration
Since the ESP32S3 acts purely as an IP camera, network latency and frame stability are critical to accurate clock advancement.
- **Low Latency**: The firmware will disable Nagle's algorithm (`TCP_NODELAY`) and prioritize the streaming task to ensure sub-100ms camera-to-network latency.
- **Exposure / Lighting Controls**: Chess events can have varying lighting. The firmware will expose endpoints to lock exposure and white balance to prevent auto-adjustments from triggering false "move" detections in the host's difference-checking algorithms.
- **Future Enhancement (Edge AI)**: The ESP32S3 includes vector instructions (AI acceleration). While the current design relies on a host system for heavy computer vision, future iterations could utilize Edge Impulse or ESP-DL to detect "hand over board" events locally to trigger the clock instantly, avoiding network round-trip overhead.

## 5. Security & Deployment
- Over-The-Air (OTA) updates will be supported to push new firmware easily without dismantling the camera rig.
- Simple Basic Auth or token-based authentication on the MJPEG stream endpoint will be implemented to prevent unauthorized access.

## 6. Development Milestones
1. **Phase 1**: Hardware bring-up, ESP-IDF environment setup, Wi-Fi connectivity.
2. **Phase 2**: Camera driver initialization and static image capture.
3. **Phase 3**: MJPEG streaming implementation and performance tuning (framerate vs. resolution).
4. **Phase 4**: REST API for configuration (exposure, white balance, OTA).
5. **Phase 5**: Integration testing with the main move-tracking server.
