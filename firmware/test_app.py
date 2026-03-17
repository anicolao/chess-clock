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
    dut.expect("Device is provisioned. Idling...", timeout=5)
