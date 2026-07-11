# xaligo

VS Code language support, interactive SVG preview, and structural diff for the
xaligo `.xal` diagram DSL.

![xaligo logo](images/xaligo-readme-logo.png)

## Features

- Registers `.xal` files as the `xal` language.
- Adds an original-color file icon generated from SVG for `.xal` files, with a bundled file icon theme for themes that override language icons.
- Provides syntax highlighting for xaligo tags, attributes, strings, comments, XML entities, spacing classes, and connection shorthands.
- Colors common xaligo and AWS group tags in the editor for faster scanning.
- Adds comment, bracket, auto-closing, folding, and indentation behavior for `.xal` files.
- Opens an SVG preview with a Preview / Diff menu bar.
- Zooms around the pointer with Ctrl/Cmd + wheel and pans by dragging the canvas.
- Compares two `.xal` files structurally and displays removed and added diagrams
  side by side with pale red and pale green highlights.
- Refreshes the preview when the source file is saved.
- Exports `.xal` diagrams to SVG, PPTX, and Excalidraw files.
- Uses `<name>.services.csv` or the nearest `services.csv` for preview labels and legends when present.

## Preview

Open a `.xal` file, then run **xaligo: Open Preview** from the command palette or the editor title/context menu.

Use Ctrl/Cmd + wheel over the diagram to zoom around the pointer. Drag the
canvas with the primary mouse button, or focus it and use the arrow keys, to
move it. The menu bar also provides
zoom, 100%, Fit, Refresh, and Close controls. View position is retained when a
file is rendered again.

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

To export the current `.xal` file, run **xaligo: Export as SVG**, **xaligo: Export as PPTX**, or **xaligo: Export as Excalidraw** from the command palette or editor menu, then choose the output file path.

If the `.xal` icon does not appear with your current file icon theme, run **xaligo: Select File Icon Theme** or **Preferences: File Icon Theme**, then select **xaligo**.

The native renderer is bundled in the VSIX; activation does not download or
install a renderer. Structural diff requires xaligo 0.1.21 or newer. If the
bundled renderer predates that capability, the preview shows an actionable
error. During core development, set `xaligo.executablePath` to an absolute path
for a compatible native xaligo CLI.

## Example

```xml
<frame version="1" width="1440" height="900" class="pa-4">
  <aws-cloud id="production" title="Production">
    <region id="region-ap-northeast-1" title="ap-northeast-1">
      <vpc id="application-vpc" title="Application VPC" layout="horizontal">
        <public-subnet id="public" title="Public">
          <item id="1178" name="edge" />
        </public-subnet>
        <private-subnet id="private" title="Private">
          <item id="1189" name="app" />
        </private-subnet>
      </vpc>
    </region>
  </aws-cloud>

  edge ==> app
</frame>
```

## Requirements

- VS Code 1.90.0 or newer.
- A trusted workspace before invoking the bundled native renderer.
- xaligo 0.1.21 or newer for structural diff.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

Open this folder in VS Code, press `F5`, and open `examples/sample.xal` in the extension development host.

For iterative work:

```bash
npm run watch
npm run watch:webview
```

Run the two watch commands in separate terminals when changing both extension
host and WebView code.

Before publishing:

```bash
npm run typecheck
npm run package
```
