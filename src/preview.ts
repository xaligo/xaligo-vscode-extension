import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import type {
  PreviewHostMessage,
  PreviewMode,
  PreviewPanelState,
  PreviewWebviewMessage
} from "./preview-contract";
import { XaligoRenderer } from "./xaligo";
import { createTemporaryOutputDirectory } from "./xaligo-command";

type DiffSide = "before" | "after";

export class XaligoPreviewController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private panelSubscriptions: vscode.Disposable[] = [];
  private mode: PreviewMode = "preview";

  private previewSourceUri: vscode.Uri | undefined;
  private previewSvg: string | undefined;
  private previewError: string | undefined;
  private previewLoading = false;
  private previewGeneration = 0;
  private previewContentRevision = 0;
  private previewSentRevision = -1;
  private previewAbortController: AbortController | undefined;

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
    private readonly renderer: XaligoRenderer
  ) {
    this.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
      const savedUri = document.uri.toString();
      if (this.mode === "preview" && this.previewSourceUri?.toString() === savedUri) {
        void this.renderPreview();
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
      this.previewSvg = undefined;
      this.previewError = undefined;
      this.previewContentRevision += 1;
    }
    this.mode = "preview";
    this.cancelDiffRender();
    this.forceActiveContentDelivery();
    this.ensurePanel();
    this.updatePanel();
    await this.renderPreview();
  }

  async openDiffPreview(): Promise<void> {
    this.mode = "diff";
    this.cancelPreviewRender();
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
          vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview"),
          vscode.Uri.joinPath(this.context.extensionUri, "media")
        ]
      }
    );
    this.panel = panel;
    this.previewSentRevision = -1;
    this.diffSentRevision = -1;
    panel.webview.html = previewHtml(panel.webview, this.context.extensionUri);
    this.panelSubscriptions.push(
      panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleWebviewMessage(message);
      }),
      panel.onDidDispose(() => {
        this.cancelPreviewRender();
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
        if (candidate.mode === "preview" || candidate.mode === "diff") {
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
      case "refresh":
        if (this.mode === "diff") {
          await this.renderDiff();
        } else {
          await this.renderPreview();
        }
        break;
    }
  }

  private async setMode(mode: PreviewMode): Promise<void> {
    this.mode = mode;
    if (mode === "preview") {
      this.cancelDiffRender();
    } else {
      this.cancelPreviewRender();
    }
    this.forceActiveContentDelivery();
    if (mode === "preview" && !this.previewSourceUri) {
      const document = vscode.window.activeTextEditor?.document;
      if (isFileXalDocument(document) && await saveDocument(document)) {
        this.previewSourceUri = document.uri;
        this.previewSvg = undefined;
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
    } else if (mode === "diff" && this.diffBeforeUri && this.diffAfterUri) {
      await this.renderDiff();
    }
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
      const svg = await fs.readFile(outputPath, "utf8");
      if (generation !== this.previewGeneration) {
        return;
      }
      this.previewSvg = svg;
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
    const diffKey = `${this.diffBeforeUri?.toString() ?? "empty"}\n${this.diffAfterUri?.toString() ?? "empty"}`;
    const includePreviewContent = this.mode === "preview" && this.previewSentRevision !== this.previewContentRevision;
    const includeDiffContent = this.mode === "diff" && this.diffSentRevision !== this.diffContentRevision;
    const state: PreviewPanelState = {
      mode: this.mode,
      viewKey: this.mode === "preview" ? `preview:${previewKey}` : `diff:${diffKey}`,
      preview: {
        contentRevision: this.previewContentRevision,
        sourceName: fileName(this.previewSourceUri),
        sourcePath: this.previewSourceUri?.fsPath,
        svg: includePreviewContent ? this.previewSvg : undefined,
        loading: this.previewLoading,
        error: this.previewError
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
  const nonce = crypto.randomBytes(16).toString("base64");
  const stylesheetUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "preview.css"));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview", "preview.js"));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${stylesheetUri}">
  <title>xaligo Preview</title>
</head>
<body>
  <nav class="menubar" aria-label="xaligo preview menu">
    <span class="brand">xaligo</span>
    <div class="mode-tabs" role="group" aria-label="Preview mode">
      <button id="mode-preview" type="button" aria-pressed="true" data-command="set-preview">Preview</button>
      <button id="mode-diff" type="button" aria-pressed="false" data-command="set-diff">Diff</button>
    </div>
    <div id="preview-actions" class="context-actions">
      <span id="preview-source" class="file-label">No source selected</span>
      <button type="button" data-command="refresh" title="Render again">Refresh</button>
    </div>
    <div id="diff-actions" class="context-actions" hidden>
      <button id="select-before" type="button" data-command="select-before">Before…</button>
      <span id="before-file" class="file-label">Not selected</span>
      <button id="select-after" type="button" data-command="select-after">After…</button>
      <span id="after-file" class="file-label">Not selected</span>
      <button id="swap-diff" type="button" data-command="swap" title="Swap before and after">Swap</button>
      <button id="compare-diff" type="button" data-command="refresh">Compare</button>
      <span id="diff-summary" class="diff-summary" aria-live="polite"></span>
    </div>
    <div class="view-actions" role="toolbar" aria-label="View controls">
      <button type="button" data-view-command="zoom-out" title="Zoom out" aria-label="Zoom out">−</button>
      <button id="zoom-label" type="button" data-view-command="reset-zoom" title="Reset zoom" aria-label="Reset zoom">100%</button>
      <button type="button" data-view-command="zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
      <button type="button" data-view-command="fit" title="Fit diagrams">Fit</button>
      <button type="button" data-command="close" title="Close preview" aria-label="Close preview">×</button>
    </div>
  </nav>
  <main id="viewport" class="viewport" tabindex="0" aria-label="Diagram viewport">
    <section id="stage" class="stage"></section>
    <section id="empty-state" class="empty-state" role="status" aria-live="polite">
      <h1 id="state-title">Rendering…</h1>
      <p id="state-message"></p>
      <pre id="state-error" hidden></pre>
    </section>
    <div id="loading" class="loading" role="status" aria-live="polite" hidden>Rendering…</div>
  </main>
  <footer class="gesture-hint">Ctrl/Cmd + wheel to zoom · drag or arrow keys to move</footer>
  <div id="announcement" class="visually-hidden" role="status" aria-live="polite"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function panelTitle(state: PreviewPanelState): string {
  if (state.mode === "diff") {
    const before = state.diff.beforeName ?? "Before";
    const after = state.diff.afterName ?? "After";
    return `Diff: ${before} ↔ ${after}`;
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
