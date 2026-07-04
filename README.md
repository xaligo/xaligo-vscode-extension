# xaligo

VS Code language support and SVG preview for the xaligo `.xal` diagram DSL.

![xaligo logo](images/xaligo-readme-logo.png)

## Features

- Registers `.xal` files as the `xal` language.
- Adds an original-color file icon generated from SVG for `.xal` files, with a bundled file icon theme for themes that override language icons.
- Provides syntax highlighting for xaligo tags, attributes, strings, comments, XML entities, spacing classes, and connection shorthands.
- Colors common xaligo and AWS group tags in the editor for faster scanning.
- Adds comment, bracket, auto-closing, folding, and indentation behavior for `.xal` files.
- Opens an SVG preview with zoom, fit-width, reset, and close controls.
- Refreshes the preview when the source file is saved.
- Uses `<name>.services.csv` or the nearest `services.csv` for preview labels and legends when present.

## Usage

Open a `.xal` file, then run **xaligo: Open Preview** from the command palette or the editor title/context menu.

If the `.xal` icon does not appear with your current file icon theme, run **xaligo: Select File Icon Theme** or **Preferences: File Icon Theme**, then select **xaligo**.

The extension installs the `@xaligo/xaligo` renderer into VS Code global storage on first activation. Internet access is required for that first install.

## Example

```xml
<frame width="1440" height="900" class="pa-4">
  <aws-cloud title="Production">
    <region title="ap-northeast-1">
      <vpc title="Application VPC" layout="horizontal">
        <public-subnet title="Public">
          <item id="1178" name="edge" />
        </public-subnet>
        <private-subnet title="Private">
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
- Network access during the first activation so the renderer package can be installed.

## Development

```bash
npm install
npm run build
```

Open this folder in VS Code, press `F5`, and open `examples/sample.xal` in the extension development host.

For iterative work:

```bash
npm run watch
```

Before publishing:

```bash
npm run typecheck
npm run package
```
