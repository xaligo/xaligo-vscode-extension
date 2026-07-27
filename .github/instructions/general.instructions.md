---
applyTo: "**"
---

# xaligo VS Code Extension — General Coding Guidelines

## Project

`xaligo-vscode-extension` is the VS Code extension for the xaligo `.xal`
diagram DSL: syntax highlighting, an interactive Vue-based preview webview,
structural diff, Markdown preview, and diagram export commands. It is a
TypeScript-only project — there is no Go source in this repository. All
`.xal` parsing, layout, and rendering is delegated to the bundled
`@xaligo/xaligo` npm package; this repository only wraps that CLI/WASM
package with VS Code integration.

```text
name:      xaligo-vscode-extension
publisher: xaligo
language:  TypeScript
bundler:   Vite (separate extension-host and webview iife bundles)
tests:     Vitest
```

## Where to find xaligo core (.xal DSL / CLI / renderer) documentation

This repository does not implement the `.xal` parser, layout engine, or
renderers — it consumes the `@xaligo/xaligo` npm package
(`node_modules/@xaligo/xaligo`, version pinned in `package.json`) for that.
This repo's own `xal-spec.instructions.md`, `architecture.instructions.md`,
`roadmap.instructions.md`, and `arrow-routing-pptx.instructions.md` are
reference snapshots of the xaligo core repository's own instructions, not an
independent source of truth for this codebase. Prefer, in order:

1. **The bundled package actually shipped with this extension** —
   `node_modules/@xaligo/xaligo/README.md`,
   `node_modules/@xaligo/xaligo/VERSION`, and
   `node node_modules/@xaligo/xaligo/bin/xaligo.cjs <command> --help` for the
   exact CLI flags and behavior of the version this extension currently
   depends on (see the `@xaligo/xaligo` entry in `package.json`
   `dependencies`).
2. **The sibling `xaligo` core repository**, when this multi-root workspace
   also has it checked out (commonly alongside this folder, e.g. `../xaligo`)
   — its `docs/src/**` (mdbook source) and
   `.github/instructions/*.instructions.md` files are the actively
   maintained originals for the DSL spec, architecture, and roadmap.
3. **This repo's own copies** (`xal-spec.instructions.md`,
   `architecture.instructions.md`, `roadmap.instructions.md`,
   `arrow-routing-pptx.instructions.md`, `diagram-creation.instructions.md`)
   only as a last-resort fallback when neither of the above is available,
   and flag to the user that they may be stale relative to the currently
   installed `@xaligo/xaligo` version.

Read `agent-guide.instructions.md` for this repository's own working
agreement, directory structure, and common commands.

## Directory structure

```text
xaligo-vscode-extension/
├── src/
│   ├── extension.ts              activation, command registration
│   ├── xaligo.ts                 renderer facade over the CLI/native binary
│   ├── xaligo-command.ts         CLI argument builders
│   ├── preview.ts                diagram/diff/Markdown preview panel controller
│   ├── preview-contract.ts       shared webview <-> host message/state types
│   ├── preview-artifacts.ts      rendered SVG/frame artifact handling
│   ├── markdown-preview.ts       Markdown render output parsing for preview
│   ├── logger.ts                 output-channel logging
│   ├── runtime-*.ts              managed xaligo runtime resolve/verify/update
│   ├── extension-update*.ts      extension self-update workflow
│   ├── updates.ts                combined runtime/extension update UI
│   └── webview/
│       ├── main.ts               Vue app bootstrap (preview webview entry)
│       ├── App.vue               preview webview UI (Vue 3 + Element Plus)
│       └── composables/          Vue composables (e.g. view-transform/zoom)
├── test/                         Vitest specs mirroring src/
├── media/preview.css             webview stylesheet
├── syntaxes/xal.tmLanguage.json  `.xal` TextMate grammar
├── language-configuration.json   `.xal` language configuration
├── examples/                     sample `.xal`/services CSV files
├── scripts/                      build/packaging helper scripts
├── assets/, images/               extension and README images
├── vite.config.ts                extension-host bundle (src/extension.ts)
├── vite.webview.config.ts        webview bundle (src/webview/main.ts)
├── package.json                  manifest, commands, scripts, dependencies
└── CHANGELOG.md / THIRD_PARTY_NOTICES.md
```

## Architecture rules

- Keep `.xal`/CLI behavior delegated to the `@xaligo/xaligo` dependency; do
  not reimplement parsing, layout, or rendering in this repository.
- `src/extension.ts` only wires commands to controllers/use-case-like
  modules (`xaligo.ts`, `preview.ts`, `xaligo-command.ts`); keep non-trivial
  logic out of command callbacks.
- `preview-contract.ts` is the single shared type boundary between the
  extension host (`preview.ts`) and the webview (`src/webview/**`). Change
  both sides together when it changes.
- The webview (`src/webview/**`) only talks to the extension host through
  `acquireVsCodeApi().postMessage`/`onDidReceiveMessage`; it must not read
  files or spawn processes directly.
- `src/webview/main.ts` is the only Vite webview entry point
  (`vite.webview.config.ts`); do not leave orphaned alternate webview entry
  scripts in the tree — remove superseded implementations instead of layering
  a new one alongside the old.
- Preserve unrelated and pre-existing working-tree changes.
- Do not commit `dist/`, `node_modules/`, `.vsix` packages, or other
  generated/build output.
- Add focused Vitest coverage with every behavior change.

## Common commands

```bash
npm install
npm run typecheck        # tsc --noEmit
npm test                 # vitest run
npm run build            # clean-dist + extension bundle + webview bundle
npm run watch            # rebuild extension bundle on change
npm run watch:webview    # rebuild webview bundle on change
npm run check:renderer   # verify the bundled native xaligo renderer
npm run package          # stage native binaries + vsce package
```

## Verification

```bash
npm run typecheck
npm test
npm run build
git diff --check
git status --short
```

## Conventions

- Keep new source files under `src/` (or `src/webview/` for webview-only
  code) with a matching Vitest spec under `test/`.
- Wrap Node.js errors with context rather than letting raw fs/process errors
  surface to the user unexplained.
- Do not commit binaries, dependencies, caches, `dist`, or `.vsix` output.
