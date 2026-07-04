---
applyTo: "**/*.{go,ts,md,yml,yaml,json}"
---

# Architecture

This document defines the implementation boundaries of xaligo. Product
direction lives in `roadmap.instructions.md`; DSL behavior lives in
`xal-spec.instructions.md`.

## Core pipeline

```text
.xal source
   -> internal/usecase parser functions
   -> internal/usecase layout functions
    -> resolved canonical scene
    -> internal/usecase plan calculations
    -> internal/repository output encoder
    -> SVG | Excalidraw | PPTX | XYFlow | Isoflow
```

The flat `internal/usecase` package is the shared rendering boundary.
Format-rendering adapters (CLI, preview server, and WASM) call a
constructor-injected use case instead of assembling a parallel
parser/layout/render pipeline. Utility
commands such as `generate xal` and `add service` may use their focused internal
builders and repositories directly.

## Package responsibilities

| Path | Responsibility |
|---|---|
| `internal/entity` | Independent entity layer containing cross-layer structures |
| `internal/usecase` | Parser, layout, validation, scene/plan calculations, and orchestration; filenames describe processing only |
| `internal/repository` | Filesystem, catalog, HTTP preview, and output-format encoding/export adapters |
| `internal/command.go` | Root Cobra command assembly |
| `internal/controller` | Cobra CLI argument and file-I/O adapters |
| `cmd/wasm` | JavaScript-global adapter over shared use cases and embedded assets |
| `external` | TypeScript external adapter layer mirroring `internal`: `command.ts`, `controller`, `entity`, `repository`, `usecase` |
| `test/unit` | Unit tests mirroring the source tree they cover |
| `test/integration` | Black-box tests of exported APIs and adapters |
| `etc/resources/aws` | Catalogs, templates, embedded assets, and attribution |

## Invariants

1. `.xal` is the only source DSL. Do not add adapter-specific parsers.
2. Mode selects visual semantics; format selects output serialization.
3. Format-rendering production paths call parser and layout through
   `internal/usecase`. Adapters use an injected `usecase.XaligoUsecase`.
4. Routing and connector behavior belongs in shared scene/plan layers, not in
   individual output adapters.
5. Filesystem-less environments provide an `AssetSource`; they do not fork the
   render pipeline.
6. Native configuration remains the default when `RenderOptions.Assets` is nil.
7. New formats require a `Format` value, shared render function, CLI wiring,
   tests, and adapter documentation.
8. Errors are returned and wrapped with context. Core packages do not panic.
9. Native CLI dependency construction belongs in `NewRootCmd`; the WASM entry
   point is its own composition root. Controllers depend on use cases, never on
   other controllers.
10. Input/output destination dependencies belong in `internal/repository` and
    must not appear as use-case filenames.

## Dependency direction

```text
cmd / internal/controller / cmd/wasm / TypeScript
                         |
                         v
                     internal/usecase
                         |
                         v
                    internal/*
```

Entity and use-case packages must not depend on CLI, preview, WASM, or
TypeScript adapters. Encoders consume entity structures and must not depend on
use-case implementations merely to access types.

## Verification

Run after structural changes:

```bash
go test ./...
go build ./...
npm install
npm run build --workspace=@ryo-arima/xaligo
npm --prefix external run build:pptx-exporter-wasm
```

Generated binaries, `node_modules`, `output`, and package `dist` directories are
ignored and must not be committed.
