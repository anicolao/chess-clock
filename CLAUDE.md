# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chess Logger & Clock — a PWA that connects to an ESP32 IP camera to automatically detect chess moves and advance a clock. 100% client-side, hosted on GitHub Pages. See `README.md`, `VISION.md`, and design docs in `docs/` for full context.

## Development Workflow

Follow `WORKFLOW.md` strictly: review `docs/` first, match or create a design doc before implementing, commit design before code.

## Build & Test Commands

All commands must run inside `nix develop` (the flake provides Node 20, Bun, CMake, Ninja, Catch2, cJSON, Python+pytest, and platform-specific ESP tooling).

### Web App (SvelteKit)
```bash
nix develop -c npm ci                     # Install dependencies
nix develop -c npm run dev                # Dev server on http://localhost:5174
nix develop -c npm run build              # Production build to ./build
nix develop -c npm run check              # TypeScript/Svelte type checking
nix develop -c npm run test:e2e           # All Playwright e2e tests (single worker)
nix develop -c npx playwright test tests/e2e/001-basic-load  # Single test suite
nix develop -c npx playwright test --update-snapshots        # Update screenshot baselines
```

### Firmware Host Unit Tests (C/C++)
```bash
nix develop -c bash -c "
  cd firmware
  mkdir -p build_host
  cp CMakeLists_host.txt build_host/CMakeLists.txt
  cp -r components build_host/
  cd build_host
  cmake -GNinja .
  ninja
  ctest --output-on-failure
"
```

### Firmware Build (test or production)
```bash
nix develop -c firmware/build.sh test        # Mock camera + mock WiFi (QEMU)
nix develop -c firmware/build.sh production  # Real OV2640 + real WiFi/NVS/mDNS (hardware)
```

### Firmware QEMU Emulation Test
```bash
nix develop -c firmware/build.sh test
nix develop -c bash -c "
  cd firmware
  pytest --embedded-services idf,qemu --target esp32s3 test_app.py  # Run in QEMU
"
```

### Pre-push Hook
`.husky/pre-push` runs `nix develop -c npm run test:e2e` before every push.

## Architecture

### Web App (`src/`)
- **Svelte 5** with runes (`$state`) for reactive state, SvelteKit with static adapter for GitHub Pages
- `src/routes/+page.svelte` — main chess clock UI (dual timers, increment, tap zones, camera connection)
- `src/routes/settings/+page.svelte` — QR code generation for ESP32 camera provisioning
- Base path is `/chess-clock` in production, empty in dev (configured in `svelte.config.js`)
- Vite injects build metadata (version, commit hash, build date, dirty flag) — see `vite.config.ts`

### Firmware (`firmware/`)
- ESP-IDF C project for XIAO ESP32S3 Sense with OV2640 camera
- Two CMake entry points: `CMakeLists.txt` (ESP-IDF target), `CMakeLists_host.txt` (host unit tests with Catch2)
- `components/provisioning/` — QR-based WiFi provisioning state machine
- `components/quirc/` — QR code decoder library
- `components/camera_hal/` — camera hardware abstraction (mock for testing, physical for ESP32)
- Component CMakeLists files use `if(ESP_PLATFORM)` guards for dual-target builds

### Computer Vision
- `moves.ts` — Gemini API-based move detection between two board images
- `moves_cv.ts` — OpenCV.js-based alternative
- `tests/chessboard_localization.test.js` — OpenCV board detection tests (`npm run test:cv`)
- Design: `docs/chessboard_recognition_design.md` (not on this branch but on `feat/chess-vision`)

### E2E Tests (`tests/e2e/`)
- Playwright with zero-tolerance screenshot comparison
- Mobile viewport (393x852, 1x scale), Chromium only, `en-CA` locale, `America/New_York` timezone
- `tests/e2e/helpers/test-step-helper.ts` — structured step-based testing with auto-generated README docs
- `tests/e2e/helpers/emulator.ts` — lightweight HTTP camera emulator for discovery/connection tests
- Screenshot baselines are platform-specific (currently macOS/aarch64-darwin)

### CI (`.github/workflows/`)
- `e2e.yml` — Playwright tests on macOS
- `firmware-unit-tests.yml` — host C/C++ tests on Ubuntu via Nix
- `firmware-emulation-tests.yml` — QEMU emulation tests on Ubuntu
- `deploy.yml` — GitHub Pages deploy (main + PR previews)

## Key Design Docs
- `docs/hardware/xiao_esp32s3_ip_camera.md` — camera firmware design
- `docs/hardware/esp32_mvp_provisioning_pairing.md` — provisioning protocol
- `docs/ux/pwa_chess_clock.md` — PWA design and user stories
- `docs/ux/pwa-ux-spec.md` — UX specifications

## Nix Environment
- `flake.nix` provides all tools on both Linux and macOS (including ESP-IDF and QEMU)
- macOS QEMU uses a DYLD_LIBRARY_PATH wrapper to supply nix-provided dylibs (pixman, libgcrypt, SDL2, glib, gettext)
- Python venv is auto-created in `.venv/` on shell entry with pytest-embedded packages
- Delete `.venv/` to force reinstallation of Python packages
