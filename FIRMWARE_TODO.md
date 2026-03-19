# Firmware TODO

Status of the ESP32-S3 camera firmware as of 2026-03-19.

## Completed

### Components
- **camera_hal** — Hardware abstraction with mock backend (QEMU/host tests) and real ESP32-CAM backend (OV2640)
- **provisioning** — QR-code-based WiFi provisioning state machine with pluggable callbacks for WiFi connect, credential save, and mDNS announce
- **quirc** — QR code decoder library integrated as ESP-IDF component
- **http_server** — ESP-IDF `esp_http_server` wrapper with `/api/status` (JSON) and `/capture` (image frame) endpoints, CORS headers
- **wifi_prov** — Real implementations: WiFi STA connect with event-group timeout, NVS credential persistence (`prov` namespace), mDNS service announcement (`chess-cam.local`, `_chessclock._tcp` on port 80), credential load for boot persistence

### Testing
- 11 host unit tests (Catch2) — provisioning state machine, QR decoding
- QEMU integration tests — NVS save/load roundtrip, OpenETH networking, mDNS registration + self-discovery
- QEMU HTTP endpoint tests — `/api/status` and `/capture` verified via SLIRP port forwarding (guest:80 → host:18080)
- CI workflows: `firmware-unit-tests.yml` (Ubuntu), `firmware-emulation-tests.yml` (Ubuntu + QEMU)

## Remaining — Functionality

### Real camera driver integration
The mock camera HAL returns a synthetic grayscale frame. The real backend (`camera_hal_esp32.c`) needs testing on physical hardware with OV2640. JPEG encoding (currently the `/capture` endpoint serves raw frames) should be added for production use.

### WiFi provisioning end-to-end on hardware
`wifi_prov_connect()` has been implemented but only tested in isolation (QEMU doesn't emulate WiFi). Needs verification on real hardware: scan → connect → DHCP → credential persistence across reboots.

### Boot-time credential check
On reboot, firmware should check NVS for saved credentials and skip QR provisioning if valid credentials exist. `wifi_prov_load_credentials()` is implemented but not yet wired into the boot path in `main.c`.

### OTA firmware updates
No over-the-air update mechanism yet. ESP-IDF provides `esp_https_ota` — would need an endpoint or integration with GitHub releases.

## Remaining — Testing

### JPEG output from /capture
Once real camera or JPEG encoding is added, update the QEMU test to verify `Content-Type: image/jpeg` with actual JPEG magic bytes (`FF D8 FF`).

### WiFi provisioning under QEMU
QEMU doesn't emulate ESP32 WiFi, so `wifi_prov_connect()` can only be tested on hardware. Consider a mock WiFi test that verifies the state machine transitions without real radio.

### Stress / reliability testing
- Multiple rapid `/capture` requests
- Reconnection after WiFi drop
- NVS wear (repeated save cycles)

### mDNS discovery from external client
SLIRP doesn't forward multicast, so current mDNS tests verify local state only. True discovery testing requires hardware on a real network.
