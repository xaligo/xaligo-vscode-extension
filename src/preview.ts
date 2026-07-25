import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { readRenderedMarkdownPreview } from "./markdown-preview";
import type {
  CliFeature,
  MarkdownPreviewSettings,
  PreviewHostMessage,
  PreviewMode,
  PreviewPanelState,
  PreviewWebviewMessage
} from "./preview-contract";
import {
  cliFeatures,
  defaultMarkdownPreviewSettings,
  parseMarkdownPreviewSettings
} from "./preview-contract";
import { readPreviewArtifacts } from "./preview-artifacts";
import { XaligoRenderer } from "./xaligo";
import {
  createTemporaryOutputDirectory,
  isMarkdownFilePath
} from "./xaligo-command";

type DiffSide = "before" | "after";

export class XaligoPreviewController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private panelSubscriptions: vscode.Disposable[] = [];
  private mode: PreviewMode = "preview";

  private previewSourceUri: vscode.Uri | undefined;
  private previewArtifacts: PreviewPanelState["preview"]["artifacts"];
  private previewError: string | undefined;
  private previewLoading = false;
  private previewGeneration = 0;
  private previewContentRevision = 0;
  private previewSentRevision = -1;
  private previewAbortController: AbortController | undefined;

  private markdownSourceUri: vscode.Uri | undefined;
  private markdownSource: string | undefined;
  private markdownAssets: PreviewPanelState["markdown"]["assets"];
  private markdownSettings: MarkdownPreviewSettings = { ...defaultMarkdownPreviewSettings };
  private markdownError: string | undefined;
  private markdownLoading = false;
  private markdownGeneration = 0;
  private markdownContentRevision = 0;
  private markdownSentRevision = -1;
  private markdownAbortController: AbortController | undefined;

  private diffBeforeUri: vscode.Uri | undefined;
  private diffAfterUri: vscode.Uri | undefined;
  private diffRemovedSvg: string | undefined;
  private diffAddedSvg: string | undefined;
  private diffSummary: PreviewPanelState["diff"]["summary"];
  private diffError: string | undefined;
  private diffLoading = false;
  private diffGeneration = 0;
  private diffContentRevision = 0;
  private diffSentRevision = -1;
  private diffAbortController: AbortController | undefined;

  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly renderer: XaligoRenderer,
    private readonly showUpdates: () => Promise<void>,
    private readonly runCliFeature: (
      feature: CliFeature,
      sourceUri?: vscode.Uri,
      markdown?: MarkdownPreviewSettings
    ) => Promise<void>
  ) {
    this.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
      const savedUri = document.uri.toString();
      if (this.mode === "preview" && this.previewSourceUri?.toString() === savedUri) {
        void this.renderPreview();
      }
      if (this.mode === "markdown" && this.markdownSourceUri?.toString() === savedUri) {
        void this.renderMarkdown();
      }
      if (this.mode === "diff" && (
        this.diffBeforeUri?.toString() === savedUri ||
        this.diffAfterUri?.toString() === savedUri
      )) {
        void this.renderDiff();
      }
    }));
  }

  dispose(): void {
    this.cancelPreviewRender();
    this.cancelMarkdownRender();
    this.cancelDiffRender();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.disposePanelSubscriptions();
    this.panel?.dispose();
  }

  zoomBy(delta: number): void {
    this.postMessage({ command: "zoomBy", delta });
  }

  resetZoom(): void {
    this.postMessage({ command: "resetZoom" });
  }

  resetView(): void {
    this.postMessage({ command: "fit" });
  }

  closePreview(): void {
    this.panel?.dispose();
  }

  async openPreview(document: vscode.TextDocument | undefined): Promise<void> {
    if (!isFileXalDocument(document)) {
      vscode.window.showWarningMessage("Open a saved .xal file before starting preview.");
      return;
    }
    if (!await saveDocument(document)) {
      vscode.window.showWarningMessage("Save the .xal file before starting preview.");
      return;
    }

    const changedSource = this.previewSourceUri?.toString() !== document.uri.toString();
    this.previewSourceUri = document.uri;
    if (changedSource) {
      this.previewArtifacts = undefined;
      this.previewError = undefined;
      this.previewContentRevision += 1;
    }
    this.mode = "preview";
    this.cancelMarkdownRender();
    this.cancelDiffRender();
    this.forceActiveContentDelivery();
    this.ensurePanel();
    this.updatePanel();
    await this.renderPreview();
  }

  async openMarkdownPreview(
    document: vscode.TextDocument | undefined,
    settings: MarkdownPreviewSettings = { ...defaultMarkdownPreviewSettings }
  ): Promise<void> {
    let sourceUri: vscode.Uri | undefined;
    if (isFileMarkdownDocument(document)) {
      if (!await saveDocument(document)) {
        vscode.window.showWarningMessage("Save the Markdown file before starting preview.");
        return;
      }
      sourceUri = document.uri;
    } else if (this.mode === "markdown" && this.markdownSourceUri) {
      sourceUri = this.markdownSourceUri;
      if (!await saveOpenDocument(sourceUri)) {
        return;
      }
    } else {
      const defaultSource = this.markdownSourceUri ?? this.previewSourceUri;
      const selection = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        defaultUri: defaultSource
          ? vscode.Uri.file(path.dirname(defaultSource.fsPath))
          : undefined,
        filters: { Markdown: ["md", "markdown"] },
        openLabel: "Preview",
        title: "Select the Markdown file to preview"
      });
      sourceUri = selection?.[0];
      if (!sourceUri) {
        return;
      }
      if (!isMarkdownFilePath(sourceUri.fsPath)) {
        vscode.window.showWarningMessage("Select a saved .md or .markdown file.");
        return;
      }
      if (!await saveOpenDocument(sourceUri)) {
        return;
      }
    }

    const changedSource = this.markdownSourceUri?.toString() !== sourceUri.toString();
    this.markdownSourceUri = sourceUri;
    this.markdownSettings = settings;
    if (changedSource) {
      this.markdownSource = undefined;
      this.markdownAssets = undefined;
      this.markdownError = undefined;
      this.markdownContentRevision += 1;
    }
    this.mode = "markdown";
    this.cancelPreviewRender();
    this.cancelDiffRender();
    this.forceActiveContentDelivery();
    this.ensurePanel();
    this.updatePanel();
    await this.renderMarkdown();
  }

  async openDiffPreview(): Promise<void> {
    this.mode = "diff";
    this.cancelPreviewRender();
    this.cancelMarkdownRender();
    this.forceActiveContentDelivery();
    this.ensurePanel();
    this.updatePanel();

    if (!await this.selectDiffFile("before", false)) {
      return;
    }
    await this.selectDiffFile("after");
  }

  private ensurePanel(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "xaligoPreview",
      "xaligo Preview",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview")
        ]
      }
    );
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "assets", "xaligo-icon-vscode-128.png");
    this.panel = panel;
    this.previewSentRevision = -1;
    this.markdownSentRevision = -1;
    this.diffSentRevision = -1;
    panel.webview.html = previewHtml(panel.webview, this.context.extensionUri);
    this.panelSubscriptions.push(
      panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleWebviewMessage(message);
      }),
      panel.onDidDispose(() => {
        this.cancelPreviewRender();
        this.cancelMarkdownRender();
        this.cancelDiffRender();
        this.disposePanelSubscriptions();
        this.panel = undefined;
      })
    );
  }

  private async handleWebviewMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== "object" || !("command" in message)) {
      return;
    }

    const candidate = message as Partial<PreviewWebviewMessage> & Record<string, unknown>;
    switch (candidate.command) {
      case "ready":
        this.forceActiveContentDelivery();
        this.updatePanel();
        break;
      case "close":
        this.closePreview();
        break;
      case "setMode":
        if (
          candidate.mode === "preview" ||
          candidate.mode === "markdown" ||
          candidate.mode === "diff"
        ) {
          await this.setMode(candidate.mode);
        }
        break;
      case "selectDiffFile":
        if (candidate.side === "before" || candidate.side === "after") {
          await this.selectDiffFile(candidate.side);
        }
        break;
      case "swapDiffFiles":
        await this.swapDiffFiles();
        break;
      case "showUpdates":
        await this.showUpdates();
        break;
      case "setMarkdownSettings": {
        const settings = parseMarkdownPreviewSettings(candidate.settings);
        if (settings) {
          this.markdownSettings = settings;
          this.updatePanel();
        }
        break;
      }
      case "runCliFeature":
        if (typeof candidate.feature === "string" && cliFeatures.includes(candidate.feature as CliFeature)) {
          const feature = candidate.feature as CliFeature;
          const markdown = feature === "preview-markdown"
            ? candidate.markdown === undefined
              ? { ...defaultMarkdownPreviewSettings }
              : parseMarkdownPreviewSettings(candidate.markdown)
            : undefined;
          if (feature === "preview-markdown" && markdown) {
            await this.openMarkdownPreview(undefined, markdown);
          } else if (feature !== "preview-markdown") {
            await this.runCliFeature(feature, this.activeSourceUri());
          }
        }
        break;
      case "refresh":
        if (this.mode === "diff") {
          await this.renderDiff();
        } else if (this.mode === "markdown") {
          await this.renderMarkdown();
        } else {
          await this.renderPreview();
        }
        break;
    }
  }

  private async setMode(mode: PreviewMode): Promise<void> {
    this.mode = mode;
    if (mode === "preview") {
      this.cancelMarkdownRender();
      this.cancelDiffRender();
    } else if (mode === "markdown") {
      this.cancelPreviewRender();
      this.cancelDiffRender();
    } else {
      this.cancelPreviewRender();
      this.cancelMarkdownRender();
    }
    this.forceActiveContentDelivery();
    if (mode === "preview" && !this.previewSourceUri) {
      const document = vscode.window.activeTextEditor?.document;
      if (isFileXalDocument(document) && await saveDocument(document)) {
        this.previewSourceUri = document.uri;
        this.previewArtifacts = undefined;
        this.previewError = undefined;
        this.previewContentRevision += 1;
        this.forceActiveContentDelivery();
        this.updatePanel();
        await this.renderPreview();
        return;
      }
    }
    this.updatePanel();
    if (mode === "preview" && this.previewSourceUri) {
      await this.renderPreview();
    } else if (mode === "markdown" && this.markdownSourceUri) {
      await this.renderMarkdown();
    } else if (mode === "diff" && this.diffBeforeUri && this.diffAfterUri) {
      await this.renderDiff();
    }
  }

  private activeSourceUri(): vscode.Uri | undefined {
    return this.mode === "markdown" ? this.markdownSourceUri : this.previewSourceUri;
  }

  private async selectDiffFile(side: DiffSide, renderWhenReady = true): Promise<boolean> {
    const current = side === "before" ? this.diffBeforeUri : this.diffAfterUri;
    const other = side === "before" ? this.diffAfterUri : this.diffBeforeUri;
    const defaultSource = current ?? other ?? this.previewSourceUri;
    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri: defaultSource ? vscode.Uri.file(path.dirname(defaultSource.fsPath)) : undefined,
      filters: { "xaligo diagrams": ["xal"] },
      openLabel: side === "before" ? "Select Before" : "Select After",
      title: side === "before" ? "Select the before .xal file" : "Select the after .xal file"
    });
    const selected = selection?.[0];
    if (!selected) {
      return false;
    }

    try {
      await validateDiffFile(selected);
      if (!await saveOpenDocument(selected)) {
        return false;
      }
      if (other && await filesReferToSamePath(selected, other)) {
        vscode.window.showWarningMessage("Select two different .xal files for structural diff.");
        return false;
      }
    } catch (error) {
      vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      return false;
    }

    const previous = side === "before" ? this.diffBeforeUri : this.diffAfterUri;
    if (side === "before") {
      this.diffBeforeUri = selected;
    } else {
      this.diffAfterUri = selected;
    }
    if (previous?.toString() !== selected.toString()) {
      this.clearDiffResult();
    }
    this.mode = "diff";
    this.updatePanel();
    if (renderWhenReady && this.diffBeforeUri && this.diffAfterUri) {
      await this.renderDiff();
    }
    return true;
  }

  private async swapDiffFiles(): Promise<void> {
    [this.diffBeforeUri, this.diffAfterUri] = [this.diffAfterUri, this.diffBeforeUri];
    this.clearDiffResult();
    this.updatePanel();
    if (this.diffBeforeUri && this.diffAfterUri) {
      await this.renderDiff();
    }
  }

  private async renderPreview(): Promise<void> {
    const source = this.previewSourceUri;
    if (!source || !this.panel) {
      return;
    }

    this.previewAbortController?.abort();
    const abortController = new AbortController();
    this.previewAbortController = abortController;
    const generation = ++this.previewGeneration;
    this.previewLoading = true;
    this.previewError = undefined;
    this.updatePanel();

    const outputRoot = path.join(this.context.globalStorageUri.fsPath, "preview");
    const digest = uriDigest(source);
    let invocationDirectory: string | undefined;
    try {
      invocationDirectory = await createTemporaryOutputDirectory(outputRoot, digest);
      const outputPath = path.join(invocationDirectory, "preview.svg");
      await this.renderer.render(source.fsPath, outputPath, "svg", abortController.signal);
      const artifacts = await readPreviewArtifacts(invocationDirectory, outputPath);
      if (generation !== this.previewGeneration) {
        return;
      }
      this.previewArtifacts = artifacts;
      this.previewContentRevision += 1;
      this.previewError = undefined;
    } catch (error) {
      if (generation !== this.previewGeneration) {
        return;
      }
      this.previewError = errorMessage(error);
    } finally {
      if (invocationDirectory) {
        await fs.rm(invocationDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
      if (generation === this.previewGeneration) {
        this.previewLoading = false;
        if (this.previewAbortController === abortController) {
          this.previewAbortController = undefined;
        }
        this.updatePanel();
      }
    }
  }

  private async renderMarkdown(): Promise<void> {
    const source = this.markdownSourceUri;
    if (!source || !this.panel) {
      return;
    }

    this.cancelMarkdownRender();
    const abortController = new AbortController();
    this.markdownAbortController = abortController;
    const generation = ++this.markdownGeneration;
    this.markdownLoading = true;
    this.markdownError = undefined;
    this.updatePanel();

    const outputRoot = path.join(this.context.globalStorageUri.fsPath, "markdown-preview");
    const digest = uriDigest(source);
    let invocationDirectory: string | undefined;
    try {
      if (!await saveOpenDocument(source)) {
        throw new Error("Save the Markdown file before starting preview.");
      }
      invocationDirectory = await createTemporaryOutputDirectory(outputRoot, digest);
      const outputPath = path.join(invocationDirectory, "document.md");
      const svgDirectory = path.join(invocationDirectory, "assets");
      await this.renderer.renderMarkdown(
        source.fsPath,
        outputPath,
        svgDirectory,
        abortController.signal
      );
      if (generation !== this.markdownGeneration) {
        return;
      }
      const rendered = await readRenderedMarkdownPreview(outputPath, svgDirectory);
      if (generation !== this.markdownGeneration) {
        return;
      }
      this.markdownSource = rendered.source;
      this.markdownAssets = rendered.assets;
      this.markdownContentRevision += 1;
      this.markdownError = undefined;
    } catch (error) {
      if (generation !== this.markdownGeneration) {
        return;
      }
      this.markdownError = errorMessage(error);
    } finally {
      if (invocationDirectory) {
        await fs.rm(invocationDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
      if (generation === this.markdownGeneration) {
        this.markdownLoading = false;
        if (this.markdownAbortController === abortController) {
          this.markdownAbortController = undefined;
        }
        this.updatePanel();
      }
    }
  }

  private async renderDiff(): Promise<void> {
    const before = this.diffBeforeUri;
    const after = this.diffAfterUri;
    if (!before || !after || !this.panel) {
      return;
    }

    this.diffAbortController?.abort();
    const abortController = new AbortController();
    this.diffAbortController = abortController;
    const generation = ++this.diffGeneration;
    this.diffLoading = true;
    this.diffError = undefined;
    this.updatePanel();

    let invocationDirectory: string | undefined;
    try {
      if (await filesReferToSamePath(before, after)) {
        throw new Error("Select two different .xal files for structural diff.");
      }
      if (!await saveOpenDocument(before) || !await saveOpenDocument(after)) {
        throw new Error("Save both .xal files before running structural diff.");
      }

      const outputRoot = path.join(this.context.globalStorageUri.fsPath, "diff");
      const pairDigest = crypto
        .createHash("sha256")
        .update(`${before.toString()}\n${after.toString()}`)
        .digest("hex")
        .slice(0, 16);
      invocationDirectory = await createTemporaryOutputDirectory(outputRoot, pairDigest);
      const result = await this.renderer.diff(
        before.fsPath,
        after.fsPath,
        path.join(invocationDirectory, "comparison"),
        abortController.signal
      );
      if (generation !== this.diffGeneration) {
        return;
      }
      this.diffRemovedSvg = result.removedSvg;
      this.diffAddedSvg = result.addedSvg;
      this.diffSummary = result.summary;
      this.diffContentRevision += 1;
      this.diffError = undefined;
    } catch (error) {
      if (generation !== this.diffGeneration) {
        return;
      }
      this.diffError = errorMessage(error);
    } finally {
      if (invocationDirectory) {
        await fs.rm(invocationDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
      if (generation === this.diffGeneration) {
        this.diffLoading = false;
        if (this.diffAbortController === abortController) {
          this.diffAbortController = undefined;
        }
        this.updatePanel();
      }
    }
  }

  private clearDiffResult(): void {
    this.cancelDiffRender();
    this.diffRemovedSvg = undefined;
    this.diffAddedSvg = undefined;
    this.diffSummary = undefined;
    this.diffContentRevision += 1;
    this.diffError = undefined;
  }

  private updatePanel(): void {
    if (!this.panel) {
      return;
    }

    const state = this.createPanelState();
    this.panel.title = panelTitle(state);
    this.postMessage({ command: "state", state });
  }

  private createPanelState(): PreviewPanelState {
    const previewKey = this.previewSourceUri?.toString() ?? "empty";
    const markdownKey = this.markdownSourceUri?.toString() ?? "empty";
    const diffKey = `${this.diffBeforeUri?.toString() ?? "empty"}\n${this.diffAfterUri?.toString() ?? "empty"}`;
    const includePreviewContent = this.mode === "preview" && this.previewSentRevision !== this.previewContentRevision;
    const includeMarkdownContent = this.mode === "markdown" &&
      this.markdownSentRevision !== this.markdownContentRevision;
    const includeDiffContent = this.mode === "diff" && this.diffSentRevision !== this.diffContentRevision;
    const state: PreviewPanelState = {
      mode: this.mode,
      viewKey: this.mode === "preview"
        ? `preview:${previewKey}`
        : this.mode === "markdown"
          ? `markdown:${markdownKey}`
          : `diff:${diffKey}`,
      preview: {
        contentRevision: this.previewContentRevision,
        sourceName: fileName(this.previewSourceUri),
        sourcePath: this.previewSourceUri?.fsPath,
        artifacts: includePreviewContent ? this.previewArtifacts : undefined,
        loading: this.previewLoading,
        error: this.previewError
      },
      markdown: {
        contentRevision: this.markdownContentRevision,
        sourceName: fileName(this.markdownSourceUri),
        sourcePath: this.markdownSourceUri?.fsPath,
        source: includeMarkdownContent ? this.markdownSource : undefined,
        assets: includeMarkdownContent ? this.markdownAssets : undefined,
        settings: this.markdownSettings,
        loading: this.markdownLoading,
        error: this.markdownError
      },
      diff: {
        contentRevision: this.diffContentRevision,
        beforeName: fileName(this.diffBeforeUri),
        beforePath: this.diffBeforeUri?.fsPath,
        afterName: fileName(this.diffAfterUri),
        afterPath: this.diffAfterUri?.fsPath,
        removedSvg: includeDiffContent ? this.diffRemovedSvg : undefined,
        addedSvg: includeDiffContent ? this.diffAddedSvg : undefined,
        loading: this.diffLoading,
        error: this.diffError,
        summary: this.diffSummary
      }
    };
    if (includePreviewContent) {
      this.previewSentRevision = this.previewContentRevision;
    }
    if (includeMarkdownContent) {
      this.markdownSentRevision = this.markdownContentRevision;
    }
    if (includeDiffContent) {
      this.diffSentRevision = this.diffContentRevision;
    }
    return state;
  }

  private postMessage(message: PreviewHostMessage): void {
    void this.panel?.webview.postMessage(message);
  }

  private forceActiveContentDelivery(): void {
    if (this.mode === "preview") {
      this.previewSentRevision = -1;
    } else if (this.mode === "markdown") {
      this.markdownSentRevision = -1;
    } else {
      this.diffSentRevision = -1;
    }
  }

  private cancelPreviewRender(): void {
    this.previewAbortController?.abort();
    this.previewAbortController = undefined;
    this.previewGeneration += 1;
    this.previewLoading = false;
  }

  private cancelMarkdownRender(): void {
    this.markdownAbortController?.abort();
    this.markdownAbortController = undefined;
    this.markdownGeneration += 1;
    this.markdownLoading = false;
  }

  private cancelDiffRender(): void {
    this.diffAbortController?.abort();
    this.diffAbortController = undefined;
    this.diffGeneration += 1;
    this.diffLoading = false;
  }

  private disposePanelSubscriptions(): void {
    for (const subscription of this.panelSubscriptions) {
      subscription.dispose();
    }
    this.panelSubscriptions = [];
  }
}

function previewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptNonce = crypto.randomBytes(16).toString("base64");
  const stylesheetUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview", "preview.css"));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview", "preview.js"));
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; img-src blob:; style-src ${webview.cspSource}; script-src 'nonce-${scriptNonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${stylesheetUri}">
  <title>xaligo Preview</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${scriptNonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function panelTitle(state: PreviewPanelState): string {
  if (state.mode === "diff") {
    const before = state.diff.beforeName ?? "Before";
    const after = state.diff.afterName ?? "After";
    return `Diff: ${before} ↔ ${after}`;
  }
  if (state.mode === "markdown") {
    return `Preview: ${state.markdown.sourceName ?? "Markdown"}`;
  }
  return `Preview: ${state.preview.sourceName ?? "xaligo"}`;
}

function uriDigest(uri: vscode.Uri): string {
  return crypto.createHash("sha256").update(uri.toString()).digest("hex").slice(0, 16);
}

function fileName(uri: vscode.Uri | undefined): string | undefined {
  return uri ? path.basename(uri.fsPath) : undefined;
}

function isFileXalDocument(document: vscode.TextDocument | undefined): document is vscode.TextDocument {
  return Boolean(document && document.languageId === "xal" && document.uri.scheme === "file");
}

function isFileMarkdownDocument(
  document: vscode.TextDocument | undefined
): document is vscode.TextDocument {
  return Boolean(
    document &&
    document.uri.scheme === "file" &&
    isMarkdownFilePath(document.uri.fsPath)
  );
}

async function saveDocument(document: vscode.TextDocument): Promise<boolean> {
  return !document.isDirty || document.save();
}

async function saveOpenDocument(uri: vscode.Uri): Promise<boolean> {
  const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === uri.toString());
  return !document || saveDocument(document);
}

async function validateDiffFile(uri: vscode.Uri): Promise<void> {
  if (uri.scheme !== "file" || path.extname(uri.fsPath).toLowerCase() !== ".xal") {
    throw new Error("Structural diff inputs must be local .xal files.");
  }
  const info = await fs.stat(uri.fsPath);
  if (!info.isFile()) {
    throw new Error(`Structural diff input is not a file: ${uri.fsPath}`);
  }
}

async function filesReferToSamePath(left: vscode.Uri, right: vscode.Uri): Promise<boolean> {
  const [leftPath, rightPath] = await Promise.all([
    fs.realpath(left.fsPath),
    fs.realpath(right.fsPath)
  ]);
  return process.platform === "win32"
    ? leftPath.toLowerCase() === rightPath.toLowerCase()
    : leftPath === rightPath;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
