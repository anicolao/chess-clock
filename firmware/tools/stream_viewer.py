#!/usr/bin/env python3
"""MJPEG stream viewer using kitty +icat.

Usage:
    python3 tools/stream_viewer.py [URL]

Default URL: http://chess-cam.local/stream
Tip: use the IP directly to avoid 5s mDNS lookup:
    python3 tools/stream_viewer.py http://10.20.86.219/stream

Press Ctrl-C to stop.
"""

import os
import subprocess
import sys
import tempfile
import time
import urllib.request

BOUNDARY = b"frameboundary"
DEFAULT_URL = "http://chess-cam.local/stream"


def read_stream(url: str) -> None:
    """Connect to MJPEG stream and display frames via kitty +icat."""
    print(f"Connecting to {url} ...", file=sys.stderr)
    req = urllib.request.Request(url)
    resp = urllib.request.urlopen(req, timeout=10)

    tmp = os.path.join(tempfile.gettempdir(), "chesscam_frame.jpg")
    buf = b""
    frame_count = 0
    t0 = time.monotonic()
    boundary_marker = b"--" + BOUNDARY

    # Clear screen
    print("\033[2J\033[H", end="", flush=True)

    while True:
        chunk = resp.read(4096)
        if not chunk:
            break
        buf += chunk

        while True:
            start = buf.find(boundary_marker)
            if start == -1:
                break

            hdr_end = buf.find(b"\r\n\r\n", start)
            if hdr_end == -1:
                break
            data_start = hdr_end + 4

            hdr_block = buf[start:hdr_end].decode("ascii", errors="replace")
            content_length = None
            for line in hdr_block.split("\r\n"):
                if line.lower().startswith("content-length:"):
                    content_length = int(line.split(":", 1)[1].strip())
                    break

            if content_length is None:
                next_boundary = buf.find(boundary_marker, data_start)
                if next_boundary == -1:
                    break
                jpeg_data = buf[data_start:next_boundary].rstrip(b"\r\n")
                buf = buf[next_boundary:]
            else:
                if len(buf) < data_start + content_length:
                    break
                jpeg_data = buf[data_start : data_start + content_length]
                buf = buf[data_start + content_length :]
                if buf.startswith(b"\r\n"):
                    buf = buf[2:]

            frame_count += 1
            elapsed = time.monotonic() - t0
            fps = frame_count / elapsed if elapsed > 0 else 0

            with open(tmp, "wb") as f:
                f.write(jpeg_data)

            # Clear and display with icat
            print("\033[H", end="", flush=True)
            subprocess.run(
                ["kitty", "+icat", "--clear"],
                stdout=sys.stdout, stderr=subprocess.DEVNULL,
            )
            subprocess.run(
                ["kitty", "+icat", "--place", "80x40@0x0", tmp],
                stdout=sys.stdout, stderr=subprocess.DEVNULL,
            )

            print(
                f"\033[999B\r\033[K"
                f"Frame {frame_count} | {len(jpeg_data):,} bytes | {fps:.1f} fps",
                end="", flush=True,
            )


def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    try:
        read_stream(url)
    except KeyboardInterrupt:
        subprocess.run(
            ["kitty", "+icat", "--clear"],
            stdout=sys.stdout, stderr=subprocess.DEVNULL,
        )
        print("\033[2J\033[H", end="")
        print("Stopped.", file=sys.stderr)
    except Exception as e:
        print(f"\nError: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
