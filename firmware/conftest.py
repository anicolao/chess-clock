import pytest

@pytest.fixture
def qemu_extra_args():
    """Enable QEMU user-mode networking with OpenCores Ethernet and port forwarding."""
    return "-nic user,model=open_eth,hostfwd=tcp::18080-:80"
