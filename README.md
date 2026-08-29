# xaligo

VS Code language-server support, interactive SVG preview, and structural diff
for the xaligo `.xal` diagram DSL.

The extension exposes direct SVG, PPTX, and rendered-Markdown exports,
validation, runtime-version commands, and automatic language-server support.

![xaligo logo](images/xaligo-readme-logo.png)

## Features

- Registers `.xal` files as the `xal` language.
- Registers an original-color language icon for `.xal` files without replacing
  the user's active file icon theme.
- Provides syntax highlighting for xaligo tags, attributes, strings, comments, XML entities, spacing classes, and connection shorthands.
- Starts the bundled xaligo Language Server Protocol 3.18 server for
  diagnostics, symbols, semantic tokens, completion, hover, definitions, and
  references while editing saved or untitled `.xal` documents. Typing `<`
  opens LSP-backed tag suggestions, including V1, AWS, data, and UML tags.
- Colors common xaligo and AWS group tags in the editor for faster scanning.
- Adds comment, bracket, auto-closing, folding, and indentation behavior for `.xal` files.
- Opens an SVG preview with a grouped, icon-first Preview / Diff menu panel.
- Renders Markdown with the MIT-licensed Vue Markdown renderer and keeps
  CLI-generated xaligo SVG diagrams as vector images. Relative local images,
  HTTPS images, and local or external links remain usable in the webview.
- Zooms around the pointer with Ctrl/Cmd + wheel and pans by dragging the canvas.
- Compares two `.xal` files structurally and displays removed and added diagrams
  side by side with pale red and pale green highlights.
- Refreshes the preview when the source file is saved.
- Exports `.xal` diagrams to SVG or PPTX.
- Uses `<name>.services.csv` or the nearest `services.csv` for preview labels and legends when present.
- Updates the xaligo runtime and the VS Code extension independently from the command palette.
- Ships an offline copy of the `.xal` DSL spec and diagram-authoring guide
  under `docs/`, so an AI assistant can read them without network access.

## Preview

Open a `.xal`, `.md`, or `.markdown` file, then run **xaligo: Open Preview**
from the command palette or select the xaligo icon in the editor title.
For `.xal` files, the same command is also available from the editor context
menu. Both diagram and Markdown previews open in the same xaligo Preview panel
beside the source editor.

Use Ctrl/Cmd + wheel over the diagram to zoom around the pointer. Drag the
canvas with the primary mouse button, or focus it and use the arrow keys, to
move it. Zoom controls remain on the canvas; the menu panel provides Preview,
Diff, Fit, and Refresh controls. View position and manually arranged
frame-card positions are retained when a file is rendered again.

The menu is a one-button-wide vertical panel with **View** and **Output** tabs.
The display tab contains diagram, Markdown, and diff previews. For a diagram,
the output tab shows SVG and PPTX actions; it shows Markdown conversion only
for Markdown and no misleading export target for structural diff. Hover or
keyboard-focus any icon button to see its name. Validation and runtime
management remain available from the command palette. Markdown preview defaults
to A4 portrait.
Use the **Markdown** controls in the display tab to select another paper size
or automatic, portrait, or landscape orientation. These controls size the
Markdown page itself; embedded SVG dimensions do not determine the page size.
Markdown mode always occupies the full preview viewport and does not use the
draggable diagram-card canvas.

Preview loads every frame SVG emitted by the CLI and lays the frames out
together on one interactive canvas. Connections whose endpoints belong to
different frames remain visible as paired `to <frame>` / `from <frame>`
page-link stubs and as connector lines between the frame cards. Drag a card
header to arrange frames independently, or use the button in a card header to
fit that frame to the preview window.

## Structural diff

Run **xaligo: Open Structural Diff**, or select **Diff** in the preview menu.
Choose the files separately as **Before** and **After**; their order determines
the meaning of the result.

- **Removed · Before** shows deleted and previous modified elements in pale red.
- **Added · After** shows added and new modified elements in pale green.

This is a structural `.xal` comparison performed by the xaligo core, not a
line-oriented text diff. Saving either selected file refreshes the comparison.
The current core diff command does not accept `services.csv`, so service-label
overrides used by the normal preview are not applied to diff images.

To export the current `.xal` file, run **xaligo: Export as SVG** or
**xaligo: Export as PPTX** from the command palette or editor menu, then choose
the output path.

The native renderer is bundled in the VSIX, so activation does not require a
download. Native binaries are included for macOS, Linux, and Windows on x64
and arm64. This release bundles
[xaligo 0.2.1](https://github.com/xaligo/xaligo/releases/tag/v0.2.1).
During core development, set `xaligo.executablePath` to an absolute path for a
compatible native xaligo CLI; LSP support requires `0.2.1` or newer. A custom
CLI runs with its own resource discovery, and the extension does not force it
to use resources from the bundled package.

Renderer commands default to a 120-second timeout and can be cancelled from
progress notifications. Set `xaligo.commandTimeoutSeconds` higher for very
large documents or hosts where Windows security scanning delays a new binary.

## Updates

Run **xaligo: Manage Updates** from the command palette. Runtime and extension
updates are separate operations:

- **Update xaligo Runtime** checks release metadata, verifies the package and
  platform binary digests, verifies every required catalog and SVG resource,
  and runs validation plus SVG, PPTX, structural-diff, and LSP smoke tests
  before activating it. A failed update leaves the active runtime unchanged.
- **Update xaligo Extension** delegates installation to VS Code's extension
  update mechanism and offers to reload the window afterward.

Runtime updates are explicit and are stored in VS Code global storage. At
render time the extension chooses the newer healthy managed or bundled runtime;
an absolute `xaligo.executablePath` remains the highest-priority override. If
npm's latest package maps to a prerelease build, the extension asks for
confirmation before installing it.

## Example

```xml
<xaligo version="1">
  <frames gap="48">
    <frame id="overview" title="Production" version="1.0.0"
           width="1440" height="900" class="pa-4">
      <metadata>
        <entry key="owner" value="Platform Engineering" />
        <entry key="status" value="Approved" />
      </metadata>
      <aws-cloud id="production" title="Production">
        <region id="region-ap-northeast-1" title="ap-northeast-1">
          <vpc id="application-vpc" title="Application VPC">
            <generic-group id="vpc-edge" title="VPC Edge">
              <item id="1182" name="edge" />  <!-- Elastic Load Balancing -->
            </generic-group>
            <availability-zone id="az-a" title="AZ: ap-northeast-1a" layout="horizontal">
              <private-subnet id="app-tier" title="App Tier">
                <item id="27" name="app" />   <!-- Amazon EC2 -->
              </private-subnet>
              <private-subnet id="data-tier" title="Data Tier">
                <item id="117" name="db" />   <!-- Amazon RDS -->
              </private-subnet>
            </availability-zone>
          </vpc>
        </region>
      </aws-cloud>

      edge ==> app
      app ==> db
    </frame>
  </frames>
</xaligo>
```

`<xaligo version="1">` is the canonical document root; it wraps document-wide
`<data>` (omitted here) and exactly one `<frames>` page collection. The
`<metadata>` block renders `id`/`title`/`version` plus each `<entry>` as a tag
band on the page. See [docs/diagram-creation.md](docs/diagram-creation.md) for
the full service-scope guidance behind this layout (why the load balancer sits
at VPC level while EC2/RDS sit inside an availability zone) and
[docs/xal-spec.md](docs/xal-spec.md) for every tag and attribute.

Native V2 uses a distinct `<scene version="2">` root:

```xml
<scene version="2" width="320" height="180" layout="horizontal">
  <item id="client">Client</item>
  <item id="api">API</item>
  <line source="client" target="api" target-arrow="arrow" />
</scene>
```

## Documentation for AI assistants

This extension ships an offline copy of the `.xal` DSL reference under
[docs/](docs/README.md) — [docs/xal-spec.md](docs/xal-spec.md) (language
specification) and [docs/diagram-creation.md](docs/diagram-creation.md)
(step-by-step AWS diagram authoring guide). These files install alongside the
extension, so any AI assistant (GitHub Copilot, Claude, ChatGPT, Cursor, etc.)
can read them for offline `.xal` guidance without cloning the xaligo core
repository or needing network access. See [docs/README.md](docs/README.md)
for how to locate them once installed and an example prompt.

## Requirements

- VS Code 1.91.0 or newer.
- A trusted workspace before invoking the bundled native renderer.
- Network access only when an update is explicitly requested.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

Open this folder in VS Code, press `F5`, and open `examples/sample.xal` in the extension development host. `F5` runs `.vscode/launch.json`'s "Run Extension"
configuration, which builds the extension first and launches the Extension
Development Host.

For iterative work:

```bash
npm run watch
npm run watch:webview
```

Run the two watch commands in separate terminals when changing both extension
host and WebView code.

### Debugging and a local native CLI

The "xaligo" output channel (Output panel dropdown, or run **xaligo: Show
Output Channel**) logs the resolved runtime (bundled, managed, or custom) and
every native CLI invocation, including failures. Use **Developer: Set Log
Level...** and pick "xaligo" to see `Debug`/`Trace` level detail such as the
exact command line for each render.

`.vscode/launch.json`'s "Run Extension" configuration sets the
`XALIGO_CLI_PATH` environment variable to `../xaligo/.bin/xaligo`, so `F5`
exercises a locally built native CLI from a sibling checkout of the
[xaligo](https://github.com/xaligo/xaligo) repository (`make build` there)
instead of the bundled or managed runtime. `XALIGO_CLI_PATH` takes priority
over the `xaligo.executablePath` setting; clear it in `launch.json`, or edit
the path, to use a different runtime while debugging.

Before publishing:

```bash
npm run typecheck
npm run package
```
