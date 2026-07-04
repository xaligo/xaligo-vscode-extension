---
applyTo: "**"
---

# xaligo — General Coding Guidelines

## Project

`xaligo` is a Go CLI and WebAssembly/TypeScript package that converts the
`.xal` diagram DSL to Excalidraw, SVG, PPTX, XYFlow, and Isoflow outputs.

```text
module: github.com/ryo-arima/xaligo
Go:     1.22
```

Read `roadmap.instructions.md` for product direction,
`xal-spec.instructions.md` for DSL behavior, and
`architecture.instructions.md` for implementation boundaries.

## Directory structure

```text
xaligo/
├── cmd/
│   ├── main.go                  native CLI entry point
│   └── wasm/main.go             JavaScript/WASM adapter
├── internal/
│   ├── command.go               root Cobra command assembly
│   ├── controller/              CLI flags and file-I/O adapters
│   ├── entity/                  internal structures; independent entity layer
│   ├── usecase/
│   │   ├── xaligo.go            constructor-injected application facade
│   │   ├── parser.go            .xal parser
│   │   ├── render.go            render orchestration and dispatch
│   │   ├── scene.go             shared scene construction
│   │   ├── layout.go            resolved layout calculations
│   │   ├── plan.go              shared draw-plan calculations
│   │   ├── routing.go           shared connector routing
│   │   └── theme.go             canonical scene theming
│   ├── repository/              filesystem and output-format adapters
│   └── config/                  project configuration
├── test/
│   ├── unit/                    unit tests mirroring the project tree
│   └── integration/             black-box use-case/adapter tests
├── external/                    TypeScript external adapter layer
│   ├── command.ts               TypeScript CLI entry point
│   ├── controller/              CLI argument and file-I/O adapters
│   ├── entity/                  TypeScript API and PPTX plan types
│   ├── repository/              WASM, PptxGenJS, and package adapters
│   └── usecase/                 TypeScript orchestration and public API
├── etc/resources/aws/           catalogs, templates, icons, attribution
├── examples/                    example .xal and services CSV files
├── scripts/                     asset/catalog generation scripts
├── docs/images/                 README gallery assets
├── Makefile
├── go.mod / go.sum
└── README.md
```

The repository root contains no Go source files. Executable adapters belong in
`cmd`; application implementation belongs in `internal`. This repository's
external integration boundary is the CLI, HTTP/SSE preview protocol, and WASM
adapter rather than an importable public Go package.

## Architecture rules

- Preserve `.xal -> parser -> layout -> shared scene/plan -> encoder`.
- Format-rendering adapters call `internal/usecase`; they do not create
  parallel parser or layout pipelines.
- Input/output-format-specific encoding and persistence belong to
  `internal/repository`; use-case filenames describe processing, not formats.
- `internal/entity` owns structures exchanged between layers and contains no
  application orchestration. Shared value helpers such as theme names and
  service labels may live here when they are renderer-independent.
- Calculation and orchestration belong under `internal/usecase`.
- Keep mode (visual semantics) independent from format (serialization).
- Keep cross-format routing and geometry in shared layers.
- `cmd` imports command/adapters only; business logic stays outside entry points.
- Native and embedded environments differ through `usecase.AssetSource`, not
  through duplicated render implementations.
- Go constructs PPTX draw plans; the configured WASM/PptxGenJS adapter writes
  PPTX bytes. Do not add a second OOXML writer.
- Return context-wrapped errors. Do not panic in core code.

## Testing rules

- Put unit tests under `test/unit`, mirroring the source tree they cover.
- Put black-box tests of exported APIs and adapters in `test/integration`.
- Prefer externally observable behavior over package-private helper assertions
  when moving tests outside implementation packages.
- Add focused coverage for behavior changes and preserve regression tests.

## Assets and configuration

- Configuration: `etc/resources/aws/app.yaml`
- ID lookup: `etc/resources/aws/service-index.csv`
- Full catalog: `etc/resources/aws/service-catalog.csv`
- Embedded assets: `etc/resources/aws/assets.go`
- SVG assets: `etc/resources/aws/svg`
- Isoflow manifest: `etc/resources/aws/isoflow-icons.json`

Preserve bundled license and attribution files. Generated assets must be
refreshed through the scripts declared in the root `package.json`.

## Conventions

- Run `gofmt` on changed Go files.
- Use lowercase single-word package names.
- Wrap errors with `fmt.Errorf("context: %w", err)`.
- Represent Excalidraw elements as `map[string]interface{}` for format
  compatibility.
- Do not commit binaries, dependencies, caches, `output`, WASM artifacts, or
  TypeScript `dist` output.

## Verification

```bash
go test ./...
go build ./...
npm install
npm run build --workspace=@ryo-arima/xaligo
npm --prefix external run build:pptx-exporter-wasm
git diff --check
```
