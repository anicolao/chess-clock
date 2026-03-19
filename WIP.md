# Work In Progress: QR Provisioning Flow & Stack Overflow Fix

## Task in Progress
Implementing the QR code provisioning flow for the ESP32 firmware, specifically integrating the Camera HAL and the QR decoding logic (`quirc`). 

## Current State
- Updated `main.c` to use the camera HAL, acquire a frame, and pass it to `prov_decode_qr_image`.
- Mocked out Wi-Fi connect, credential saving, and mDNS announcement callbacks in `main.c`.
- Modified `prov_decode_qr_image` (`firmware/components/provisioning/src/provisioning.c`) to dynamically allocate `quirc_code` and `quirc_data` on the heap instead of the stack to prevent stack overflows.
- Updated `firmware/test_app.py` to expect the new provisioning flow log output.
- Modified `flake.nix` to include additional python dependencies (`qrcode`, `pillow`, etc.) and patched `pytest_embedded_qemu` directly to fix the esptool `merge-bin` syntax.
- Created utility scripts `fix_stack.py` and `generate_mock_qr.py`.

## Next Steps
- Ensure the tests pass in QEMU without timing out.
- Clean up untracked files and finalize the implementation of the QR provisioning flow.
