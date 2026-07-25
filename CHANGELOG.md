# Changelog

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
