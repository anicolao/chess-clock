# Design Document: ESP32 MVP Provisioning & Phone Pairing

## 1. Overview
This document specifies the Minimum Viable Product (MVP) design for provisioning the Seeed Studio XIAO ESP32S3 Sense and pairing it with the Chess Clock PWA. The goal is a seamless, secure, and user-friendly setup process that requires no hardcoded credentials and minimal user intervention.

## 2. User Flow
1. **Initiation**: The user opens the Chess Clock PWA on their mobile device.
2. **Credential Entry**: The user navigates to the "Add Camera" section and enters their local Wi-Fi SSID and Password.
3. **QR Generation**: The PWA generates a QR code containing the network credentials and a securely generated "pairing token".
4. **Scanning**: The user points the unprovisioned ESP32 camera at the phone screen displaying the QR code.
5. **Connection & Discovery**: The ESP32 reads the QR code, connects to the Wi-Fi network, saves the credentials and token, and announces itself via mDNS.
6. **Confirmation**: The PWA discovers the camera on the local network, verifies the connection using the pairing token, and displays a "Camera Connected" success message to the user.

## 3. Technical Architecture

### 3.1. Payload Specification
The QR code will contain a JSON payload encoded as a minimal string to reduce QR code density.
Example:
`{"ssid":"MyNetwork","pass":"Secret123","token":"abc123xyz"}`
Where `ssid` is SSID, `pass` is Password, and `token` is a randomly generated Pairing Token.

### 3.2. State Machine
The Provisioning system will operate on the following state machine:
- `PROV_STATE_UNPROVISIONED`: Initial state. Waiting for QR payload.
- `PROV_STATE_PROVISIONING`: Parsing payload, attempting Wi-Fi connection.
- `PROV_STATE_PROVISIONED`: Wi-Fi connected, NVS updated, mDNS announced.
- `PROV_STATE_ERROR_PAYLOAD`: Invalid or unreadable payload.
- `PROV_STATE_ERROR_WIFI`: Failed to connect to Wi-Fi.
- `PROV_STATE_ERROR_NVS`: Failed to save credentials to Non-Volatile Storage.
- `PROV_STATE_ERROR_MDNS`: Failed to announce via mDNS.

### 3.3. Security
- Credentials and the pairing token will be stored in the ESP32's NVS (Non-Volatile Storage).
- The pairing token acts as a shared secret between the specific browser session and the camera, ensuring that only the user who provided the credentials can pair with the camera, mitigating rogue camera connections on shared networks.

## 4. Development & Testing Plan

To ensure high confidence before flashing to physical hardware, the implementation will strictly follow a simulation-first approach using QEMU and host-based testing. This allows us to validate the state machine, network logic, and pairing process without waiting on physical deployment loops.

### Phase 1: Environment & Emulator Setup
1. **ESP-IDF Toolchain & QEMU Setup**: Ensure the Nix environment provides the complete ESP-IDF toolchain and QEMU compiled specifically for the ESP32-S3 architecture (`qemu-system-xtensa`).
2. **Emulator Verification**: Compile a basic "Hello World" or blink application and execute it successfully in QEMU to validate the emulation pipeline.
3. **Automated Test Runner**: Set up `pytest` alongside the `pytest-embedded` and `pytest-embedded-qemu` plugins to script and assert interactions with the simulated device via its serial port.

### Phase 2: Core Provisioning Logic & Host Tests (In Progress)
1. **QR Decoding (Completed)**: Integrate `quirc` for QR code detection and extraction from an image buffer.
2. **Payload Parsing**: Use a lightweight library (like ESP-IDF's included `cJSON`) to parse the `ssid`, `pass`, and `token` from the extracted QR payload.
3. **State Machine**: Implement the `PROV_STATE_*` state machine logic.
4. **Host Unit Tests**: Expand the existing host-based unit tests (`test_provisioning.cpp`) to comprehensively test payload parsing, valid/invalid state transitions, and error handling entirely decoupled from the ESP-IDF framework.

### Phase 3: Hardware Abstraction & Camera Mocking
1. **Camera HAL (Hardware Abstraction Layer)**: Create a unified interface for camera operations.
   - *Physical Implementation*: Uses the official `esp32-camera` driver to initialize and capture frames from the physical OV2640 sensor.
   - *Mock Implementation*: Returns a static JPEG or RGB565 buffer compiled directly into the firmware (e.g., a test QR code image containing valid JSON credentials).
2. **Emulator Build Target**: Configure the `CMakeLists.txt` to support a specific `qemu` build configuration. This target will compile the firmware with the Mock Implementation enabled, completely bypassing physical I2C/I2S hardware calls.

### Phase 4: Emulator Integration Testing
1. **Provisioning Flow in QEMU**:
   - Boot the firmware inside QEMU with the Mock Camera enabled.
   - The firmware's internal loop will request a frame, receiving the mock QR code image.
   - Validate via `pytest-embedded` that the serial output logs successful QR decoding and JSON parsing.
   - Validate that the state machine appropriately transitions to `PROV_STATE_PROVISIONED`.
2. **Network Simulation**:
   - Configure QEMU's simulated network (SLIRP) to allow the simulated ESP32 to interact with a virtualized network.
   - Verify that the ESP32 successfully initializes Wi-Fi Station mode using the credentials extracted from the mock QR code and requests an IP address.
   - Validate that the mDNS service (`_chessclock._tcp`) is correctly initialized and broadcasted on the simulated network.

### Phase 5: Real Hardware Verification
1. **Flash Preparation**: Compile the firmware natively for the ESP32-S3 target using the *Physical Implementation* of the Camera HAL.
2. **Flashing**: Connect the Seeed Studio XIAO ESP32S3 via USB and flash the firmware (`idf.py flash monitor`).
3. **PWA Integration**:
   - Open the Chess Clock PWA on a mobile device or desktop.
   - Navigate to the provisioning UI, enter the physical lab's Wi-Fi credentials, and generate the QR code.
4. **Physical Provisioning**:
   - Point the physical XIAO ESP32S3 camera at the screen displaying the QR code.
   - Observe the serial monitor to confirm the device captures the frame, decodes the QR code, and extracts the payload.
5. **End-to-End Verification**:
   - Confirm the ESP32 successfully connects to the physical Wi-Fi network.
   - Confirm the PWA discovers the camera via mDNS and successfully establishes the pairing session using the secure token.
