---
applyTo: "**/*.xal"
---

# xaligo DSL (.xal) Specification

## Overview

`.xal` is a Vue-style layout DSL with XML syntax.
The root tag must always be `<frame>`.
The parser uses `encoding/xml` and handles attributes, nested tags, and text content.

## Root Tag

```xml
<frame width="1440" height="900" class="pa-4">
  ...
</frame>
```

| Attribute | Type | Default | Description |
|---|---|---|---|
| `width` | float | `1280` | Frame width (px) |
| `height` | float | `720` | Frame height (px) |
| `class` | string | — | Spacing class |
| `layout` | string | — | Set to `"horizontal"` to arrange children horizontally |
| `gap` | float | `16` | Gap between child elements (px) |
| `item-size` | float | `32` (config value) | Max icon size (px) applied to all `<item>` elements in this file. Overrides `item.icon_size` in `app.yaml` |
| `margin` / `margin-*` | float | — | DSL content whitespace in pixels. On root `<frame>`, paper-frame size is preserved and content is inset. This is separate from PPTX CLI `--paper-margin*` flags, which are inch-based export fitting margins |
| `content-width` / `content-height` | float | — | Shrink usable inner layout area |
| `align` | string | — | Align usable content area (`top|middle|bottom` + `left|center|right`) |

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

> `<row>` is a **pure layout tag** — it does not render any border or label in the output.
> The `<col>` children are also pure layout containers.

### `<col>`

A vertical stack container inside `<row>`. Use `span` to set the number of columns occupied.

| Attribute | Type | Default | Description |
|---|---|---|---|
| `span` | float | `12 / num_columns` | Columns to occupy (out of 12) |
| `class` | string | — | Spacing class |

## Leaf Tags

Any tag other than `frame` / `container` / `row` / `col` / AWS group tags / `item` is treated as a leaf element.
Rendered as a `rectangle + text` pair in Excalidraw.

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

## `<item>` Tag

A leaf element that places an AWS service icon inside a container.
Specify the numeric ID from `service-catalog.csv` as the `id` attribute.
The icon is rendered to fit within the specified size (`item-size`).

```xml
<public-subnet title="Public Subnet">
  <item id="1178" />   <!-- with icon -->
  <item />             <!-- spacer: no icon, only a layout slot -->
  <item id="1189" />   <!-- with icon -->
</public-subnet>
```

| Attribute | Type | Required | Description |
|---|---|---|---|
| `id` | int | — | Service ID from `service-catalog.csv`. Omitted or empty → treated as spacer |

> If no icon is found for the given `id`, rendering is silently skipped (no error).

## `<spacer>` / `<blank>` Tags

Dedicated empty layout tags, usable as alternatives to `<item />`.
They occupy layout slots but render no icon, label, border, or text.

```xml
<public-subnet title="Public Subnet">
  <item id="1178" />
  <spacer />          <!-- empty slot: no icon -->
  <blank />           <!-- empty slot: no icon -->
  <item id="1189" />
</public-subnet>
```

No attributes (`id` is ignored if specified).

## `<connection>` Tag

Draws an **elbowed arrow** between `<item>` elements.
Must be written as a direct child of `<frame>`, **outside** layout tags.
Use the same catalog IDs as `<item id="N">` for `src` / `dst`.

```xml
<frame width="1122" height="794" class="pa-4">
  <aws-cloud title="AWS Cloud">
    <public-subnet title="Public Subnet">
      <item id="1178" />
      <item id="1189" />
    </public-subnet>
  </aws-cloud>

  <!-- connections go last, as direct children of frame -->
  <connection src="1178" dst="1189" />
</frame>
```

| Attribute | Type | Required | Description |
|---|---|---|---|
| `src` | int | ✓ | Catalog ID of the arrow start icon |
| `dst` | int | ✓ | Catalog ID of the arrow end icon |
| `arrowhead-size` | string | — | Arrowhead size: `"s"` (small) / `"m"` (medium) / `"l"` (large). Default `"s"` |
| `kind` | string | — | `route` for a structural path with circular endpoints, `traffic` for directional flow |
| `color` | string | — | Stroke color override |
| `stroke-width` | float | — | Positive stroke width override |
| `stroke-style` | string | — | `solid`, `dashed`, or `dotted` |
| `start-arrowhead` / `end-arrowhead` | string | — | Independently set either end to `none`, `arrow`, `triangle`, `stealth`, `diamond`, or `oval` |
| `arrowhead` | string | — | Backward-compatible alias for `end-arrowhead` |

Default connections, `kind="route"`, and `kind="traffic"` all use a thin 1px
line with `start-arrowhead="none"` and a slender `stealth` end arrowhead.
Default colors are `#1e1e1e` for normal connections, `#64748b` for routes, and
`#2563eb` for traffic. Explicit `stroke-width`, color, stroke style, and
arrowhead attributes are preserved.

Items may define a connection reference with `name` or `ref`:

```xml
<item id="1178" name="web" />
<item id="1189" name="db" />
web --- db
web ==> db
```

- `---` expands to `kind="route"`.
- `==>` expands to `kind="traffic"`.
- Operands may also be numeric item IDs.
- Shorthands must be direct text children of `<frame>`.
- References must be unique and must belong to an item with a non-empty ID.
- Use an explicit `<connection>` for color, width, stroke, or arrowhead overrides.

**Arrow spec:**
- `elbowed: true` — always right-angle connectors (Excalidraw "elbow connector")
- Arrowhead at end only by default. Excalidraw stores this as
  `endArrowhead: "arrow"` plus `endArrowheadSize: "s"`; xaligo metadata records
  the logical PPTX/SVG head as `stealth`.
- Stroke color `#1e1e1e`, stroke width `1px` for normal connections
- `kind="route"` defaults to `#64748b`, `1px`, lower route layer
- `kind="traffic"` defaults to `#2563eb`, `1px`, higher traffic layer
- Start/end connect to the **edge midpoint** of the element
  - When direction is **downward**: label text element (`{id}-item-lbl`) bottom edge
  - Otherwise: icon image element (`{id}-item`) corresponding edge
- Edges are fixed with normalized coordinates via `fixedPoint`, so arrows snap correctly when the file is opened
- Arrow ID format: `conn-{src}-{dst}-{index}`
- Arrow ID is registered in `boundElements` of the bound elements
- SVG/PPTX routing may add lane offsets, automatic junction markers, and line
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

## AWS Group Tags

Like `container`, these stack children vertically, but are rendered with **AWS architecture diagram group border styles**.
Templates are in `etc/resources/aws/templates/excalidraw/` (`.excalidraw`) and `etc/resources/aws/templates/xal/` (`.xal`).
Icon SVGs are sourced from `etc/resources/aws/svg/Architecture-Group-Icons/`.

```xml
<aws-cloud title="Production Environment">
  <vpc title="vpc-0a1b2c3d">
    <private-subnet title="Private Subnet A">
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

Attributes are the same as `container` (`title`, `class`, `gap`, etc.).

`generic-group` additionally accepts `icon-id`, a positive ID from
`service-catalog.csv`. It uses the same embedded AWS, Tabler, and Yamaha icon
catalog as `<item>` and renders a 32px icon to the left of the title.
This matches the built-in group icon size. Every group header receives an
opaque mask matching its local background behind the icon and label, preventing
solid or dashed border strokes from crossing the header content.
In PPTX output, group header tag labels are intentionally kept on a single line.
The tag background and label box use a conservative width estimate so PowerPoint
no-wrap text remains inside the tag. Keep group tag text concise; if changing
group tag font, padding, or geometry, update the renderer width estimate and
regression tests together.

```xml
<generic-group title="Network Topology" icon-id="104635">
  <item id="200036" />
</generic-group>
```

### Layout Control Attributes (shared by all containers)

Available on `frame` / `container` / `col` and all AWS group tags.

| Attribute | Value | Description |
|---|---|---|
| `layout` | `"horizontal"` | Arrange children **horizontally** with proportional widths (use the `col` attribute for ratio) |
| `layout` | `"staggered"` | Stack children with a depth offset (AWS group tags only) |
| `gap` | float | Child spacing (px). Default `16` |
| `align` | `"{vertical}-{horizontal}"` | Position of content area and `<item>` icons. Item grids also support `spread`. Default item-grid alignment is `"middle-center"` |
| `content-width` / `content-height` | float | Shrink usable inner layout area, leaving whitespace |
| `width` / `height` | float | Fixed child size (root frame dimensions remain the paper/content frame) |

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
<private-subnet title="App Tier" align="middle-center">
  <item id="27" />
  <item id="547" />
</private-subnet>

<!-- Icons spread evenly across the full width -->
<generic-group title="Global Services" align="middle-spread">
  <item id="1179" />
  <item id="1178" />
  <item id="216" />
  <item id="227" />
</generic-group>

<!-- Icons pinned to the top-left -->
<generic-group title="Security" align="top-left">
  <item id="216" />
  <item id="227" />
</generic-group>
```

### Child Size Ratio Attributes

| Attribute | Direction | Description |
|---|---|---|
| `row` | Vertical (`layoutStack`) | **Height ratio** of the child element (flex-grow equivalent). Default `1.0` (equal) |
| `col` | Horizontal (`layout="horizontal"`) | **Width ratio** of the child element (flex-grow equivalent). Default `1.0` (equal) |

```xml
<!-- Horizontal: left 2 : right 1 width ratio -->
<vpc title="VPC" layout="horizontal">
  <public-subnet title="Public" col="2" />
  <private-subnet title="Private" col="1" />
</vpc>

<!-- Vertical: top 1 : bottom 2 height ratio -->
<region title="Region">
  <vpc title="VPC A" row="1" />
  <vpc title="VPC B" row="2" />
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

1. `frame` / `container` / `col` → **vertical stack** (height divided equally after subtracting `gap`)
2. `row` → **12-column grid** (`span` determines each column's width)
3. Leaf elements → use `(x, y, w, h)` received from parent as-is
4. `margin` affects an element's own position and size; `padding` affects where children start

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

- The root tag must be `<frame>`. Any other root tag causes a parse error.
- Both self-closing (`<card title="..." />`) and regular (`<card title="..."></card>`) forms are supported.
- The sum of `span` values in direct children of `<row>` should not exceed 12 (excess overflows to the right).
- `.xal` files must be saved in UTF-8.
