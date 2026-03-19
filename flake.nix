{
  description = "Chess Logger & Clock Environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    nixpkgs-esp-dev.url = "github:mirrexagon/nixpkgs-esp-dev";
  };

  outputs = { self, nixpkgs, flake-utils, nixpkgs-esp-dev }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        qemu-version = "esp-develop-9.2.2-20250817";
        qemu-version-underscored = "esp_develop_9.2.2_20250817";

        qemu-src-info = {
          "x86_64-linux" = {
            suffix = "x86_64-linux-gnu";
            sha256 = "1sr6s6w8201836jqybbi670sjsqc087mh2nial36aagrs36gm2sq";
          };
          "aarch64-linux" = {
            suffix = "aarch64-linux-gnu";
            sha256 = "1kg75kbikghyz0a2m0iqjkr3wn89v4irhw0hh5nqi86vs47nwzri";
          };
          "x86_64-darwin" = {
            suffix = "x86_64-apple-darwin";
            sha256 = "0000000000000000000000000000000000000000000000000000"; # placeholder
          };
          "aarch64-darwin" = {
            suffix = "aarch64-apple-darwin";
            sha256 = "0la632faahybi5r5dyzwzkl3syyn1gy8xk9ikxfjyj0x8qvy74ma";
          };
        }.${system} or null;

        esp-qemu-linux = if qemu-src-info != null && pkgs.stdenv.isLinux then pkgs.stdenv.mkDerivation {
          pname = "esp-qemu";
          version = qemu-version;
          src = pkgs.fetchurl {
            url = "https://github.com/espressif/qemu/releases/download/${qemu-version}/qemu-xtensa-softmmu-${qemu-version-underscored}-${qemu-src-info.suffix}.tar.xz";
            sha256 = qemu-src-info.sha256;
          };
          nativeBuildInputs = [ pkgs.autoPatchelfHook pkgs.makeWrapper ];
          buildInputs = with pkgs; [
            pixman libgcrypt SDL2 zlib libslirp glib stdenv.cc.cc.lib
          ];
          installPhase = ''
            mkdir -p $out
            cp -r * $out/
          '';
        } else null;

        esp-qemu-darwin = if qemu-src-info != null && pkgs.stdenv.isDarwin then
          let libPath = pkgs.lib.makeLibraryPath (with pkgs; [ pixman libgcrypt SDL2 glib gettext ]);
          in pkgs.stdenv.mkDerivation {
          pname = "esp-qemu";
          version = qemu-version;
          src = pkgs.fetchurl {
            url = "https://github.com/espressif/qemu/releases/download/${qemu-version}/qemu-xtensa-softmmu-${qemu-version-underscored}-${qemu-src-info.suffix}.tar.xz";
            sha256 = qemu-src-info.sha256;
          };
          # Prebuilt binary — skip all fixup (strip corrupts Mach-O code signature)
          dontStrip = true;
          dontFixup = true;
          installPhase = ''
            mkdir -p $out/bin $out/libexec $out/share $out/lib $out/include
            cp -r share/* $out/share/ 2>/dev/null || true
            cp -r lib/* $out/lib/ 2>/dev/null || true
            cp -r include/* $out/include/ 2>/dev/null || true
            cp bin/qemu-system-xtensa $out/libexec/qemu-system-xtensa
            cat > $out/bin/qemu-system-xtensa << 'WRAPPER'
#!/bin/sh
export DYLD_LIBRARY_PATH="${libPath}''${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
exec "$(dirname "$0")/../libexec/qemu-system-xtensa" "$@"
WRAPPER
            chmod +x $out/bin/qemu-system-xtensa
          '';
        } else null;

        esp-qemu = if pkgs.stdenv.isLinux then esp-qemu-linux
                    else if pkgs.stdenv.isDarwin then esp-qemu-darwin
                    else null;

        # ESP-IDF and QEMU packages (available on both Linux and macOS)
        esp-pkgs = (if qemu-src-info != null then [
          nixpkgs-esp-dev.packages.${system}.esp-idf-full
        ] else [])
        ++ (if esp-qemu != null then [ esp-qemu ] else []);

      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_20
            bun
            nodePackages.typescript
            nodePackages.svelte-language-server
            gh
            git

            # C/C++ Firmware Host-Testing tools
            gcc
            cmake
            ninja
            catch2_3
            cjson
            imagemagick
            wget

            # Python for venv
            python3
            python3Packages.pip
            python3Packages.virtualenv
          ] ++ esp-pkgs;

          shellHook = ''
            # Setup Python Virtual Environment
            VENV_DIR="$PWD/.venv"
            if [ ! -d "$VENV_DIR" ]; then
              echo "Creating python venv at $VENV_DIR"
              python3 -m venv "$VENV_DIR"
              source "$VENV_DIR/bin/activate"
              pip install --quiet pytest pytest-embedded pytest-embedded-idf pytest-embedded-qemu pytest-embedded-serial pytest-embedded-serial-esp
            else
              source "$VENV_DIR/bin/activate"
            fi

            # Wrapper for esptool (only if esptool.py is available)
            if command -v esptool.py > /dev/null; then
              mkdir -p "$VENV_DIR/esptool-wrapper"
              cat << 'INNER_EOF' > "$VENV_DIR/esptool-wrapper/esptool.py"
#!/usr/bin/env bash
REAL_ESPTOOL=$(which -a esptool.py | grep -v 'esptool-wrapper' | head -n 1)
args=()
for arg in "$@"; do
  if [ "$arg" = "merge-bin" ]; then
    args+=("merge_bin")
  else
    args+=("$arg")
  fi
done
exec "$REAL_ESPTOOL" "''${args[@]}"
INNER_EOF
              chmod +x "$VENV_DIR/esptool-wrapper/esptool.py"
              export PATH="$VENV_DIR/esptool-wrapper:$PATH"
            fi

            echo "Environment loaded for Chess Clock"
          '';
        };
      }
    );
}
