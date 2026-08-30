# Changelog

## 0.0.22

- Updated the bundled `@xaligo/xaligo` runtime and native assets to the stable
  `0.2.3` release.

## 0.0.21

- Updated the bundled `@xaligo/xaligo` runtime and native assets to the stable
  `0.2.2` release.
- Fixed local Extension Development Host rendering with the sibling xaligo CLI
  by rooting its service catalogs and SVG assets through `XALIGO_HOME`.

## 0.0.20

- Replaced the `main-40` prerelease runtime package and native assets with the
  official stable `xaligo 0.2.1` (`v0.2.1`) release.
- Pinned the bundled `@xaligo/xaligo` dependency to the published npm registry
  version and updated stable-release identity checks.
- Removed the terminal-backed generic CLI launcher, its Serve-port setting, and
  all VS Code Terminal API usage. Markdown export now runs as a cancellable
  background action.

## 0.0.19

- Updated the bundled runtime to the `xaligo 0.2.1 main 40` prerelease package
  and native binaries.
- Added automatic Language Server Protocol 3.18 integration for diagnostics,
  symbols, semantic tokens, completion, hover, definitions, and references.
- Enabled `.xal` editing suggestions and supplemented the native LSP snippet
  set with the full lexical tag catalog, including AWS V1 tags.
- Aligned export actions with the current CLI: SVG and PPTX file export; removed
  the retired Excalidraw, PDF, Excel, XYFlow, and Isoflow actions.
- Updated runtime integrity and packaging checks for the statically linked
  native renderer, including SVG, PPTX, diff, and LSP smoke tests.
- Expanded syntax highlighting and offline documentation for the V2
  `<scene version="2">` profile.

## 0.0.18

- Updated the bundled xaligo renderer dependency to the stable
  `@xaligo/xaligo@0.1.27` release.
- Added `xaligo.servePort` for choosing the HTTP port used by the Serve live
  preview CLI feature while retaining port `8080` as the default.

## 0.0.17

- Fixed Windows and custom-CLI execution so custom binaries use their own
  resources, Windows paths and empty arguments round-trip correctly, and
  command timeouts are configurable and cancellable.
- Fixed multi-frame export reporting and preview ordering by consuming the
  renderer's actual structured output paths.
- Added local and HTTPS Markdown image support, safe link opening, persistent
  frame-card positions, accurate SVG sizing, and accessible SVG-only dialogs.
- Expanded bundled and managed runtime health checks to cover catalogs, SVG
  assets, WASM, architecture, and all seven render formats.
- Hardened VSIX binary downloads with HTTPS host restrictions, SHA-256
  verification, architecture validation, and atomic stale-binary replacement.
- Added Node.js 24 CI on macOS, Linux, and Windows, dependency auditing, and
  required VSIX-content checks.
- Updated the latest V1 syntax coverage and fixed `<col>` indentation.
- Removed the bundled file icon theme so installing xaligo never replaces
  icons for unrelated file types.
- Added offline `.xal` specification and diagram-authoring documentation.
- Updated `tar` and audited transitive dependencies to patched releases.

## 0.0.16

- Republished after 0.0.15 was already live on the Marketplace; no
  functional changes beyond the English interface label fixes below.
- Switched remaining preview interface labels to English.

## 0.0.15

- Updated the bundled xaligo renderer dependency to `@xaligo/xaligo@0.1.25-main.34`.
- Added PDF, Excel, XYFlow, and Isoflow export commands, plus Validate
  Diagram and Show Runtime Version commands.
- Added a Run CLI Feature... command covering `serve`, Markdown
  rendering, source generation, service insertion, project
  initialization, help, and shell completion.
- Added Markdown preview: renders `.md`/`.markdown` files with the
  MIT-licensed `vue-markdown-render` and embeds CLI-generated xaligo
  SVG diagrams as vector images.
- Reworked the preview panel into a multi-frame diagram-card canvas
  with independent per-frame drag/fit controls.
- Rebuilt the preview webview UI with Vue 3 and Element Plus (MIT).

## 0.0.14

- Added separate commands for updating the xaligo runtime and the extension.
- Added an Updates menu to the interactive preview.
- Added verified, staged runtime updates with healthy bundled-runtime fallback.
- Added version-aware selection between managed and bundled runtimes.

## 0.0.13

- Updated the bundled xaligo renderer dependency to `@xaligo/xaligo@^0.1.21`.
- Added a Preview / Diff menu bar and two-file structural diff view.
- Added pointer-centred Ctrl/Cmd + wheel zoom and drag-to-pan interaction.
- Added latest V1 tags, attributes, explicit `version="1"`, and valid example IDs.
- Added unit tests for preview geometry, CLI contracts, and syntax coverage.

## 0.0.9

- Updated the bundled xaligo renderer dependency to `@xaligo/xaligo@^0.1.13`.

## 0.0.8

- Updated the bundled xaligo renderer dependency to `@xaligo/xaligo@^0.1.11`.

## 0.0.7

- Updated the bundled xaligo renderer dependency to `@xaligo/xaligo@^0.1.10`.

## 0.0.6

- Updated the bundled xaligo renderer dependency to `@xaligo/xaligo@^0.1.7`.
- Fixed the global storage installer so VS Code installs the same renderer version range as the extension package.

## 0.0.4

- Added SVG, PPTX, and Excalidraw export commands for `.xal` files.
- Updated Marketplace repository links to the `xaligo/xaligo-vscode-extension` repository.

## 0.0.2

- Added an original-color `.xal` file icon generated from SVG and bundled file icon theme.
- Added a command and one-time hint for selecting the bundled file icon theme when the active theme overrides `.xal` icons.
- Bumped the Marketplace package version for the next publish.

## 0.0.1

- Initial Marketplace-ready package.
- Added `.xal` language registration and TextMate syntax highlighting.
- Added editor tag coloring for xaligo and AWS group tags.
- Added SVG preview command with zoom, fit-width, reset, close, and save-refresh support.
- Added service CSV discovery for preview labels and legends.
