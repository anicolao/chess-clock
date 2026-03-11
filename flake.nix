{
  description = "Chess Logger & Clock Environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        strictFontsConf = pkgs.writeText "fonts.conf" ''
          <?xml version="1.0"?>
          <!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
          <fontconfig>
            <dir>${pkgs.dejavu_fonts}</dir>
            <cachedir>/tmp/fonts-cache</cachedir>
            <config></config>
          </fontconfig>
        '';
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
          ];

          shellHook = ''
            export PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers}
            export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
            export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${pkgs.chromium}/bin/chromium"
            export FONTCONFIG_FILE=${strictFontsConf}
          '';
        };
      }
    );
}
