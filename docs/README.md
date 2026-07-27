# xaligo Offline Documentation

This folder ships inside the `xaligo` VS Code extension package so that its
reference material is available **offline**, without cloning the xaligo core
repository or having network access. Point any AI assistant (GitHub Copilot,
Claude, ChatGPT, Cursor, etc.) at these files when asking it to write, review,
or explain `.xal` diagrams — for example:

> "Read `docs/xal-spec.md` in this extension's install folder, then write a
> 3-tier AWS `.xal` diagram with a public ALB, private EC2 tier, and RDS."

## Contents

- [xal-spec.md](xal-spec.md) — the `.xal` DSL language specification: root
  tags, layout primitives, AWS group tags, `<item>`/`<connection>` syntax,
  spacing classes, and validation rules.
- [diagram-creation.md](diagram-creation.md) — a step-by-step workflow for
  authoring an AWS architecture diagram: finding service IDs, building
  `services.csv`, writing the `.xal` file, and rendering it.

## Where these files live once installed

VS Code installs each extension into a versioned folder under your user
profile, for example:

- macOS/Linux: `~/.vscode/extensions/xaligo.xaligo-<version>/docs/`
- Windows: `%USERPROFILE%\.vscode\extensions\xaligo.xaligo-<version>\docs\`

Use the **Extensions** view (`Ctrl/Cmd+Shift+X`), find "xaligo", and open its
"Extension Location" from the gear menu to locate the exact path on your
machine, or ask your AI assistant to search your installed extensions folder
for `xaligo.xaligo-*/docs/xal-spec.md`.

## Scope and freshness

These docs describe the `.xal` DSL and CLI behavior implemented by the
`@xaligo/xaligo` npm package bundled with this extension (see this package's
own `package.json` for the exact pinned version). File paths mentioned inside
them (e.g. `etc/resources/aws/...`) refer to the xaligo core repository and
its published package, not to files inside this VS Code extension. If you also
have the [xaligo core repository](https://github.com/xaligo/xaligo) checked
out, its `docs/src/**` and `.github/instructions/*.instructions.md` are the
actively maintained originals and take precedence over these bundled copies.
