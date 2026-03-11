import pytest
from pytest_embedded import Dut

def test_esp32_hello_world(dut: Dut):
    dut.expect('Hello from ESP32 MVP Phase 1!', timeout=10)
    dut.expect('ESP32S3 initialization complete.', timeout=10)
