# Publishing

## Prerequisites

- A Visual Studio Marketplace publisher named `ryo-arima`.
- A Personal Access Token with Marketplace publishing permission.
- The extension version in `package.json` updated for the release.
- A repository secret named `VSCE_PAT` containing the Marketplace token.

## Checks

```bash
npm install
npm run typecheck
npm run package
```

Inspect the generated `.vsix` file list in the `vsce package` output before publishing.

## Publish with GitHub Actions

The `.github/workflows/publish.yml` workflow publishes the extension to the
Visual Studio Marketplace.

To publish a release from a tag:

```bash
git tag v0.0.1
git push origin v0.0.1
```

You can also run **Publish VS Code Extension** manually from the GitHub Actions
tab.

The workflow:

1. Installs dependencies with `npm ci`.
2. Runs `npm run typecheck`.
3. Builds a VSIX with `npm run package -- --out xaligo-vscode-extension.vsix`.
4. Uploads the VSIX as a workflow artifact.
5. Publishes the VSIX with `npx vsce publish --packagePath ...`.

## Publish locally

```bash
npx vsce login ryo-arima
npx vsce publish
```

To publish the already-built VSIX:

```bash
npx vsce publish --packagePath xaligo-vscode-extension-0.0.1.vsix
```
