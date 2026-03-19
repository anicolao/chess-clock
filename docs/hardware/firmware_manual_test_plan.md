# Firmware Manual Test Plan

Manual verification of the ESP32-S3 camera firmware on a physical XIAO ESP32S3 Sense board.

## Prerequisites

### Hardware
- Seeed Studio XIAO ESP32S3 Sense (with OV2640 camera module attached)
- USB-C cable
- A phone or computer on the same Wi-Fi network

### Software
- Nix package manager installed
- This repository cloned
- A Wi-Fi network the ESP32 can reach (2.4 GHz — the ESP32 does not support 5 GHz)

## Step 1: Build Firmware for Physical Hardware

From the repository root:

```bash
nix develop -c firmware/build.sh production
```

This builds with the real OV2640 camera driver, real WiFi/NVS/mDNS provisioning, and PSRAM enabled. The script prints the binary path and flash command when done.

To build the test/QEMU variant instead:

```bash
nix develop -c firmware/build.sh test
```

**Expected output** (production):
```
=== Building firmware: PRODUCTION mode ===
  Real OV2640 camera, real WiFi/NVS/mDNS, PSRAM enabled
...
================================================
Build complete: production mode
Binary: /path/to/firmware/build/esp32_mvp.bin
================================================

To flash and monitor:
  cd firmware && idf.py -p /dev/tty.usbmodem* flash monitor
```

## Step 2: Flash to Device

Connect the XIAO ESP32S3 Sense via USB-C. It should appear as a serial port (typically `/dev/tty.usbmodem*` on macOS or `/dev/ttyACM0` on Linux).

Run the flash command printed by the build script:

```bash
nix develop -c bash -c "cd firmware && idf.py -p PORT flash monitor"
```

Replace `PORT` with the actual serial port. The `monitor` flag opens the serial console after flashing.

**Expected**: Flash succeeds, serial monitor opens, and you see:
```
ESP32S3 initialization complete.
Requesting camera frame...
Frame received: 800x600, len=...
Failed to decode QR code. State: 0
```

The device is now in provisioning mode, capturing frames and looking for a QR code every 2 seconds.

## Step 3: Generate Provisioning QR Code

Open the Chess Clock PWA settings page:
- **Local dev**: `http://localhost:5174/settings`
- **GitHub Pages**: `https://<user>.github.io/chess-clock/settings`

1. Enter your **Wi-Fi SSID** (2.4 GHz network name)
2. Enter your **Wi-Fi Password**
3. Click **"Generate Pairing QR"**
4. A QR code appears on screen with a pairing token displayed below it

The QR code encodes a JSON payload: `{"ssid":"...","pass":"...","token":"..."}`

**Keep this page open** — you'll need the QR code and the displayed token for later verification.

## Step 4: Provision the Device

Hold your phone/screen displaying the QR code in front of the XIAO's camera, approximately 10–15 cm away, well-lit.

**Expected serial output** (in order):
```
Requesting camera frame...
Frame received: 800x600, len=...
Connecting to Wi-Fi SSID: YourNetworkName
Saving credentials to NVS: token=<your-token>
Announcing via mDNS...
QR code decoded successfully!
Transitioned to PROV_STATE_PROVISIONED
Device is provisioned. Starting HTTP server...
HTTP server started on port 80
Registered endpoints: /api/status, /capture
Capture endpoint ready: 800x600, ... bytes available
```

### Troubleshooting provisioning
- **"Failed to decode QR code"** repeating: Ensure QR code is in focus, well-lit, and filling a good portion of the frame. Try adjusting distance.
- **WiFi connection fails**: Confirm the SSID is 2.4 GHz and the password is correct. Check serial output for error details.
- **No frame received**: Verify the camera module is properly seated on the XIAO board.

## Step 5: Verify mDNS Discovery

After provisioning, the device announces itself as `chess-cam.local` on the local network.

From a computer on the same network:

```bash
# macOS
dns-sd -B _chessclock._tcp

# Linux
avahi-browse -r _chessclock._tcp
```

**Expected**: Service discovered with hostname `chess-cam`, port 80, service type `_chessclock._tcp`.

Also verify hostname resolution:
```bash
ping chess-cam.local
```

**Expected**: Ping replies from the device's IP address.

## Step 6: Test HTTP Endpoints

### 6a. GET /api/status

```bash
curl -v http://chess-cam.local/api/status
```

**Verify**:
- HTTP 200
- `Content-Type: application/json`
- `Access-Control-Allow-Origin: *`
- Body: `{"status":"ok"}`

### 6b. GET /capture

```bash
curl -o frame.jpg http://chess-cam.local/capture
```

**Verify**:
- HTTP 200
- `Content-Type: image/jpeg`
- `Access-Control-Allow-Origin: *`
- `X-Frame-Width` and `X-Frame-Height` headers present with positive integers
- `frame.jpg` is a valid JPEG image (open it — you should see what the camera sees)
- File starts with bytes `FF D8` and ends with `FF D9`

Quick validation:
```bash
file frame.jpg        # Should say "JPEG image data"
xxd frame.jpg | head -1  # Should start with ff d8
xxd frame.jpg | tail -1  # Should end with ff d9
```

### 6c. Verify from browser

Open `http://chess-cam.local/capture` in a browser. You should see a live camera image. Refresh to get a new frame.

## Step 7: Verify NVS Credential Persistence

1. Unplug the device (power cycle)
2. Plug it back in and open serial monitor: `nix develop -c bash -c "cd firmware && idf.py -p PORT monitor"`

**Current expected behavior**: The device re-enters provisioning mode (boot-time credential loading is not yet wired into the boot path — see FIRMWARE_TODO.md).

**What to observe**: Serial output shows `"ESP32S3 initialization complete."` followed by `"Requesting camera frame..."` — confirming the device boots cleanly after a power cycle.

> **Note**: Automatic reconnection from saved NVS credentials on boot is a documented TODO. Once implemented, the device should skip provisioning and go straight to HTTP server mode on reboot.

## Step 8: Verify PWA ↔ Camera Integration

1. Open the Chess Clock PWA on a phone on the same Wi-Fi network
2. The PWA should discover the camera via mDNS or local network scanning
3. Once connected, the PWA fetches frames from `/capture` for move detection

**Verify**:
- The PWA shows a live preview from the camera
- No CORS errors in the browser console
- Frame rate is adequate (2–5 FPS expected for snapshot polling)

## Test Matrix Summary

| Test | Verification | Pass Criteria |
|------|-------------|---------------|
| Build for hardware | `firmware/build.sh production` | No errors, binary produced |
| Flash & boot | Serial monitor | "ESP32S3 initialization complete." appears |
| Camera capture | Serial monitor | "Frame received: 800x600" with non-zero length |
| QR provisioning | Serial monitor | Full provisioning sequence in order |
| WiFi connection | Serial monitor | "Connecting to Wi-Fi SSID: ..." without error |
| NVS save | Serial monitor | "Saving credentials to NVS: token=..." |
| mDNS announcement | `dns-sd` / `avahi-browse` | Service `_chessclock._tcp` discovered |
| mDNS hostname | `ping chess-cam.local` | Replies from device IP |
| /api/status | `curl` | JSON `{"status":"ok"}` with CORS header |
| /capture | `curl` + `file` | Valid JPEG with correct headers |
| Browser /capture | Open URL | Image displayed in browser |
| Power cycle | Unplug/replug + serial | Clean boot, no crash |
| PWA integration | Phone browser | Camera frames displayed, no CORS errors |

## Known Limitations

- **Boot persistence**: Device does not auto-reconnect from NVS on reboot (must re-provision)
- **No OTA**: Firmware updates require USB flashing
- **JPEG quality**: Fixed at quality level 12 — not yet configurable via API
- **Single client**: `esp_http_server` handles one request at a time; concurrent `/capture` requests may queue
