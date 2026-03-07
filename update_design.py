import sys

file_path = "docs/designs/xiao_esp32s3_ip_camera.md"
with open(file_path, "r") as f:
    lines = f.readlines()

new_sections = """## 4. Wi-Fi Provisioning & Phone Pairing
To ensure a seamless user experience without requiring hardcoded network credentials, the camera will utilize a QR-code-based provisioning and pairing flow:
1. **QR Code Generation**: The user opens the Chess Clock PWA on their phone and provides their local Wi-Fi SSID and password. The PWA generates a QR code containing these credentials along with a unique, securely generated "pairing token."
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

"""

idx = -1
for i, line in enumerate(lines):
    if line.startswith("## 4. Move Tracking"):
        idx = i
        break

if idx != -1:
    lines.insert(idx, new_sections)
    
    # Update numbering for the subsequent sections
    for i in range(idx + 1, len(lines)):
        if lines[i].startswith("## 4."):
            lines[i] = lines[i].replace("## 4.", "## 6.")
        elif lines[i].startswith("## 5."):
            lines[i] = lines[i].replace("## 5.", "## 7.")
        elif lines[i].startswith("## 6."):
            lines[i] = lines[i].replace("## 6.", "## 8.")

    with open(file_path, "w") as f:
        f.writelines(lines)
    print("Document updated successfully.")
else:
    print("Could not find section 4.")
