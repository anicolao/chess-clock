import pytest
from pytest_embedded_idf.dut import IdfDut

def test_provisioning_flow(dut: IdfDut):
    dut.expect("ESP32S3 initialization complete.", timeout=10)
    dut.expect("Requesting camera frame...", timeout=5)
    dut.expect(r"Frame received: \d+x\d+", timeout=5)
    dut.expect("Connecting to Wi-Fi SSID: MyNetwork", timeout=5)
    dut.expect("Saving credentials to NVS: token=abc123xyz", timeout=5)
    dut.expect("Announcing via mDNS...", timeout=5)
    dut.expect("QR code decoded successfully!", timeout=5)
    dut.expect("Transitioned to PROV_STATE_PROVISIONED", timeout=5)
    dut.expect("Device is provisioned. Starting HTTP server...", timeout=5)
    dut.expect("HTTP server started on port 80", timeout=5)
    dut.expect("Registered endpoints: /api/status, /capture", timeout=5)
    dut.expect(r"Capture endpoint ready: \d+x\d+, \d+ bytes available", timeout=5)

    # Hardware integration self-tests (real NVS + mDNS in QEMU)
    dut.expect("=== Hardware Integration Self-Test ===", timeout=5)
    dut.expect("TEST NVS: Save OK", timeout=5)
    dut.expect("TEST NVS: Load roundtrip OK", timeout=5)
    dut.expect("TEST mDNS: Service registered OK", timeout=5)
    dut.expect("=== Self-Test Complete ===", timeout=5)
