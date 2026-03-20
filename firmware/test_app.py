import json
import pytest
import urllib.request
import urllib.error
from pytest_embedded_idf.dut import IdfDut

QEMU_HTTP_PORT = 18080

def test_provisioning_flow(dut: IdfDut):
    dut.expect("ESP32S3 initialization complete.", timeout=10)
    dut.expect(r"HTTP server started on port 80 \(provisioning mode\)", timeout=5)
    dut.expect("Browse to http://192.168.4.1/", timeout=5)
    dut.expect("Connecting to Wi-Fi SSID: MyNetwork", timeout=10)
    dut.expect("Saving credentials to NVS: token=abc123xyz", timeout=5)
    dut.expect("Announcing via mDNS...", timeout=5)
    dut.expect("QR code decoded successfully!", timeout=5)
    dut.expect("Device provisioned! SSID=MyNetwork", timeout=10)
    dut.expect(r"Endpoints: /api/status, /capture, /stream", timeout=5)
    dut.expect(r"Capture endpoint ready: \d+x\d+, \d+ bytes", timeout=5)

    # Hardware integration self-tests (real NVS + mDNS in QEMU)
    dut.expect("=== Hardware Integration Self-Test ===", timeout=5)
    dut.expect("TEST NVS: Save OK", timeout=5)
    dut.expect("TEST NVS: Load roundtrip OK", timeout=5)
    dut.expect("TEST NET: OpenETH OK", timeout=15)
    dut.expect("TEST mDNS: Service registered OK", timeout=5)
    dut.expect("TEST mDNS: Hostname 'chess-cam' registered OK", timeout=5)
    dut.expect("TEST mDNS: Service discovered", timeout=5)
    dut.expect("TEST mDNS: Discovery OK", timeout=5)
    dut.expect("=== Self-Test Complete ===", timeout=5)

    # HTTP endpoint tests via QEMU port forwarding
    base_url = f"http://localhost:{QEMU_HTTP_PORT}"

    # Test /api/status endpoint
    resp = urllib.request.urlopen(f"{base_url}/api/status", timeout=5)
    assert resp.status == 200
    body = json.loads(resp.read())
    assert body == {"status": "ok"}
    assert resp.headers["Access-Control-Allow-Origin"] == "*"

    # Test /capture endpoint returns JPEG image data
    resp = urllib.request.urlopen(f"{base_url}/capture", timeout=5)
    assert resp.status == 200
    assert resp.headers["Content-Type"] == "image/jpeg"
    assert resp.headers["Access-Control-Allow-Origin"] == "*"
    width = int(resp.headers["X-Frame-Width"])
    height = int(resp.headers["X-Frame-Height"])
    assert width > 0
    assert height > 0
    image_data = resp.read()
    assert len(image_data) > 0
    assert image_data[:2] == b'\xff\xd8', "Missing JPEG SOI marker"
    assert image_data[-2:] == b'\xff\xd9', "Missing JPEG EOI marker"
