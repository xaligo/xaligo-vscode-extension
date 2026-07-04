---
applyTo: "**/*.{go,ts,xal,md}"
---

# xaligo — Roadmap Preconditions

This roadmap is a planning precondition for future implementation work. Prefer
changes that move xaligo toward a diagram-as-code platform with a clean render
pipeline, SVG-first preview capability, network-diagram primitives, and
eventual VS Code / PPTX integration.

Implementation guidance:

- Keep the core pipeline separable as `.xal -> parser -> layout -> renderer`.
- Treat Excalidraw, SVG, and PPTX as output renderers over a shared model where
  possible.
- Prioritize SVG renderer and network diagram primitives before advanced PPTX
  feature polish when the choice is otherwise ambiguous.
- Route/traffic separation, route connectors, orthogonal routing, edge offsets,
  layer routing, junctions, and line jumps are roadmap features, not one-off
  export hacks.
- Live preview and VS Code integration should build on `xaligo render` /
  `xaligo validate`, not separate hidden pipelines.

## Product Architecture Preconditions

### Common DSL and Go Core

- Keep `.xal` as the single source DSL for every visual mode and export format.
- Keep Go as the core parser, validation, layout, routing, and rendering engine.
- VS Code, browser preview, and exporters must consume public core APIs instead
  of reimplementing parsing or layout.
- Preserve the pipeline boundary:

```text
.xal -> parser -> layout/shared model -> mode renderer -> format encoder
```

### Mode and Format Are Independent

`mode` selects visual and layout semantics. `format` selects serialization or
the target integration. Do not encode a visual mode as a file format or assume
that one format has only one mode.

Target modes:

| Mode | Visual/layout intent |
|---|---|
| `standard` | Normal two-dimensional architecture diagrams |
| `network` | Route, traffic, circular connector, and topology-oriented diagrams |
| `aws` | AWS official-icon-oriented architecture diagrams |
| `aws-2.5d` | Cloudcraft/legacy AWS-reference-style oblique diagrams |
| `topology` | Instana/SkyWalking-style dependency topology |

Target formats:

| Format | Primary use |
|---|---|
| `svg` | Portable output and live preview |
| `excalidraw` | Editable Excalidraw scene |
| `pptx` | Editable presentation export |
| `xyflow` | React Flow/GUI editor integration |
| `isoflow` | Isometric/2.5D integration |

Target CLI shape:

```bash
xaligo render input.xal --mode network --format svg -o output.svg
xaligo render input.xal --mode aws-2.5d --format pptx -o output.pptx
```

Backward compatibility: omitting `--mode` must retain the current standard/AWS
behavior until an explicit default-mode migration is released.

### Shared Rendering APIs

The shared in-repository use-case boundary should support at least:

```go
RenderSVG()
RenderExcalidraw()
RenderPPTX()
RenderXYFlow()
RenderIsoflow()
```

Prefer a shared extensible API underneath the convenience functions:

```go
Render(ctx, input, RenderOptions{Mode: mode, Format: format})
Validate(ctx, input)
```

## Delivery Phases

### Phase 1: Basic Output

Status: complete.

- Stabilize `xaligo render` and `xaligo validate`.
- Complete the SVG renderer as the primary preview surface.
- Add shared Light and Dark themes.
- Extract stable renderer-facing shared use cases.

### Phase 2: Network Diagram Features

Status: all seven steps and textual connection shorthands have initial shared
implementations. Continue with hardening and cross-renderer visual regression
coverage.

Implement shared model/routing concepts in this order where dependencies allow:

1. Route Connector with circular endpoints.
2. Orthogonal Routing.
3. Route/Traffic separation.
4. Edge Offset.
5. Line Jump.
6. Layer Routing.
7. Junction generation.

These features must be shared across renderers where possible, rather than
implemented as PPTX-only corrections.

### Phase 3: Live Preview

Status: initial implementation complete. `xaligo serve` polls `.xal` sources,
renders through the public SVG API, reports source-positioned diagnostics, and
publishes SSE reload events. Browser polish remains.

- Add `xaligo serve` on top of public render/validate APIs. (implemented)
- Watch `.xal` files and automatically re-render. (implemented)
- Serve an SVG-first browser preview with incremental refresh. (implemented)
- Keep the protocol reusable by the VS Code extension.

## VS Code Extension Preconditions

The VS Code extension is developed in a separate repository. This repository
owns the reusable Go/WASM APIs and HTTP/SSE preview protocol only; do not add
extension packaging or VS Code-specific parser/rendering forks here.

The extension target includes:

- `.xal` syntax highlighting.
- Validation and source-positioned diagnostics. (Go and TypeScript/WASM APIs implemented)
- Live Preview and a Preview Panel.
- SVG preview first; Excalidraw, XYFlow, Isoflow, and 2.5D views later.

The extension must call the same validation/render pipeline as the CLI. Do not
create an extension-only parser, layout engine, or hidden preview format.

## AWS 2.5D Mode

`mode: aws-2.5d` targets Cloudcraft and legacy AWS-reference-style oblique
architecture diagrams. It is a visual mode, not a standalone file format.

Required concepts:

- `plane` / `zone` layout primitives.
- Isometric-style nodes and routing.
- AWS node presets including `route53`, `cloudfront`, `elb`, `ec2`, `rds`, and
  `s3`.
- AWS Legacy / Cloudcraft-like themes.

Implement the first version in the native SVG renderer. WebView or GUI work may
learn from compatible 2.5D OSS projects, but the core representation must remain
usable without a specific UI framework.

## Export Roadmap

Primary formats remain SVG, Excalidraw, and PPTX. Add:

- XYFlow export for React Flow-style GUI editors. (initial implementation complete)
- Isoflow export for isometric and 2.5D integrations. (initial upstream model export complete)

Both exports should consume the shared resolved model; they must not become
alternative parsers for `.xal`.

## Long-Term Product Position

Position xaligo between PlantUML, Excalidraw, draw.io, Cloudcraft, and
Instana-style topology tools:

- Diagram as Code.
- Strong AWS and network diagram support.
- 2D, 2.5D, and topology views from one DSL.
- Comfortable VS Code authoring.
- SVG, PPTX, Excalidraw, XYFlow, and Isoflow output.

## Current State

The repository is already beyond a blank v0.1 baseline in several areas.

Implemented or partially implemented:

- `.xal` XML-style parser exists in `internal/usecase/parser.go`.
- Vuetify-like layout engine exists in `internal/usecase/layout.go`.
- Canonical scene construction exists in `internal/usecase/scene.go`.
- Native CLI exists with `render`, `generate`, `add`, `init`, and `version`.
- `render --format excalidraw` supports `services.csv` abbreviation/legend
  workflows.
- Draw-plan geometry and routing exist in `internal/usecase/plan.go` and
  `internal/usecase/routing.go`.
- PPTX routing already includes obstacle avoidance, binding gap handling,
  arrow margin/lane avoidance, A3 paper options, item label sizing, and legend
  slide data.
- Repository-layer PPTX export has been redirected toward a WASM exporter
  adapter in `internal/repository/powerpoint.go`.
- `xaligo render --format excalidraw|svg|pptx` is implemented.
- `xaligo render --format xyflow` and TypeScript/WASM `renderXYFlow()` export
  nested React Flow-compatible nodes and edges.
- `xaligo render --format isoflow`, Go `RenderIsoflow`, and TypeScript/WASM
  `renderIsoflow()` export an upstream Isoflow-compatible model from the shared
  scene.
- `xaligo validate` reuses parser and layout validation.
- The SVG encoder is implemented in `internal/repository/svg.go` over the
  shared draw plan.
- Shared `light` and `dark` themes are implemented for Excalidraw, SVG, and
  PPTX via `xaligo render --theme`.
- Stable Go use cases in `internal/usecase` expose `Render`, `RenderExcalidraw`, `RenderSVG`, `RenderPPTX`,
  `RenderXYFlow`, `RenderIsoflow`, and `Validate`; CLI SVG/Excalidraw/validation
  use the same pipeline.
- CLI, preview, and WASM adapters now use the same render use case. Embedded
  environments inject an `AssetSource` instead of reimplementing parser,
  layout, or scene construction.
- Isoflow exports shared group borders as view rectangles and produces stable
  icon ordering.
- Route connectors default to circular endpoints across Excalidraw, SVG, and
  PPTX.
- Node/PptxGenJS can still generate `out.pptx` as a temporary development path,
  but it is not the long-term repository-layer architecture.

Important gaps:

- `external/wasm/xaligo.wasm` is the PPTX exporter WASM artifact.
- Cross-renderer visual regression coverage is still limited.

## Rebaselined Implementation Order

Use this order when starting new roadmap work from the current repository state:

1. Complete the repository-layer WASM PPTX exporter contract by providing
  `xaligo.wasm`; keep Go free of PPTX/OOXML writer code.
2. Harden shared network routing with cross-renderer visual regression tests.
3. Build the VS Code preview on the reusable HTTP/SSE protocol exposed by
   `xaligo serve`.

## v0.1 Foundation

Status: complete. CLI and shared use cases share parser/layout/render paths for
validation, Excalidraw, and SVG.

### Rendering Engine Refactoring

Separate the core pipeline into:

```text
.xal
 ↓
parser
 ↓
layout
 ↓
renderer
```

### Public API

```go
RenderExcalidraw()
RenderSVG()
RenderPPTX()
RenderXYFlow()
RenderIsoflow()
```

Current target API shape:

```go
Render(ctx, input, RenderOptions{Mode: mode, Format: format}) ([]byte, error)
Validate(ctx, input) error
```

### CLI

```bash
xaligo render
xaligo validate
```

Required compatibility:

- Keep existing `xaligo render <input.xal> -o <out.excalidraw>` working.
- Add `xaligo render <input.xal> --format excalidraw|svg|pptx`.
- Keep format conversion under `xaligo render --format ...`; `generate` should
  remain focused on source `.xal` generation.
- `validate` must reuse parser/layout validation rather than duplicate parsing.

---

## v0.2 SVG Renderer

Status: initial renderer, route/traffic primitives, and shared Light/Dark themes
are implemented.

### SVG Export

```bash
xaligo render input.xal --format svg
```

### Supported Elements

- Node
- Group
- Label
- Route
- Traffic

### Themes

- Light
- Dark

---

## v0.3 Network Diagram Features

Status: route/traffic kinds, circular route endpoints, styling, layer order,
basic lane separation, automatic route junctions, and textual connection
shorthands are implemented across Excalidraw, SVG, and PPTX.

### Route Connector

Use circular connectors at both ends of route lines.

```text
o------o
```

### Connector Model

```go
type Connector struct {}
```

### Orthogonal Routing

Support right-angle routing.

```text
+----+
|    |
+----+
```

### Route / Traffic Separation

#### Route

```text
o------o
```

#### Traffic

```text
======>
```

### DSL

```text
web --- db
web ==> db
```

Status: implemented using `<item name="...">`, `<item ref="...">`, or numeric
item IDs. Shorthands expand into the shared connection model during parsing.

---

## v0.4 Advanced Routing

Status: initial shared implementations are complete for edge offsets, routing
layers, frame-border clearance, and automatic fan-out/fan-in junctions.

### Edge Offset

Automatically separate overlapping routes.

```text
------
======
```

### Layer Routing

Separate routing layers.

```text
Route Layer
Traffic Layer
```

### Junction Generation

```text
      +-- DB
o-----+
      +-- Cache
```

---

## v0.5 Line Jumps

Status: rectangular background-mask jumps are implemented in the shared draw
plan for SVG/PPTX. Curved bridge arcs and an Excalidraw approximation remain.

### Bridge / Jump Lines

```text
----^----
---------
```

### Features

- Segment intersection detection
- Automatic bridge generation

---

## v0.6 Live Preview

Status: initial HTTP/SSE live preview and source-positioned parser diagnostics
implemented; VS Code integration remains.

### xaligo serve

```bash
xaligo serve
```

### Features

- File watching
- Automatic re-rendering
- Real-time updates

### Backend Stack

- Go
- Echo
- WebSocket
- fsnotify

### Frontend Stack

- templ
- HTMX

### Preview Flow

#### Initial

```text
.xal
 ↓
SVG
 ↓
Browser
```

#### Real-Time Updates

```text
File Change
 ↓
Re-render
 ↓
Server-Sent Events
 ↓
Preview Refresh
```

---

## v0.7 VS Code Extension

Status: maintained in a separate repository. This core repository now provides
the required WASM diagnostics API, source positions, stable SVG rendering, and
HTTP/SSE preview protocol.

### Language Support

```text
.xal
```

### Features

- Syntax Highlighting
- Validation
- Error Location Reporting

### Preview Panel

```text
Editor
|
+- Source
+- Preview
```

### Live Preview

```text
Save
 ↓
xaligo render
 ↓
Preview Update
```

---

## v0.8 Excalidraw Integration

Status: native Excalidraw export exists; live WebView/updateScene integration
is not started.

### Excalidraw Preview

```text
.xal
 ↓
Excalidraw JSON
 ↓
WebView
```

### Features

- updateScene() support
- Real-time synchronization

### Excalidraw Export

```bash
xaligo render --format excalidraw
```

---

## v0.9 PowerPoint Export

Status: partially implemented ahead of schedule. Go-side geometry/routing plan
generation exists, and Node/PptxGenJS can generate PPTX as a temporary
development path. The required long-term gap is `xaligo.wasm`, invoked
from the Go repository layer with resolved plan JSON.

### PPTX Export

```bash
xaligo render --format pptx
```

Compatibility during transition:

- Keep `xaligo render --format pptx` usable when a WASM exporter is available.
- Do not reintroduce repository-layer Node subprocess execution as the default.
- Do not implement PPTX/OOXML writing in Go controller/repository code.
- Keep route/traffic/theme support renderer-agnostic where possible.

### Supported Features

- Shapes
- Connectors
- Routes
- Traffic Flows
- Themes

---

## v1.0

### VS Code Marketplace Release

#### Included Features

- Live Preview
- SVG Export
- Excalidraw Export
- PPTX Export
- Route Connectors
- Orthogonal Routing
- Traffic Layers
- Edge Offset
- Line Jumps

---

## Future Vision

### AWS Architecture Mode

```text
AWS Icons
Auto Layout
Route Layer
Traffic Layer
```

### Network Diagram Mode

```text
L2
L3
Route
Traffic
```

### Infrastructure as Diagram

```text
Diagram as Code
+
VS Code
+
Git
+
CI/CD
```

---

## Project Goal

Create a Diagram as Code platform positioned between:

```text
PlantUML
      +
Excalidraw
      +
draw.io
      +
Cloudcraft
      +
Instana-style Topology
```

with a strong focus on:

- AWS Architecture Diagrams
- Network Topology Diagrams
- Infrastructure Documentation
- Diagram-Driven Development
- Multi-mode 2D / 2.5D / Topology Rendering
- SVG / PPTX / Excalidraw / XYFlow / Isoflow Export
