---
applyTo: "**/*.{go,ts,xal,md}"
---

# xaligo — PPTX Routing / Legend Preconditions

This file is the current source of truth for PPTX export geometry.

## Brainstorm Reference

- ChatGPT share: https://chatgpt.com/share/6a35c5b9-4528-83e8-aff9-bc37907a4d80
- The share page may not be accessible from automated tooling. Keep the concrete
  decisions below authoritative for implementation.

## Confirmed Decisions

- PPTX export is an A3-landscape-first workflow for the current AWS sample.
- The PPTX export implementation should be compiled to WASM and invoked from
  the Go repository layer.
- Do not use `goja` or V8 for PPTX export execution.
- Avoid a long-term Node.js subprocess dependency for repository-layer PPTX
  export. Node may remain a development/build tool only while the WASM exporter
  is being prepared.
- All PPTX geometry and routing decisions are computed by Go/WASM.
- The PPTX drawing/export layer must not make independent layout/routing
  decisions.
- Lines must not visually cover icons or labels.
- If any obstacle-free route exists, obstacle-hitting routes must be rejected.
- Item labels are 8pt in PPTX output.
- Item icons should remain visually consistent with 8pt labels; avoid shrinking
  icons merely to satisfy a cramped row when layout whitespace controls can be used.
- Legend belongs on separate PPTX slide(s), not outside the diagram page.
- Legend slide layout is fixed to 4 columns and contains icon, abbreviation, and
  official service name.
- DSL must support empty grid cells and both inner/outer whitespace controls.

## Current Pipeline

```text
.xal DSL
  -> Go parser/layout
  -> Excalidraw scene JSON
  -> Go pptxplan.BuildPlanJSON
  -> WASM PPTX export module invoked by Go repository layer
  -> .pptx
```

Geometry belongs on the Go side. The WASM export module should only translate
the resolved plan into PPTX bytes.

## Go / WASM Boundary

The adopted integration style is Go invoking a WASM-compiled PPTX exporter from
the repository layer.

Implementation preconditions:

- Go owns CLI/controller/repository orchestration.
- WASM must be called from `internal/repository/pptx.go`, not directly from
  controller or command packages.
- The exporter must be compiled to WASM before repository-layer execution.
- Go forwards user-facing PPTX options to the WASM exporter through a typed
  options structure or JSON bridge.
- The WASM exporter consumes the resolved Go `pptxplan` output and returns PPTX
  bytes or writes them through a repository-controlled output path.
- The WASM exporter must not perform independent geometry, layout, or routing.
- Go repository/controller code must not implement PPTX/OOXML drawing or zip
  writing directly. Keep Go as the adapter that builds the plan, invokes the
  WASM exporter, and persists the returned bytes.
- If existing TypeScript/PptxGenJS code cannot be compiled into a practical WASM
  exporter, replace that drawing layer with a WASM-compatible PPTX writer rather
  than introducing `goja` or V8.

Other integration styles are not the current implementation target:

| Style | Status |
|---|---|
| stdin/stdout JSON-RPC | Candidate for long-running/high-volume workflows |
| HTTP API | Candidate for service/BFF separation |
| gRPC | Candidate for high-performance typed service boundaries |
| Node.js subprocess | Temporary fallback only; not the target architecture |
| Embedded JS engine (`goja`, V8) | Not a target for PPTX export |

Do not spend implementation time replacing the repository-layer exporter with
`goja` or V8 unless that architecture is explicitly re-approved.

## Ownership

| Area | Owner |
|---|---|
| DSL parse/layout | `internal/usecase/parser.go`, `internal/usecase/layout.go` |
| Canonical scene and item metadata | `internal/usecase/scene.go` |
| Plan geometry, paper scaling, routing, legend data | `internal/usecase/plan.go`, `internal/usecase/routing.go` |
| WASM exporter invocation from Go | `internal/repository/powerpoint.go` |
| WASM-compatible PPTX drawing/export | `external` TypeScript package and implementation |
| WASM bridge | `cmd/wasm/main.go` |

## Paper / Scaling

- PPTX export supports `--paper`, `--orientation`, and paper-margin fitting
  flags.
- A3 landscape is generated with:

```bash
.bin/xaligo render examples/sample.xal \
  --format pptx \
  --services examples/services.csv \
  -o out.pptx \
  --paper A3 \
  --orientation landscape \
  --paper-margin-top 0.75 \
  --paper-margin-bottom 0.75
```

- Go `pptxplan` resolves paper size and computes the pixel-to-inch conversion.
- `--paper-margin N` applies an inch-based margin to every side before fitting
  the diagram to the selected paper.
- `--paper-margin-top`, `--paper-margin-right`, `--paper-margin-bottom`, and
  `--paper-margin-left` override the all-side value for individual sides.
- Paper margins do not change the slide size; they reduce the available fit
  area and centre the diagram within that inset area.
- The `paper-frame` element remains the content frame for scaling.
- Root `<frame margin="N">` or `class="ma-N"` is content outer whitespace: it
  insets diagram content without shrinking the paper frame itself.

## Routing Rules

- Route calculation is in `internal/usecase/routing.go`.
- Obstacles include image and text rectangles from the Excalidraw scene.
- Start/end rectangles are excluded from obstacle checks for that connection.
- Binding `gap` from Excalidraw arrows must be honored in PPTX routing.
- If any obstacle-free candidate exists, obstacle-hitting candidates must not be
  selected.
- Lines on an obstacle boundary count as collision.
- Existing routed paths are included in scoring so later lines avoid overlap and
  near-parallel crowding.
- Visible container borders are reserved routing paths. Connectors may cross a
  frame boundary, but parallel paths prefer the configured line margin.
- Previously placed line lanes are used as candidate offsets, so `--arrow-margin`
  affects routes that would otherwise share the same position.
- Final PPTX drawing order is:
  1. anchor backgrounds and containers/shapes
  2. route lines, traffic lines, and line-jump masks
  3. automatic junction markers
  4. icons and labels

This order prevents lines from visually covering icons even at endpoints.

## Advanced Routing Features

### Line Jumps

Excalidraw does not provide reliable built-in line jumps/bridges for this
workflow. The shared draw plan therefore implements them for SVG/PPTX.

Current approach:

- Detect line segment intersections after routing.
- Determine which line is visually above the other by layer/kind/order.
- Render jumps as a 6px background-colored mask below the upper line in
  SVG/PPTX output. The mask uses the uppermost opaque container background at
  the crossing. A curved arc may replace the rectangular mask later.
- For Excalidraw output, approximate with normal lines or supported shape
  primitives when necessary.

SVG preview and PPTX can support line jumps more accurately than Excalidraw JSON.

### Route / Traffic Separation

Network diagrams distinguish structural route lines from traffic-flow lines.

Implemented model:

| Kind | Meaning | Visual Direction |
|---|---|---|
| `route` | Physical/logical connection path | Thin, lower layer, shortest orthogonal route |
| `traffic` | Communication flow over a route | Offset from route, higher layer, stronger arrow/style |

Potential DSL forms:

```xml
<connection src="A" dst="B" kind="route" />
<connection src="A" dst="B" kind="traffic" />
```

or future shorthand:

```text
A -> B
A => B
```

Routing orders routes below normal connections and traffic, and scores nearby
lanes to keep overlapping paths readable.

### Route Connectors

Route endpoints are represented by small circular connector nodes by default.

Conceptual shape:

```text
[EC2] -- o -------- o -- [RDS]
```

Behavior:

- In SVG/PPTX, render them as small circles.
- In Excalidraw JSON, use dot arrowheads.
- `start-arrowhead="none" end-arrowhead="none"` disables them.
- Multiple routes sharing an endpoint side use a common stub and automatic
  circular fan-out/fan-in junction.

## Connector Style Options

`xaligo render --format pptx` forwards all PPTX routing options:

| Flag | Meaning |
|---|---|
| `--arrow-style` | `thin`, `standard`, `triangle`, `stealth`, `arrow`, `diamond`, `oval`, `none` |
| `--arrow-stub` | Pixel stub before the first/last bend |
| `--arrow-margin` | Pixel margin reserved around existing line lanes |
| `--px-per-inch` | Layout scaling base, default 96 |
| `--paper` | Named slide paper size: `A5`, `A4`, `A3`, `A2`, `A1`, `Letter`, `Legal`, `Tabloid` |
| `--orientation` | `portrait` or `landscape`; auto-fit when omitted |
| `--paper-margin` | Inch margin applied to all sides before paper fitting |
| `--paper-margin-top/right/bottom/left` | Inch margin override for one side |

## Group Header Tags

- Group header tag labels are single-line in PPTX output. The TS drawing layer
  sets `wrap: false` for group header label ops only; item labels and connector
  ID labels keep their normal wrapping behaviour.
- Excalidraw scene generation must reserve conservative tag label width before
  PPTX export. `groupLabelCharW` is intentionally larger than the average
  Excalidraw text metric so PowerPoint no-wrap text stays inside the tag
  background.
- When changing group tag font size, font family, padding, or tag geometry,
  update both the scene width estimate and the group-header regression tests.

## Item Labels

- Item icon size defaults to 32px in native CLI config.
- Item label font is 8pt in PPTX output.
- Excalidraw font size for item labels is `8pt * 96 / 72 = 10.666...px`.
- Item label boxes are 14px high.
- Do not shrink label boxes to text metrics if it breaks PowerPoint placement.

## Layout / Whitespace

Supported whitespace controls:

| Syntax | Behavior |
|---|---|
| `<spacer />` / `<blank />` | Empty layout slot, not rendered |
| `<item />` | Empty item-grid slot, not rendered |
| `class="pa-4"` | Inner padding, Vuetify-style 8px unit |
| `class="ma-4"` | Outer margin; on root frame this becomes page-edge content whitespace |
| `margin="N"` and `margin-*` | Pixel margin |
| `content-width="N"` / `content-height="N"` | Shrinks usable inner layout area |
| `align="top-left"` etc. | Aligns the usable content area or item grid |
| `width="N"` / `height="N"` | Fixed child size, except root frame is the paper/content frame |

For item grids, horizontal `spread` is also supported.

## Legend Pages

PPTX export adds legend slides after the diagram slide when `--services` is
provided.

- Legend data is derived from `services.csv`.
- Only services actually used in the scene are included.
- The legend contains icon, abbreviation, and official name.
- Legend layout is fixed to 4 columns per slide.
- Additional legend slides may be created when entries exceed one slide.
- The diagram slide should not include an outside-frame legend; the PPTX legend
  belongs on separate slides.

## Verification Checklist

Before considering PPTX routing/layout changes complete:

```bash
go test ./...
make build
make build-wasm
npm run build --workspace @ryo-arima/xaligo
.bin/xaligo render examples/sample.xal --format pptx --services examples/services.csv -o out.pptx --paper A3 --orientation landscape --arrow-style thin
unzip -t out.pptx
```

For icon-overlap regressions, inspect the resolved PPTX XML and ensure routed
custom geometry does not intersect target icon/label rectangles.
