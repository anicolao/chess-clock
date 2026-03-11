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
