#!/usr/bin/env python3
"""MJPEG stream viewer using kitty +icat.

Usage:
    python3 tools/stream_viewer.py [URL]
    python3 tools/stream_viewer.py --save-test-cases basename [URL]

Default URL: http://chess-cam.local/stream
Tip: use the IP directly to avoid 5s mDNS lookup:
    python3 tools/stream_viewer.py http://10.20.86.219/stream

Keys (in --save-test-cases mode):
    SPACE  pause / resume streaming and capture
    /      finish current test case, start next one (pauses for confirmation)
    q      quit

Press Ctrl-C to stop (in normal mode or as fallback).
"""

from __future__ import annotations

import argparse
import os
import select
import subprocess
import sys
import tempfile
import termios
import time
import tty
import urllib.request

BOUNDARY = b"frameboundary"
DEFAULT_URL = "http://chess-cam.local/stream"


def display_frame(tmp: str, frame_count: int, jpeg_len: int, fps: float,
                  status_extra: str = "") -> None:
    """Render a frame with kitty icat and print status line."""
    print("\033[H", end="", flush=True)
    subprocess.run(
        ["kitty", "+icat", "--clear"],
        stdout=sys.stdout, stderr=subprocess.DEVNULL,
    )
    subprocess.run(
        ["kitty", "+icat", "--place", "80x40@0x0", tmp],
        stdout=sys.stdout, stderr=subprocess.DEVNULL,
    )
    status = f"Frame {frame_count} | {jpeg_len:,} bytes | {fps:.1f} fps"
    if status_extra:
        status += f" | {status_extra}"
    print(f"\033[999B\r\033[K{status}", end="", flush=True)


def extract_frames(buf: bytes, boundary_marker: bytes):
    """Yield (jpeg_data, remaining_buf) for each complete frame in buf."""
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
            jpeg_data = buf[data_start:data_start + content_length]
            buf = buf[data_start + content_length:]
            if buf.startswith(b"\r\n"):
                buf = buf[2:]

        yield jpeg_data, buf


def read_key_if_available() -> str | None:
    """Return a single keypress if one is waiting on stdin, else None."""
    if select.select([sys.stdin], [], [], 0)[0]:
        return sys.stdin.read(1)
    return None


def prompt_below_image(prompt_text: str, default: str = "") -> str:
    """Show a prompt on the status line and read a line of input.

    Temporarily restores cooked terminal mode for readline editing.
    """
    old = termios.tcgetattr(sys.stdin)
    try:
        tty.setcbreak(sys.stdin)  # still need to restore fully for input()
        termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old)
        display_text = prompt_text
        if default:
            display_text += f" [{default}]"
        display_text += ": "
        print(f"\033[999B\r\033[K{display_text}", end="", flush=True)
        line = input()
        return line.strip() if line.strip() else default
    finally:
        tty.setcbreak(sys.stdin)


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

    print("\033[2J\033[H", end="", flush=True)

    while True:
        chunk = resp.read(4096)
        if not chunk:
            break
        buf += chunk

        for jpeg_data, buf in extract_frames(buf, boundary_marker):
            frame_count += 1
            elapsed = time.monotonic() - t0
            fps = frame_count / elapsed if elapsed > 0 else 0

            with open(tmp, "wb") as f:
                f.write(jpeg_data)

            display_frame(tmp, frame_count, len(jpeg_data), fps)


def read_stream_with_capture(url: str, basename: str) -> None:
    """Stream viewer with test case capture controlled by keyboard."""
    print(f"Connecting to {url} ...", file=sys.stderr)
    req = urllib.request.Request(url)
    resp = urllib.request.urlopen(req, timeout=10)
    # Get the raw socket fd for select() — keep socket blocking
    sock_fd = resp.fp.raw._sock.fileno()

    tmp = os.path.join(tempfile.gettempdir(), "chesscam_frame.jpg")
    buf = b""
    frame_count = 0
    saved_count = 0
    case_index = 0
    t0 = time.monotonic()
    boundary_marker = b"--" + BOUNDARY
    paused = True  # start paused for directory confirmation
    save_dir: str | None = None

    # Set terminal to raw mode for single-keypress detection
    old_term = termios.tcgetattr(sys.stdin)
    try:
        tty.setcbreak(sys.stdin)

        print("\033[2J\033[H", end="", flush=True)

        # Initial directory confirmation
        proposed = f"{basename}-{case_index:03d}"
        save_dir = prompt_below_image(
            "Save test case frames to directory", proposed
        )
        os.makedirs(save_dir, exist_ok=True)
        saved_count = 0
        print(
            f"\033[999B\r\033[KSaving to: {save_dir} — press SPACE to start streaming",
            end="", flush=True,
        )

        while True:
            # Always select on both stdin and socket — we must keep
            # draining the stream even while paused to prevent TCP
            # buffer overflow and chunked-encoding corruption.
            ready, _, _ = select.select([sys.stdin, sock_fd], [], [], 0.05)

            # Check for keypress
            if sys.stdin in ready:
                key = sys.stdin.read(1)
                if key == "q":
                    break
                elif key == " ":
                    paused = not paused
                    if not paused:
                        t0 = time.monotonic()
                        frame_count = 0
                    state = "PAUSED" if paused else f"STREAMING -> {save_dir}"
                    print(
                        f"\033[999B\r\033[K{state} | {saved_count} frames saved",
                        end="", flush=True,
                    )
                elif key == "/":
                    paused = True
                    if save_dir:
                        print(
                            f"\033[999B\r\033[KFinished {save_dir} ({saved_count} frames)",
                            end="", flush=True,
                        )
                        time.sleep(0.5)
                    case_index += 1
                    proposed = f"{basename}-{case_index:03d}"
                    save_dir = prompt_below_image(
                        "Next test case directory", proposed
                    )
                    os.makedirs(save_dir, exist_ok=True)
                    saved_count = 0
                    print(
                        f"\033[999B\r\033[KSaving to: {save_dir} — press SPACE to start",
                        end="", flush=True,
                    )

            # Always drain the stream to keep the connection alive
            if sock_fd in ready:
                chunk = resp.read(4096)
                if not chunk:
                    break  # stream ended for real
                buf += chunk

                for jpeg_data, buf in extract_frames(buf, boundary_marker):
                    if paused:
                        # Drain frames but don't save or display
                        continue

                    frame_count += 1
                    elapsed = time.monotonic() - t0
                    fps = frame_count / elapsed if elapsed > 0 else 0

                    with open(tmp, "wb") as f:
                        f.write(jpeg_data)

                    # Save frame to test case directory
                    if save_dir:
                        frame_path = os.path.join(
                            save_dir, f"frame-{saved_count:06d}.jpg"
                        )
                        with open(frame_path, "wb") as f:
                            f.write(jpeg_data)
                        saved_count += 1

                    display_frame(
                        tmp, frame_count, len(jpeg_data), fps,
                        f"{save_dir} ({saved_count} saved)",
                    )

    finally:
        termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_term)

    if save_dir and saved_count > 0:
        print(f"\nLast test case: {save_dir} ({saved_count} frames)",
              file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="MJPEG stream viewer with optional test case capture"
    )
    parser.add_argument(
        "url", nargs="?", default=DEFAULT_URL,
        help=f"MJPEG stream URL (default: {DEFAULT_URL})",
    )
    parser.add_argument(
        "--save-test-cases", metavar="BASENAME",
        help="Capture frames into numbered directories: BASENAME-000, -001, ...",
    )
    args = parser.parse_args()

    try:
        if args.save_test_cases:
            read_stream_with_capture(args.url, args.save_test_cases)
        else:
            read_stream(args.url)
    except KeyboardInterrupt:
        pass
    finally:
        subprocess.run(
            ["kitty", "+icat", "--clear"],
            stdout=sys.stdout, stderr=subprocess.DEVNULL,
        )
        print("\033[2J\033[H", end="")
        print("Stopped.", file=sys.stderr)


if __name__ == "__main__":
    main()
