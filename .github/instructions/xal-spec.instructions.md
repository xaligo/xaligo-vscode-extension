---
applyTo: "**/*.xal"
---

# xaligo DSL (.xal) Specification

## Overview

`.xal` is a Vue-style layout DSL with XML syntax.
The root tag is either `<frame>` for a single diagram page or `<frames>` for a
multi-frame document.
The parser uses `encoding/xml` and handles attributes, nested tags, and text content.

## V1 Compatibility Profile and Version Boundary

This document defines the frozen V1 compatibility profile. Canonical V1 source
explicitly sets `version="1"` on its `<frame>` or `<frames>` root. For backward
compatibility, an unversioned V1 root still defaults to V1 but emits a warning
recommending the explicit version. A `version` value other than `1` on a V1
root is invalid; it must never silently select another language version.

V2 uses a distinct, reject-safe root:

```xml
<scene version="2">
  ...
</scene>
```

`<scene>` requires `version="2"`; an unversioned `<scene>` is invalid. A V1
reader is only required to understand `<frame>` and `<frames>`, so it rejects a
V2 document at the root instead of partially rendering V2 syntax as V1. Do not
use `<frame version="2">` or `<frames version="2">`.

A V2 implementation must accept this V1 profile as input, preserve its
defaults and compatibility behavior, and lower it directly to the shared typed
model. It must not rewrite V1 XML into V2 XML, parse the document twice, or
invoke V1 through a serialized intermediate representation. V1 has no
dependency on, and no obligation to understand, V2.

Canonical V1 source uses lowercase XML tag names, attribute names, and enum
tokens exactly as documented here. Historical case-insensitive or directional
aliases that are not listed in this specification are accepted implementation
details, not part of the frozen compatibility profile. A V2 compatibility
frontend canonicalizes the documented V1 values once at its input boundary.

## Root Tag

```xml
<frame version="1" width="1440" height="900" class="pa-4">
  ...
</frame>
```

For multi-frame documents, wrap pages in `<frames>` and give each child
`<frame>` a stable `id`.

```xml
<frames version="1" gap="48">
  <frame id="overview" width="1440" height="900">
    ...
  </frame>
  <frame id="detail" width="1440" height="900">
    ...
  </frame>
</frames>
```

| Attribute | Type | Default | Description |
|---|---|---|---|
| `version` | string | `"1"` with warning when omitted | Root only. Explicit `"1"` is recommended and is the only accepted value |
| `width` | float | `1280` | Frame width (px) |
| `height` | float | `720` | Frame height (px) |
| `class` | string | — | Spacing class |
| `layout` | string | — | Set to `"horizontal"` to arrange children horizontally |
| `gap` | float | `16` | Gap between child elements (px) |
| `item-size` | float | render-context default, normally `32` | Max icon size (px) applied to all `<item>` elements in this file. Overrides the native `item.icon_size` or embedded asset-source value |
| `margin` / `margin-*` | float | — | DSL content whitespace in pixels. On root `<frame>`, paper-frame size is preserved and content is inset. This is separate from PPTX CLI `--paper-margin*` flags, which are inch-based export fitting margins |
| `content-width` / `content-height` | float | — | Shrink usable inner layout area |
| `align` | string | — | Align usable content area (`top|middle|bottom` + `left|center|right`) |
| `overflow` | string | `error` | Child containment policy: `error` or `visible` |

`<frames>` accepts `gap` and optional `layout="vertical"`. Without
`layout="vertical"`, frames are arranged horizontally. A `<frame>` inside
`<frames>` requires a non-empty `id`.

## Numeric and Geometry Contract

Numeric attributes are validated before layout. A numeric value must be a
finite base-10 number; `NaN`, positive or negative infinity, an empty numeric
value, and malformed trailing text are errors. The current implementation
validates the source attributes and then reads those validated values during
layout; replacing the string attribute map with a typed normalized layout
specification is a separate roadmap item.

The following domain rules apply:

| Attributes | Required domain |
|---|---|
| `width`, `height`, `content-width`, `content-height`, `item-size`, `font-size` | greater than `0` when specified |
| `row`, `col` | greater than `0` when specified |
| `span` | greater than `0` and at most `12`; flexible sibling spans in one `<row>` must total at most `12` |
| `gap`, margins, spacing-class padding | greater than or equal to `0` |
| `scale`, `coordinate-scale`, `grid`, `stroke-width` | greater than `0` when specified |
| `x`, `y`, `dx`, `dy`, bend coordinates | any finite value, subject to the containing geometry rule |

An omitted attribute uses its documented default. An explicitly empty
`align` is treated as omitted; it must not produce an invalid-alignment warning.
Unknown non-empty enum values remain errors or source-positioned warnings as
specified by that attribute.

V1 intentionally distinguishes strict values from compatibility fallbacks:

| Input | V1 behavior |
|---|---|
| Invalid `overflow`, connection side, or connection anchor | Validation error |
| Unknown `layout`, connection `kind`, stroke style, arrowhead, or arrowhead-size value | Validation error |
| Unknown render mode, format, theme, paper/orientation, arrow-style option, or SVG legend position | Render-option error |
| Recognized but unavailable render mode (`aws-2.5d` or `topology`) | Not-implemented error |
| Empty `align` | Omitted; defaults to `top-left` |
| Malformed or unknown non-empty `align` | Warning; each unsupported component keeps its `top` or `left` default |
| Unknown nested attribute or malformed/unrecognized spacing-class token | Ignored; a recognized numeric negative spacing class remains an error |

These fallbacks are part of V1 compatibility, not a mechanism for opting into
V2. The distinct V2 root prevents new V2 constructs from being silently
treated as V1 extensions.

`validate` and every render format use the same normalized values and resolved
geometry checks. Successfully validated input must not later produce `NaN`,
`Inf`, a negative drawable size, or a JSON/SVG/PPTX serialization error caused
by geometry.

### Fixed and flexible child allocation

For a vertical parent, an explicit child `height` is a fixed main-axis size;
for a horizontal parent, an explicit child `width` is fixed. The parent first
reserves fixed sizes, margins, and gaps. Children without a fixed main-axis size
divide the remaining space using their positive `row` or `col` weights. A
`<row>` uses validated `span` values against its 12-column grid.

The resolved child size is the size used both for recursive layout and for
placing the next sibling. A child cannot replace its assigned size after the
parent cursor has advanced. Explicit cross-axis sizes must fit the parent's
content box unless overflow is explicitly allowed.

Layout parents accept `overflow`:

| Value | Behavior |
|---|---|
| `error` | Default. A child outside the parent's content box is a source-positioned validation error. |
| `visible` | The child may extend outside the content box, but all coordinates and sizes must remain finite and sibling cursors still use resolved sizes. |

The policy belongs to a parent and applies only to its direct children; it is
not inherited. If fixed children consume the full main axis under `visible`,
the parent's original usable extent is used as the flex pool and the flexible
children receive their weighted sizes while all children retain source order.
Sibling cursors use each resolved size, gap, and margin, making the resulting
overflow explicit. Under the default `error` policy the same layout is
rejected.

Overflow is never silently introduced by a renderer. Clipping is a drawing and
text policy and does not make invalid layout geometry valid.

## Layout Tags

### `<container>`

Stacks children **vertically** (same behavior as `frame`). Use `layout="horizontal"` for horizontal arrangement.

```xml
<container class="pa-4" gap="16">
  ...
</container>
```

| Attribute | Type | Default | Description |
|---|---|---|---|
| `layout` | string | — | `"horizontal"` to arrange children side by side |
| `gap` | float | `16` | Gap between child elements (px) |
| `content-width` / `content-height` | float | — | Shrink usable inner layout area |
| `align` | string | — | Align usable content area |
| `overflow` | string | `error` | Child containment policy: `error` or `visible` |

### `<row>`

Lays out children **horizontally** in a 12-column grid.

```xml
<row gap="20">
  <col span="8">...</col>
  <col span="4">...</col>
</row>
```

| Attribute | Type | Default | Description |
|---|---|---|---|
| `gap` | float | `16` | Column spacing (px) |
| `overflow` | string | `error` | Child containment policy: `error` or `visible` |

> `<row>` is a **pure layout tag** — it does not render any border or label in the output.
> The `<col>` children are also pure layout containers.

An explicit child `width` is reserved before the grid share and is excluded
from `span` allocation. Among children without fixed width, an omitted `span`
defaults to `12 / number_of_flexible_children`; explicit flexible spans must
total at most `12`. Unused span leaves intentional trailing space.

### `<col>`

A vertical stack container inside `<row>`. Use `span` to set the number of columns occupied.

| Attribute | Type | Default | Description |
|---|---|---|---|
| `span` | float | `12 / num_columns` | Columns to occupy (out of 12) |
| `class` | string | — | Spacing class |
| `overflow` | string | `error` | Child containment policy: `error` or `visible` |

## Custom Leaf and Container Tags

An otherwise unknown nested tag with no layout children is a generic leaf and
is rendered as a rectangle plus text. An unknown nested tag with layout
children is a generic group/container: it receives the normal group header
insets and lays out those children vertically by default, horizontally for
`layout="horizontal"`, or with the V1 staggered layout for
`layout="staggered"`. If every child is item-like (`item`, `spacer`, or
`blank`), the children use the item-grid row behavior instead.

This rule applies only below a valid V1 root. An unknown root is always a parse
error, so `<scene version="2">` can never be mistaken for a generic V1 group.

```xml
<card title="Dashboard" />
<panel title="Main Chart" />
<text>Any label</text>
```

| Attribute | Behavior |
|---|---|
| `title` | Display label (takes priority) |
| Text content | Label when `title` is absent |
| (none) | Tag name used as label |
| `border` | Set to `"none"` to hide the border |
| `visible` | Set to `"false"` to hide only this component (border, icon, label). Children are still rendered individually. Layout space is preserved |
| `font-size` | Text font size in layout pixels |

## `<rectangle>` and `<port>` Tags

`<rectangle>` creates a general-purpose rectangle. Its label comes from
`title` or direct text content, and `font-size` controls the label size.
Unlike generic leaf tags, `<rectangle>` may contain multiple `<port>` children.

`<port>` creates a small rectangle inside a side of the parent rectangle.
Multiple ports on the same side are spaced evenly along that side. Its label
also comes from `title` or direct text content, and it supports `font-size`.

```xml
<rectangle id="service" title="Service" width="180" height="100" font-size="18">
  <port id="service-in" side="left" title="in" font-size="9" />
  <port id="service-out" side="right" title="out" font-size="10" />
</rectangle>
```

| Attribute | Target | Description |
|---|---|---|
| `id` | `rectangle`, `port` | Required connection reference ID |
| `width` / `height` | `rectangle`, `port` | Size in layout pixels |
| `title` / text content | `rectangle`, `port` | Text rendered inside the shape |
| `font-size` | `rectangle`, `port` | Text font size in layout pixels |
| `side` | `port` | Parent side: `top`, `right`, `bottom`, or `left`. Default `top` |
| `x` / `y` | `port` | Optional position relative to the parent rectangle's top-left corner. Values are clamped so the port remains inside the parent rectangle |

Port boxes must remain inside their parent rectangle. Explicit positions are
normalized before drawing, and overlapping ports on the same side are a layout
diagnostic rather than a renderer-specific accident. Port text carries the
shared text-layout policy: SVG and PPTX enforce it, while editable
Excalidraw-compatible output preserves it in metadata for bound-text consumers.

## Resolved Text Layout

Text has both a geometry box and a semantic role. Scene and plan construction
must preserve the resolved role, wrapping, fitting, clipping, line height, and
padding instead of making each encoder infer them from generated IDs.

Built-in defaults are:

| Role | Wrap | Fit | Overflow |
|---|---|---|---|
| group header | no | shrink | clip to text box |
| ordinary label | yes | shrink | clip to text box |
| item label | yes | shrink | clip to text box |
| port label | yes | shrink | clip to port box |
| connector label | yes | shrink | clip to text box |

The default line-height multiplier is `1.2` unless the source scene carries a
valid positive value. Font sizes originate in layout pixels and are converted
with the same effective scale as the containing geometry. Changing
`--px-per-inch` or paper fitting therefore preserves the text-to-shape ratio.

An encoder may use native text fitting or deterministic line breaking, but the
visible result must obey the resolved policy. Editable Excalidraw-compatible
bound text carries the same `xaligoTextLayout` metadata and must not become a
separate layout authority. Encoders apply text policy in this order: resolve
padding, wrap when enabled, shrink when requested, then clip when
`TextLayout.overflow="clip"`.

## `<item>` Tag

A leaf element that places an AWS service icon inside a container.
Specify a positive signed 32-bit decimal ID from `service-catalog.csv` as the
`id` attribute (`1` through `2147483647`).
The icon is rendered to fit within the specified size (`item-size`).

The effective item size is resolved from the root `item-size` when present;
otherwise it comes from the render context. Native configuration and the
canonical embedded-asset profile default to `32` layout pixels. Callers that
provide a custom asset source may intentionally choose another value. For
cross-environment reproducibility, declare `item-size="32"` (or another fixed
positive value) on the document root.

```xml
<public-subnet id="public-subnet" title="Public Subnet">
  <item id="1178" />   <!-- with icon -->
  <item />             <!-- spacer: no icon, only a layout slot -->
  <item id="1189" />   <!-- with icon -->
</public-subnet>
```

| Attribute | Type | Required | Description |
|---|---|---|---|
| `id` | positive int32 | — | Decimal service ID `1..2147483647` from `service-catalog.csv`. Omitted or empty → treated as spacer; zero, signs, non-decimal syntax, and out-of-range values are invalid |
| `dx` / `dy` | float | — | Relative icon offset in pixels from the icon's normal layout `x,y` position. The moved icon rectangle must remain inside the parent frame/group border |

> If no icon is found for the given `id`, rendering skips the item and emits a warning rather than failing the document.

## `<spacer>` / `<blank>` Tags

Dedicated empty layout tags, usable as alternatives to `<item />`.
They occupy layout slots but render no icon, label, border, or text.

```xml
<public-subnet id="public-subnet" title="Public Subnet">
  <item id="1178" />
  <spacer />          <!-- empty slot: no icon -->
  <blank />           <!-- empty slot: no icon -->
  <item id="1189" />
</public-subnet>
```

No attributes (`id` is ignored if specified).

## `<connection>` Tag

Draws an **elbowed arrow** between `<item>` elements or group borders.
Must be written as a direct child of `<frame>` or inside a frame-level
`<connections>` tag, **outside** layout tags.
Use the same catalog IDs as `<item id="N">`, or assign `id`, `name`, or `ref`
to an AWS/group tag, for `src` / `dst`.

```xml
<frame width="1122" height="794" class="pa-4">
  <aws-cloud id="cloud" title="AWS Cloud">
    <public-subnet id="public" title="Public Subnet">
      <item id="1178" />
      <item id="1189" />
    </public-subnet>
  </aws-cloud>

  <!-- connections go last, as direct children of frame or inside <connections> -->
  <connections grid="8">
    <connection src="1178" dst="1189" />
    <connection src="public" dst="cloud" kind="route" />
  </connections>
</frame>
```

### `<connections>` Tag

`<connections>` is an optional direct child of `<frame>` that groups
`<connection>` elements and provides shared defaults. It does not render a
shape or occupy layout space. Any per-connection attribute overrides the parent
default.

Only these non-empty group attributes are inherited:
`arrowhead-size`, `kind`, `color`, `stroke-width`, `width`, `stroke-style`,
`start-arrowhead`, `end-arrowhead`, `arrowhead`, `scale`,
`coordinate-scale`, and `grid`. Endpoint identity and geometry are deliberately
not inherited: every child must supply its own `src` and `dst`, and
`src-side`, `dst-side`, `src-anchor`, `dst-anchor`, bends, points, and via data
remain child-local. Defaults are applied to a connection snapshot during scene
construction; the parsed child node is not mutated.

`stroke-width`/`width`, `end-arrowhead`/`arrowhead`, and
`coordinate-scale`/`scale` are semantic alias pairs. If a child supplies either
name, neither name is inherited from the parent. When the child itself supplies
both, the first canonical name in each pair takes precedence.

`<connections>` may contain only `<connection>` children. A misspelled or
otherwise unknown child is a validation error rather than a silently skipped
connector.

```xml
<connections kind="traffic" color="#2563eb" grid="8" scale="1">
  <connection src="web" dst="app" />
  <connection src="app" dst="db" color="#059669" />
</connections>
```

| Attribute | Type | Required | Description |
|---|---|---|---|
| `src` | string | ✓ | Catalog ID, or `id`/`name`/`ref` of the arrow start item, AWS group, rectangle, port, or identified child frame |
| `dst` | string | ✓ | Catalog ID, or `id`/`name`/`ref` of the arrow end item, AWS group, rectangle, port, or identified child frame |
| `src-side` / `dst-side` | string | — | Optional endpoint side: `top`, `right`, `bottom`, or `left` |
| `src-anchor` / `dst-anchor` | string | — | Optional edge anchor. Each side has five inset positions (`top-1` through `top-5`, etc.) for 20 unique perimeter anchors |
| `arrowhead-size` | string | — | V1 fixed arrowhead size: `"s"` (small). This is the default; `m` and `l` are not V1 values because V1 cannot preserve them across all render formats |
| `kind` | string | — | `connection` for the normal connector, `route` for a structural path without arrows, or `traffic` for directional flow drawn beside a matching route |
| `color` | `#RRGGBB` | — | Six-digit hexadecimal stroke color override. Named, short, and alpha colors are invalid in V1 so every format preserves the same color |
| `stroke-width` / `width` | float | — | Positive stroke width override; `width` is the compatibility alias |
| `stroke-style` | string | — | `solid`, `dashed`, or `dotted` |
| `start-arrowhead` / `end-arrowhead` | string | — | Independently set either end to `none`, `arrow`, `triangle`, `stealth`, `diamond`, or `oval`. An effective `kind="route"` permits only `none` |
| `arrowhead` | string | — | Backward-compatible alias for `end-arrowhead`; an effective route permits only `none` |
| `bends` / `points` / `via` | string | — | Backward-compatible inline coordinate list. Prefer child tags for multiple bend coordinates |
| `scale` / `coordinate-scale` | float | — | Positive multiplier applied to bend coordinates before routing. Default `1` |
| `grid` | float | — | Positive per-connection snap grid in layout pixels. Defaults to the router grid |

Default connections and `kind="traffic"` use a thin 1px line with
`start-arrowhead="none"` and a slender `stealth` end arrowhead. `kind="route"`
uses `start-arrowhead="none"` and `end-arrowhead="none"` by default. Default
colors are `#1e1e1e` for normal connections, `#64748b` for routes, and
`#2563eb` for traffic. A route is always headless in V1: after applying
`<connections>` defaults and child alias overrides, any effective non-`none`
`start-arrowhead`, `end-arrowhead`, or `arrowhead` is a source-positioned
validation error. Explicit `none` is accepted. Explicit `stroke-width`, color,
and stroke style are preserved for every kind; non-route arrowhead attributes
are also preserved.

For SVG and PPTX Plan output, the render option `arrow-style` supplies the
global arrowhead (and, for `thin`/`standard`, width) only when the connection
does not explicitly set that semantic value. Explicit DSL or inherited group
values take precedence, and `kind="route"` remains headless. Excalidraw,
XYFlow, and Isoflow V1 output consume the resolved DSL scene rather than this
Plan-only option.

When a connection references endpoints in different frames, xaligo renders a
local line stub in each frame instead of drawing a single line across pages.
The source frame stub is labeled `to <frame-id>` near the frame edge, and the
destination frame stub is labeled `from <frame-id>`. Both scene stubs carry the
same logical connector ID, original endpoint/frame IDs, and V1 routing metadata.
Adapters with a single-canvas graph model, such as XYFlow and Isoflow, use
those fields to emit one logical edge instead of two partial edges.

Output formats are projections of this resolved V1 meaning. A target schema
may not have fields for every V1 connector value; the upstream-compatible
Isoflow connector schema, for example, has no arbitrary metadata field. Such
adapters must use native constructs where available and must not add private,
schema-breaking fields. A V2 compatibility frontend consumes V1 directly and
must never use an output format as an intermediate representation.

When `src-side`, `dst-side`, `src-anchor`, and `dst-anchor` are omitted,
endpoint sides and anchor positions are calculated automatically from endpoint
geometry. Use `src-anchor` and `dst-anchor` to pin an endpoint to a specific
perimeter anchor. Each side has five inset positions, giving 20 unique anchor
positions around the rectangle. Corner anchors are not shared: `top-1` sits
slightly inside the top edge near the left corner, while `left-1` sits slightly
inside the left edge near the top corner.

```text
top:    top-1    top-2    top-3    top-4    top-5
right:  right-1  right-2  right-3  right-4  right-5
bottom: bottom-1 bottom-2 bottom-3 bottom-4 bottom-5
left:   left-1   left-2   left-3   left-4   left-5
```

Position numbers run left-to-right on `top` and `bottom`, and top-to-bottom on
`left` and `right`. Anchor positions are `1` through `5` from top/left to
bottom/right on the named side, inset from corners so each side owns its five
positions.
The aliases map one-to-one as `start=1`, `near=2`, `center=3`, `far=4`, and
`end=5`.

```xml
<connection src="web" dst="app"
            src-anchor="right-3"
            dst-anchor="left-3" />
<connection src="web" dst="app"
            src-side="right" src-anchor="3"
            dst-side="left" dst-anchor="3" />
```

`src` and `dst` can also be expressed as child tags when the endpoint reference
and anchor should be declared together. The endpoint token can be tag text or
one of `id`, `ref`, `name`, or `target`.

```xml
<connection kind="traffic">
  <src anchor="right-3">web</src>
  <dst side="left" anchor="5" ref="app" />
</connection>
```

Excalidraw output always serializes arrowhead sizes as the smallest supported
size (`"s"`) to keep dense diagrams readable. The logical arrowhead type and
style metadata are still stored on the connector and used by SVG/PPTX export.

Manual bend coordinates are expressed as child tags in the same Cartesian
layout coordinate space as the frame, with the origin at the upper-left of the
rendered frame and positive `x`/`y` extending right/down. SVG and PPTX route
calculations keep the connector orthogonal while forcing the route through each
listed bend in order. Excalidraw output stores the routing metadata on the
arrow; Excalidraw's own editor may still display its editable elbow connector
approximation.

```xml
<connection src="web" dst="db"
            scale="1" grid="8">
  <bend x="120" y="80" />
  <bend x="120" y="220" />
  <bend x="300" y="220" />
</connection>
```

`<point>`, `<via>`, and `<waypoint>` are accepted aliases for `<bend>`.
Coordinates can also be grouped inside `<bends>`, `<points>`, or `<path>`.

Items and group tags may define a connection reference with `id`, `name`, or
`ref`:

```xml
<item id="1178" name="web" />
<item id="1189" name="db" />
<vpc id="prod-vpc" />
web --- db
web ==> db
prod-vpc --- web
```

- `---` expands to `kind="route"`.
- `==>` expands to `kind="traffic"`.
- Operands may also be numeric item IDs or group IDs.
- Explicit `<connection src=... dst=...>` attributes resolve the same way.
- Shorthands must be direct text children of `<frame>`.
- References must be unique and must belong to an item or group with a
  non-empty ID.
- Use an explicit `<connection>` for color, width, or stroke overrides, and for
  arrowhead overrides on normal connections or traffic flows. Routes remain
  headless.

**Arrow spec:**
- `elbowed: true` — always right-angle connectors (Excalidraw "elbow connector")
- Arrowhead at end only by default. Excalidraw stores this as
  `endArrowhead: "arrow"` plus `endArrowheadSize: "s"`; xaligo metadata records
  the logical PPTX/SVG head as `stealth`.
- Stroke color `#1e1e1e`, stroke width `1px` for normal connections
- `kind="route"` defaults to `#64748b`, `1px`, lower route layer, no arrowheads
- `kind="traffic"` defaults to `#2563eb`, `1px`, higher traffic layer, directional end arrowhead
- A traffic line with the same endpoints as a route line is drawn beside that
  route in Excalidraw, SVG, and PPTX draw paths when possible.
- Start/end connect to the **edge midpoint** of the element
  - When direction is **downward**: label text element (`{id}-item-lbl`) bottom edge
  - Otherwise: icon image element (`{id}-item`) corresponding edge
- Edges are fixed with normalized coordinates via `fixedPoint`, so arrows snap correctly when the file is opened
- Arrow ID format: `conn-{src}-{dst}-{index}`
- Arrow ID is registered in `boundElements` of the bound elements
- Excalidraw item icons and labels are grouped with a 5x5 white anchor grid.
  Anchor grid cells are drawn above connectors and below the item content so
  lines do not cover icons/labels while endpoints remain visible.
- Excalidraw routing uses previously placed lines to offset exact or near-exact
  lane overlaps. Group header tags, item icons, and labels are treated as
  routing obstacles where possible.
- SVG/PPTX routing may additionally add automatic junction markers and line
  jump masks after the Excalidraw scene is built. These are export-layer
  rendering features, not extra `.xal` tags.

**Edge selection logic:**

| Direction (dst relative to src) | Start edge | End edge |
|---|---|---|
| Right (dx ≥ dy) | right | left |
| Left | left | right |
| Down (dy > dx) | bottom (label) | top |
| Up | top | bottom (label) |

> If `src` / `dst` items are not rendered, a warning is emitted and the connection is skipped.

Connection endpoints must resolve to exactly one item, AWS group, rectangle,
port, or identified child frame. Numeric catalog IDs are valid only when that
ID appears once in the document; when the same service appears multiple times,
use unique `name` or `ref` values. Missing endpoints, ambiguous numeric IDs,
duplicate aliases, and `<connection>` tags nested below any tag other than
`<frame>` or its direct `<connections>` child are validation errors.

## AWS Group Tags

Like `container`, these stack children vertically, but are rendered with **AWS architecture diagram group border styles**.
Templates are in `etc/resources/aws/templates/excalidraw/` (`.excalidraw`) and `etc/resources/aws/templates/xal/` (`.xal`).
Icon SVGs are sourced from `etc/resources/aws/svg/Architecture-Group-Icons/`.

```xml
<aws-cloud id="production" title="Production Environment">
  <vpc id="vpc-main" title="vpc-0a1b2c3d">
    <private-subnet id="private-a" title="Private Subnet A">
      <card title="App Server" />
    </private-subnet>
  </vpc>
</aws-cloud>
```

| Tag | Display Name | Border Color | Style | Icon |
|---|---|---|---|---|
| `<aws-cloud>` | AWS Cloud | `#000000` | solid | AWS-Cloud-logo_32.svg |
| `<aws-cloud-alt>` | AWS Cloud | `#000000` | solid | AWS-Cloud_32.svg |
| `<region>` | Region | `#00A1C9` | dashed | Region_32.svg |
| `<availability-zone>` | Availability Zone | `#00A1C9` | dashed | — |
| `<security-group>` | Security group | `#CC0000` | dashed | — |
| `<auto-scaling-group>` | Auto Scaling group | `#E7601B` | dashed | Auto-Scaling-group_32.svg |
| `<vpc>` | Virtual private cloud (VPC) | `#8C4FFF` | solid | Virtual-private-cloud-VPC_32.svg |
| `<private-subnet>` | Private subnet | `#00A1C9` | solid | Private-subnet_32.svg |
| `<public-subnet>` | Public subnet | `#3F8624` | solid | Public-subnet_32.svg |
| `<server-contents>` | Server contents | `#7A7C7F` | solid | Server-contents_32.svg |
| `<corporate-data-center>` | Corporate data center | `#7A7C7F` | solid | Corporate-data-center_32.svg |
| `<ec2-instance-contents>` | EC2 instance contents | `#E7601B` | solid | EC2-instance-contents_32.svg |
| `<spot-fleet>` | Spot Fleet | `#E7601B` | solid | Spot-Fleet_32.svg |
| `<aws-account>` | AWS account | `#E7008A` | solid | AWS-Account_32.svg |
| `<aws-iot-greengrass-deployment>` | AWS IoT Greengrass Deployment | `#3F8624` | solid | AWS-IoT-Greengrass-Deployment_32.svg |
| `<aws-iot-greengrass>` | AWS IoT Greengrass | `#3F8624` | solid | — |
| `<elastic-beanstalk-container>` | Elastic Beanstalk container | `#E7601B` | solid | — |
| `<aws-step-functions-workflow>` | AWS Step Functions workflow | `#E7008A` | solid | — |
| `<generic-group>` | Generic group | `#AAB7B8` | dashed | Configurable with `icon-id` |

All AWS group tags require a non-empty `id`. IDs for group tags, `<rectangle>`,
and `<port>` must be unique among frame-like components. Group tags otherwise
accept the same attributes as `container` (`title`, `class`, `gap`, etc.).

`generic-group` additionally accepts `icon-id`, a positive signed 32-bit
decimal ID (`1..2147483647`) from `service-catalog.csv`. Zero, signs,
non-decimal syntax, and out-of-range values are invalid. It uses the same
embedded AWS, Tabler, and Yamaha icon catalog as `<item>` and renders a 32px
icon to the left of the title.
This matches the built-in group icon size. Every group header receives an
opaque mask matching its local background behind the icon and label, preventing
solid or dashed border strokes from crossing the header content.
Group header tag labels use the shared single-line text policy. The tag
background and label box use a conservative width estimate so no-wrap text
remains inside the tag in SVG and PowerPoint. Keep group tag text concise; if
changing group tag font, padding, or geometry, update the shared text-layout
policy, renderer width estimate, and regression tests together.
East Asian full-width characters, including Japanese labels, count as
double-width in group header and item label width estimates.

```xml
<generic-group id="network-topology" title="Network Topology" icon-id="104635">
  <item id="200036" />
</generic-group>
```

### Layout Control Attributes (shared by all containers)

Available on `frame` / `container` / `col`, all AWS group tags, and unknown
child-bearing container tags where noted.

| Attribute | Value | Description |
|---|---|---|
| `layout` | `"horizontal"` | Arrange children **horizontally** with proportional widths (use the `col` attribute for ratio) |
| `layout` | `"staggered"` | Stack children with a depth offset (AWS group tags and unknown child-bearing containers) |
| `gap` | float | Child spacing (px). Default `16` |
| `align` | `"{vertical}-{horizontal}"` | Position of content area and `<item>` icons. Item grids also support `spread`. Default item-grid alignment is `"middle-center"` |
| `content-width` / `content-height` | float | Shrink usable inner layout area, leaving whitespace |
| `width` / `height` | float | Fixed child size (root frame dimensions remain the paper/content frame) |
| `overflow` | `"error"` \| `"visible"` | Child containment policy. Default `error` |

**`align` values** — combine a vertical part and a horizontal part with `-`:

| Part | Values |
|---|---|
| vertical | `top` \| `middle` \| `bottom` |
| horizontal | `left` \| `center` \| `right` \| `spread` |

All 12 combinations are valid: `top-left`, `top-center`, `top-right`, `top-spread`, `middle-left`, `middle-center`, `middle-right`, `middle-spread`, `bottom-left`, `bottom-center`, `bottom-right`, `bottom-spread`.

> **`center` (default):** icons are packed together and the group is centred within the available area
> (equivalent to CSS `justify-content: center`).
>
> **`spread`:** icons are distributed with equal gaps between each icon and the container edges
> (equivalent to CSS `justify-content: space-evenly`).
>
> **`left` / `right`:** icons are packed at the respective edge with a fixed `8 px` gap between icons.

```xml
<!-- Icons centred vertically and horizontally inside the group (default) -->
<private-subnet id="app-tier" title="App Tier" align="middle-center">
  <item id="27" />
  <item id="547" />
</private-subnet>

<!-- Icons spread evenly across the full width -->
<generic-group id="global-services" title="Global Services" align="middle-spread">
  <item id="1179" />
  <item id="1178" />
  <item id="216" />
  <item id="227" />
</generic-group>

<!-- Icons pinned to the top-left -->
<generic-group id="security-services" title="Security" align="top-left">
  <item id="216" />
  <item id="227" />
</generic-group>
```

### Child Size Ratio Attributes

| Attribute | Direction | Description |
|---|---|---|
| `row` | Vertical (`layoutStack`) | **Height ratio** among children without explicit `height`. Default `1.0` |
| `col` | Horizontal (`layout="horizontal"`) | **Width ratio** among children without explicit `width`. Default `1.0` |

```xml
<!-- Horizontal: left 2 : right 1 width ratio -->
<vpc id="vpc-main" title="VPC" layout="horizontal">
  <public-subnet id="public-subnet" title="Public" col="2" />
  <private-subnet id="private-subnet" title="Private" col="1" />
</vpc>

<!-- Vertical: top 1 : bottom 2 height ratio -->
<region id="region-main" title="Region">
  <vpc id="vpc-a" title="VPC A" row="1" />
  <vpc id="vpc-b" title="VPC B" row="2" />
</region>
```

## Spacing Classes (`class` attribute)

Vuetify-style notation. **Unit: `spacingUnit = 8px`**.

### All-sides shorthand

| Class | Meaning |
|---|---|
| `pa-{n}` | padding all sides = n × 8px |
| `ma-{n}` | margin all sides = n × 8px |

### Axis shorthand

| Class | Meaning |
|---|---|
| `px-{n}` | padding left + right = n × 8px |
| `py-{n}` | padding top + bottom = n × 8px |
| `mx-{n}` | margin left + right = n × 8px |
| `my-{n}` | margin top + bottom = n × 8px |

### Per-side

| Class | Meaning |
|---|---|
| `pt-{n}` | padding-top |
| `pr-{n}` | padding-right |
| `pb-{n}` | padding-bottom |
| `pl-{n}` | padding-left |
| `mt-{n}` | margin-top |
| `mr-{n}` | margin-right |
| `mb-{n}` | margin-bottom |
| `ml-{n}` | margin-left |

Multiple classes are space-separated: `class="pa-4 mt-2"`

### Semantics

| Kind | Target tag | Behavior |
|---|---|---|
| `padding` | frame / container / col | Inner whitespace. Child layout starts `pad` pixels inward |
| `padding` | AWS group tags / unknown containers | **Added to** `defaultGroupTopInset(44)` / `defaultGroupSideInset(12)`. `pa-2` adds +16px below the header |
| `margin` | any child element | Read by the parent layout (`layoutStack` / `layoutRow`) and used as inter-sibling spacing (equivalent to CSS flex margin) |

## Layout Calculation Rules

1. Normalize and validate numeric attributes and enum values.
2. Resolve each parent's border box and content box after margin and padding.
3. `frame` / `container` / `col` → **vertical stack**: reserve fixed child
   heights, gaps, and margins, then divide the remainder by `row` weights.
4. `layout="horizontal"` → reserve fixed child widths, gaps, and margins, then
   divide the remainder by `col` weights.
5. `row` → **12-column grid** after validating each `span` and their total.
6. Leaf elements use the resolved `(x, y, w, h)` received from their parent;
   they do not replace the allocation after sibling placement.
7. Verify finite positive geometry and parent-content containment before scene
   construction. Respect only an explicit `overflow="visible"` exception.
8. Resolve item grids against the same occupied content area before encoding.

## Example

```xml
<frame width="1440" height="900" class="pa-4">
  <container class="pa-4">
    <row gap="20" class="mb-2">
      <col span="8" class="pa-2">
        <card title="Dashboard" />
      </col>
      <col span="4" class="pa-2">
        <card title="Summary" />
      </col>
    </row>

    <row gap="20">
      <col span="4" class="pa-2">
        <panel title="Filters" />
      </col>
      <col span="8" class="pa-2">
        <panel title="Main Chart" />
      </col>
    </row>
  </container>
</frame>
```

## Constraints and Notes

- The root tag must be `<frame>` or `<frames>`. Any other root tag causes a
  V1 parse error; direct children of `<frames>` must be identified `<frame>`
  tags. V2 uses `<scene version="2">`, which is intentionally rejected by V1.
- Both self-closing (`<card title="..." />`) and regular (`<card title="..."></card>`) forms are supported.
- The sum of `span` values in direct children of `<row>` must not exceed 12.
  Excess is a validation error rather than implicit overflow to the right.
- `.xal` files must be saved in UTF-8.
