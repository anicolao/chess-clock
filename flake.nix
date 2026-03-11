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
        esp-idf-full = nixpkgs-esp-dev.packages.${system}.esp-idf-full;
        strictFontsConf = pkgs.writeText "fonts.conf" ''
          <?xml version="1.0"?>
          <!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
          <fontconfig>
            <dir>${pkgs.dejavu_fonts}</dir>
            <cachedir>/tmp/fonts-cache</cachedir>
            <config></config>
          </fontconfig>
        '';

        esp-qemu = pkgs.stdenv.mkDerivation {
          pname = "esp-qemu";
          version = "esp-develop-9.2.2-20250817";
          src = if system == "x86_64-linux" then pkgs.fetchurl {
            url = "https://github.com/espressif/qemu/releases/download/esp-develop-9.2.2-20250817/qemu-xtensa-softmmu-esp_develop_9.2.2_20250817-x86_64-linux-gnu.tar.xz";
            sha256 = "1sr6s6w8201836jqybbi670sjsqc087mh2nial36aagrs36gm2sq";
          } else if system == "aarch64-linux" then pkgs.fetchurl {
            url = "https://github.com/espressif/qemu/releases/download/esp-develop-9.2.2-20250817/qemu-xtensa-softmmu-esp_develop_9.2.2_20250817-aarch64-linux-gnu.tar.xz";
            sha256 = "1kg75kbikghyz0a2m0iqjkr3wn89v4irhw0hh5nqi86vs47nwzri";
          } else throw "Unsupported system for esp-qemu";
          
          nativeBuildInputs = [ pkgs.autoPatchelfHook pkgs.makeWrapper ];
          buildInputs = with pkgs; [
            pixman
            libgcrypt
            SDL2
            zlib
            libslirp
            glib
            stdenv.cc.cc.lib
          ];
          installPhase = ''
            mkdir -p $out
            cp -r * $out/
          '';
        };

      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_20
            nodePackages.typescript
            nodePackages.svelte-language-server
            playwright-driver.browsers
            chromium
            gh
            git
            fontconfig
            dejavu_fonts
            
            # C/C++ Firmware Host-Testing tools
            gcc
            cmake
            ninja
            catch2_3
            cjson
            imagemagick
            wget

            # ESP-IDF
            esp-idf-full
            
            # Emulator
            esp-qemu
            
            # Python for venv
            python3
            python3Packages.pip
            python3Packages.virtualenv
          ];

          shellHook = ''
            export PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers}
            export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
            export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${pkgs.chromium}/bin/chromium"
            export FONTCONFIG_FILE=${strictFontsConf}

            # Setup Python Virtual Environment for pytest-embedded
            VENV_DIR="$PWD/.venv"
            if [ ! -d "$VENV_DIR" ]; then
              echo "Creating python venv at $VENV_DIR"
              python3 -m venv "$VENV_DIR"
              source "$VENV_DIR/bin/activate"
              pip install pytest pytest-embedded pytest-embedded-idf pytest-embedded-qemu
            else
              source "$VENV_DIR/bin/activate"
            fi

            # Wrapper to fix `esptool.py merge-bin` vs `merge_bin` for pytest-embedded
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
          '';
        };
      }
    );
}
