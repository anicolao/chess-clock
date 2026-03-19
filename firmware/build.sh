#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

usage() {
    echo "Usage: $0 [test|production]"
    echo ""
    echo "  test        Mock camera + mock WiFi + OpenETH (for QEMU testing)"
    echo "  production  Real OV2640 camera + real WiFi/NVS/mDNS (for hardware)"
    echo ""
    echo "Defaults to 'test' if no argument given."
    exit 1
}

MODE="${1:-test}"

case "$MODE" in
    test)
        CONFIG="sdkconfig.defaults.test"
        echo "=== Building firmware: TEST mode ==="
        echo "  Mock camera, mock WiFi, OpenETH enabled (QEMU)"
        ;;
    production)
        CONFIG="sdkconfig.defaults.production"
        echo "=== Building firmware: PRODUCTION mode ==="
        echo "  Real OV2640 camera, real WiFi/NVS/mDNS, PSRAM enabled"
        ;;
    -h|--help)
        usage
        ;;
    *)
        echo "Error: unknown mode '$MODE'"
        usage
        ;;
esac

if [ ! -f "$CONFIG" ]; then
    echo "Error: $CONFIG not found"
    exit 1
fi

# Install the selected config and clean build state
cp "$CONFIG" sdkconfig.defaults
rm -f sdkconfig

echo ""
echo "Setting target to esp32s3..."
idf.py set-target esp32s3

echo ""
echo "Building..."
idf.py build

BINARY="$SCRIPT_DIR/build/esp32_mvp.bin"
echo ""
echo "================================================"
echo "Build complete: $MODE mode"
echo "Binary: $BINARY"
echo "================================================"

if [ "$MODE" = "production" ]; then
    echo ""
    echo "To flash and monitor:"
    echo "  cd firmware && idf.py -p /dev/tty.usbmodem* flash monitor"
    echo ""
    echo "Or specify port explicitly:"
    echo "  cd firmware && idf.py -p PORT flash monitor"
else
    echo ""
    echo "To run QEMU tests:"
    echo "  cd firmware && pytest --embedded-services idf,qemu --target esp32s3 test_app.py -v"
fi
