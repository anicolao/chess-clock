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
        
        # Only try to get ESP packages on Linux, as macOS support in this flake is limited
        esp-pkgs = if pkgs.stdenv.isLinux then [
          nixpkgs-esp-dev.packages.${system}.esp-idf-full
          esp-qemu
        ] else [];

        esp-qemu = if pkgs.stdenv.isLinux then (pkgs.stdenv.mkDerivation {
          pname = "esp-qemu";
          version = "esp-develop-9.2.2-20250817";
          src = if system == "x86_64-linux" then pkgs.fetchurl {
            url = "https://github.com/espressif/qemu/releases/download/esp-develop-9.2.2-20250817/qemu-xtensa-softmmu-esp_develop_9.2.2_20250817-x86_64-linux-gnu.tar.xz";
            sha256 = "1sr6s6w8201836jqybbi670sjsqc087mh2nial36aagrs36gm2sq";
          } else if system == "aarch64-linux" then pkgs.fetchurl {
            url = "https://github.com/espressif/qemu/releases/download/esp-develop-9.2.2-20250817/qemu-xtensa-softmmu-esp_develop_9.2.2_20250817-aarch64-linux-gnu.tar.xz";
            sha256 = "1kg75kbikghyz0a2m0iqjkr3wn89v4irhw0hh5nqi86vs47nwzri";
          } else throw "Unsupported Linux system for esp-qemu";
          
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
        }) else null;

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
              pip install --quiet pytest pytest-embedded pytest-embedded-idf pytest-embedded-qemu
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
            
            echo "Environment loaded for Chess Clock (macOS optimized)"
          '';
        };
      }
    );
}
