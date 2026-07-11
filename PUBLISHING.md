# Publishing

## Prerequisites

- A Visual Studio Marketplace publisher named `xaligo`.
- A Personal Access Token with Marketplace publishing permission.
- The extension version in `package.json` updated for the release.
- A repository secret named `VSCE_PAT` containing the Marketplace token.

## Checks

```bash
npm install
npm run typecheck
npm test
npm run check:renderer
npm run package
```

Inspect the generated `.vsix` file list in the `vsce package` output before publishing.
Packaging may download the native binaries for all supported VSIX targets, so
network access is required at build time. Extension activation does not require
a renderer download.

Before publishing a diff-enabled extension, confirm that
`@xaligo/xaligo@0.1.21` or newer and its six native release assets are
available, update `package.json` and `package-lock.json`, and verify that the
bundled host binary accepts `xaligo diff --help`.

The `.github/workflows/ci.yml` workflow runs the same typecheck and VSIX
packaging checks on pull requests targeting `main`.

## Publish with GitHub Actions

The `.github/workflows/publish.yml` workflow publishes the extension to the
Visual Studio Marketplace on pushes to `main`.

To publish a release:

```bash
git push origin main
```

You can also run **Publish VS Code Extension** manually from the GitHub Actions
tab.

The workflow:

1. Installs dependencies with `npm ci`.
2. Runs `npm run typecheck`, `npm test`, and `npm run check:renderer`.
3. Builds a VSIX with `npm run package -- --out xaligo-vscode-extension.vsix`.
4. Uploads the VSIX as a workflow artifact.
5. Publishes the VSIX with `npx vsce publish --packagePath ...`.

## Publish locally

```bash
npx vsce login xaligo
npx vsce publish
```

To publish the already-built VSIX:

```bash
npx vsce publish --packagePath xaligo-vscode-extension-0.0.2.vsix
```
