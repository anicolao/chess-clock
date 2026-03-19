import pytest

@pytest.fixture
def qemu_extra_args():
    """Enable QEMU user-mode networking with OpenCores Ethernet for mDNS testing."""
    return "-nic user,model=open_eth"
