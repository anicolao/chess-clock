# Design Document: ESP32 Camera Testing Strategy

## 1. Overview
This document outlines a comprehensive testing strategy for the Seeed Studio XIAO ESP32S3 Sense IP Camera firmware. Given the iteration time costs associated with compiling, flashing, and physically interacting with embedded hardware, this testing plan aims to minimize on-device cycles by maximizing simulation and emulation. The ultimate goal is to validate the entire application logic before a single line of code is flashed to the physical device.

## 2. Testing Tiers
To achieve a robust testing pipeline, we will implement a multi-tiered approach:

1. **Host-Based Unit Testing (Fastest, Highest Frequency)**
2. **Emulation / Simulation (Medium Speed, Integration Testing)**
3. **Hardware-in-the-Loop (HIL) Testing (Slowest, Final Validation)**

### 2.1. Host-Based Unit Testing
The majority of the business logic (e.g., HTTP routing, QR code decoding logic, state machine for provisioning) should be completely decoupled from the hardware dependencies (ESP-IDF, FreeRTOS, Camera drivers).

- **Framework**: Unity or Catch2, running locally on the developer's host machine (Linux/macOS/Windows) or via CI.
- **Mocking**: Hardware-specific calls (e.g., `esp_wifi_connect`, `esp_camera_fb_get`) will be mocked using a framework like CMock or FFF (Fake Function Framework).
- **Execution**: These tests will run on every commit in a fraction of a second.
- **Coverage**: Expected to cover 100% of network protocol parsing, JSON serialization/deserialization, and state management.

### 2.2. Emulation / Simulation
To test the integration between our code and the ESP-IDF framework without physical hardware, we will utilize emulation.

- **Tool**: QEMU for Xtensa (ESP32-S3 support) or Wokwi.
  - **Wokwi** provides excellent support for ESP32 and can simulate Wi-Fi traffic and basic peripherals. We can integrate Wokwi CLI into our CI pipeline.
  - **QEMU** via Espressif's fork allows running the compiled firmware binary in a simulated environment.
- **Capabilities**:
  - We can simulate the Wi-Fi stack and network connectivity, allowing a host script to interact with the simulated ESP32's HTTP server.
  - **Camera Simulation**: The OV2640 driver must be stubbed or replaced in the simulated build. Instead of reading I2S/DMA data from a physical sensor, the simulated driver will read static JPEG images (representing chessboard states or QR codes) from a simulated SPIFFS/LittleFS partition or host filesystem.
- **CI Integration**: A GitHub Actions workflow will build the firmware, launch it in the emulator, and run integration tests against the exposed network endpoints (e.g., fetching a simulated `/capture` endpoint and verifying the returned JPEG).

### 2.3. Hardware-in-the-Loop (HIL) Testing
The final tier validates the actual hardware timing, real Wi-Fi RF performance, and physical camera sensor integration.

- **Setup**: A dedicated ESP32-S3 board connected via USB to a CI runner (e.g., a self-hosted runner on a Raspberry Pi or local server).
- **Test Runner**: Pytest with the `pytest-embedded` plugin (officially supported by Espressif).
- **Execution**:
  - The CI runner flashes the compiled firmware to the attached device.
  - The device connects to a dedicated test Wi-Fi network.
  - The runner script captures serial output for debugging and sends HTTP requests to the device over the network.
  - **Validation**: Measures actual latency, memory leaks over time, and camera framerate stability.

## 3. Specific Subsystem Test Plans

### 3.1. Provisioning & Phone Pairing
- **Host Testing**: Feed mock QR code payloads into the decoding library and verify the extracted SSID, password, and pairing token.
- **Emulation**: Simulate the camera driver reading an image of a QR code from a file. Verify the simulated ESP32 transitions from "Provisioning Mode" to "Connected Mode" and publishes the correct mDNS record.

### 3.2. HTTP Streaming & Image Retrieval
- **Emulation**: Run the embedded HTTP server in QEMU/Wokwi. A Python test script makes concurrent requests to the `/capture` and `/stream` endpoints to ensure the server does not crash under load and returns valid HTTP headers and CORS configuration.
- **HIL**: Measure the physical network latency and verify the camera can sustain the required FPS without dropping frames or running out of PSRAM.

### 3.3. Control API
- **Host Testing**: Test the REST API routing logic with mocked hardware functions.
- **Emulation**: Send JSON payloads to adjust exposure/white balance and verify the internal state is updated.

## 4. CI/CD Pipeline Integration
1. **PR Created**:
   - Linter runs (e.g., `clang-format`).
   - Host-based unit tests execute.
   - Firmware compiles for the ESP32-S3 target (verifies no syntax/linking errors).
2. **Post-Compilation**:
   - Emulation integration tests run (Wokwi/QEMU).
3. **Merge to Main / Release**:
   - HIL tests execute on the physical test bench.
   - Firmware binaries are published as GitHub Releases for OTA updates.

## 5. Conclusion
By investing in Host-Based Unit Testing and Emulation upfront, we can drastically reduce the "compile-flash-debug" cycle time. Developers can validate network protocols, state machines, and API logic entirely on their local machines, reserving physical hardware testing for final validation of timing and sensor integration.
