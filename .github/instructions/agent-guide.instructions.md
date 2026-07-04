---
applyTo: "**"
---

# Agent Guide

Use this file as the repository working agreement. Read the following
preconditions before changing code:

1. `roadmap.instructions.md` — product and pipeline direction.
2. `xal-spec.instructions.md` — authoritative `.xal` behavior.
3. `architecture.instructions.md` — package boundaries and dependency rules.

## Project summary

- Go 1.22 module: `github.com/ryo-arima/xaligo`
- CLI entry point: `cmd/main.go`
- PPTX exporter WASM entry point: `external/command.ts`
- TypeScript package and implementation: `external`
- Shared application boundary: `internal/usecase`
- Generated CLI: `.bin/xaligo`
- Generated PPTX exporter WASM: `external/wasm/xaligo.wasm`

## Working rules

- Preserve `.xal -> parser -> layout -> shared scene/plan -> encoder`.
- CLI, preview, and WASM format-rendering paths call `internal/usecase`. They
  do not build a parallel parser/layout/render pipeline. Focused `add` and
  source-generation utilities may use repositories/builders directly.
- Keep mode and format independent.
- Put cross-format routing and geometry in shared layers.
- Return wrapped errors; do not panic in core code.
- Preserve unrelated and pre-existing working-tree changes.
- Do not commit generated output, dependencies, binaries, or caches.
- Add focused tests with every behavior change.

## Common commands

```bash
# Build and test
go build ./...
go test ./...

# Build distributable adapters
make build
make build-wasm
npm install
npm run build --workspace=@ryo-arima/xaligo

# Render and validate
.bin/xaligo validate examples/sample.xal
.bin/xaligo render examples/sample.xal --format excalidraw -o output/sample.excalidraw
.bin/xaligo render examples/sample.xal --format svg -o output/sample.svg
.bin/xaligo render examples/sample.xal --format xyflow -o output/sample.xyflow.json
.bin/xaligo render examples/sample.xal --format isoflow -o output/sample.isoflow.json
.bin/xaligo serve examples/sample.xal --mode network

# Clean generated artifacts
make clean
```

Native PPTX export additionally requires the configured `xaligo.wasm` PPTX exporter.
The TypeScript package consumes `BuildPPTXPlan` through WASM and creates PPTX
with PptxGenJS.

## Shared Use-Case APIs

Use `internal/usecase` instead of assembling parser, layout, and encoder
packages in adapters:

```go
Render(ctx, source, options)
RenderExcalidraw(ctx, source, options)
RenderSVG(ctx, source, options)
RenderPPTX(ctx, source, options)
RenderXYFlow(ctx, source, options)
RenderIsoflow(ctx, source, options)
BuildPPTXPlan(ctx, source, options)
Validate(ctx, source)
Diagnose(ctx, source)
```

`RenderOptions.Assets` is only needed by embedded or virtual-filesystem
adapters. Native callers should leave it nil.

## Asset workflow

- Quick ID lookup: `etc/resources/aws/service-index.csv`
- Full catalog: `etc/resources/aws/service-catalog.csv`
- Embedded asset declaration: `etc/resources/aws/assets.go`
- AWS/Tabler/Yamaha SVGs: `etc/resources/aws/svg`
- Isoflow icon manifest: `etc/resources/aws/isoflow-icons.json`

Use `npm run import:tabler-icons`, `npm run import:yamaha-icons`, or
`npm run generate:isoflow-icons` to refresh generated catalogs. Preserve the
bundled license and attribution files.

## Services CSV

The accepted columns are:

```text
id,OfficialName,Abbreviation,Summary,Usage,Notes
```

Pass its in-memory bytes through `RenderOptions.ServicesCSV`, or use
`--services` in the CLI. Catalog IDs and abbreviations are shared by all
renderers.

## Completion checklist

1. Format changed Go files with `gofmt`.
2. Run `go test ./...` and `go build ./...`.
3. For shared render use-case or asset changes, cross-build `cmd/wasm`.
4. For TypeScript-facing changes, build `external` via `npm run build --workspace=@ryo-arima/xaligo`.
5. Run `git diff --check` and inspect `git status --short`.
6. Update the DSL spec, architecture, README, or roadmap when their contract
   changed.

Unit tests belong in `test/unit`, mirroring the source tree they cover.
Black-box API and adapter tests belong in `test/integration`. Prefer testing
observable behavior over exposing package-private helpers only for tests.
