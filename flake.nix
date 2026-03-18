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
        esp-idf-esp32s3 = nixpkgs-esp-dev.packages.${system}.esp-idf-esp32s3;

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
            gh
            git
            gcc
            cmake
            ninja
            catch2_3
            cjson
            imagemagick
            wget

            # ESP-IDF
            esp-idf-esp32s3
            
            # Emulator
            esp-qemu
            
            # Python for venv
            python3
            python3Packages.pip
            python3Packages.virtualenv
          ];

          shellHook = ''
            # Setup Python Virtual Environment for pytest-embedded
            VENV_DIR="$PWD/.venv"
            if [ ! -d "$VENV_DIR" ]; then
              echo "Creating python venv at $VENV_DIR"
              python3 -m venv "$VENV_DIR"
              source "$VENV_DIR/bin/activate"
              pip install pytest pytest-embedded pytest-embedded-idf pytest-embedded-qemu pytest-embedded-serial pytest-embedded-serial-esp qrcode pillow
            else
              source "$VENV_DIR/bin/activate"
            fi

            # Patch pytest_embedded_qemu for esptool.py syntax change (merge-bin -> merge_bin)
            QEMU_APP_PY=$(find "$VENV_DIR" -path "*/pytest_embedded_qemu/app.py" 2>/dev/null | head -n 1)
            if [ -n "$QEMU_APP_PY" ]; then
              sed -i 's/merge-bin/merge_bin/g' "$QEMU_APP_PY"
            fi
          '';
        };
      }
    );
}
